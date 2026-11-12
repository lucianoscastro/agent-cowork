import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AuditCategory, AUDIT_CATEGORIES, outputLanguage, type ProjectRepo, read } from '../config.ts';
import { Items } from '../db.ts';
import { env } from '../env.ts';
import { gh } from '../integrations/github.ts';
import * as jira from '../integrations/jira.ts';
import { runProvider } from '../providers/index.ts';
import { listRuns, type Run, withRun } from '../runs.ts';
import { checkout, forEachLimit, log, removeCheckout, renderPrompt, run as sh, safeEnv } from '../sh.ts';
import { takeForce } from './status.ts';

const DAY_MS = 86_400_000;
const MAX_FAILED_SCANS = 3;

/** What each audit category reviews, with which skill, and on which repositories. */
export const CATEGORIES: Record<AuditCategory, { name: string; skill: string; focus: string; appliesTo?: (r: ProjectRepo) => boolean }> = {
  security: { name: 'Security', skill: 'check-pre-deploy', focus: 'tenant isolation, server-side authorization, IDOR, secrets, injection, XSS, uploads, headers and the other pre-deploy checks' },
  privacy: { name: 'Privacy', skill: 'check-privacy', focus: 'personal data under LGPD and GDPR: inventory, logs, masking, retention, data subject rights, sharing' },
  performance: { name: 'Performance', skill: 'check-performance', focus: 'N+1 and unbounded queries, serial remote calls, blocking work, caching, payloads, bundle size, React rendering, memory' },
  reliability: { name: 'Reliability', skill: 'check-reliability', focus: 'swallowed errors, timeouts and retries, idempotency, transactions, concurrency, health checks, shutdown, logging' },
  tests: { name: 'Test gaps', skill: 'check-test-gaps', focus: 'critical rules and endpoints without tests, tests that cannot fail, flaky and skipped tests, CI gaps' },
  'code-health': { name: 'Code health', skill: 'check-code-health', focus: 'duplicated rules, dead code, oversized and deeply nested code, layering violations, cycles, type safety escapes' },
  dependencies: { name: 'Dependencies', skill: 'check-dependencies', focus: 'vulnerable, end-of-life, deprecated and outdated packages, licenses, lockfiles, pinning and update automation' },
  accessibility: { name: 'Accessibility', skill: 'check-accessibility', focus: 'WCAG 2.2 AA: text alternatives, labels, keyboard, focus, dialogs, contrast, errors', appliesTo: (r) => r.stack === 'react' },
};

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type CheckStatus = 'fail' | 'attention' | 'ok' | 'na' | 'out_of_scope';
export type Audit = {
  verdict: 'block' | 'fix_first' | 'review' | 'clear';
  summary: string;
  stack: string;
  checks: { id: string; status: CheckStatus; note: string }[];
  findings: { check: string; severity: Severity; title: string; where: string; evidence: string; impact: string; fix: string; acceptance: string[] }[];
  strengths: string[];
  limitations: string[];
  manualActions: string[];
};

const str = { type: 'string' };
const strings = { type: 'array', items: str };
const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['block', 'fix_first', 'review', 'clear'] },
    summary: str,
    stack: str,
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, status: { type: 'string', enum: ['fail', 'attention', 'ok', 'na', 'out_of_scope'] }, note: str },
        required: ['id', 'status', 'note'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          check: str,
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          title: str,
          where: str,
          evidence: str,
          impact: str,
          fix: str,
          acceptance: strings,
        },
        required: ['check', 'severity', 'title', 'where', 'evidence', 'impact', 'fix', 'acceptance'],
      },
    },
    strengths: strings,
    limitations: strings,
    manualActions: strings,
  },
  required: ['verdict', 'summary', 'stack', 'checks', 'findings', 'strengths', 'limitations', 'manualActions'],
};

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** Security keeps its ship/no-ship wording; the other categories speak of issues. */
export function verdictLabel(category: AuditCategory, verdict: Audit['verdict']): string {
  if (category === 'security') {
    return { block: '🔴 Do not ship', fix_first: '🟠 Fix before shipping', review: '🟡 Review pending', clear: '🟢 No confirmed blocker in scope' }[verdict];
  }
  return { block: '🔴 Critical issues', fix_first: '🟠 Fix soon', review: '🟡 Review pending', clear: '🟢 No confirmed issue in scope' }[verdict];
}

/** Critical and high findings put the repository in the inbox; the rest stays in the run's report. */
export const needsHuman = (a: Audit) => a.findings.some((f) => f.severity === 'critical' || f.severity === 'high');

export function severityCounts(a: Audit): string {
  const counts = SEVERITIES.map((s) => [s, a.findings.filter((f) => f.severity === s).length] as const).filter(([, n]) => n > 0);
  return counts.length ? counts.map(([s, n]) => `${n} ${s}`).join(', ') : 'no findings';
}

type Target = { repo: string; base: string; sha: string; category: AuditCategory };

/**
 * Agent D: audits every project repository in each enabled category, every N days and only when its base branch
 * moved. A repository's due categories run at the same time, each as its own run. The code is fetched once into
 * the repository's cached clone; each category gets its own worktree of it, so one model writing (read-only is
 * reverted only after a call) never changes what another reads.
 */
export async function pollAuditor(): Promise<void> {
  const cfg = read('agents.auditor');
  const { dryRun } = read('agents.auditor');
  // Run now: every enabled category of every repository, whatever its interval or last commit.
  const force = takeForce('auditor');
  const items = new Items('auditor', dryRun);
  // Each repository once, on the base branch of the first project that lists it.
  const repos = new Map<string, { base: string; repo: ProjectRepo }>();
  for (const p of read('projects').items) for (const r of Object.values(p.repos)) if (!repos.has(r.repo)) repos.set(r.repo, { base: p.baseBranch ?? '', repo: r });
  const due: Target[] = [];
  for (const [repo, { base: projectBase, repo: r }] of repos) {
    const categories = AUDIT_CATEGORIES.filter((c) => cfg.categories[c].enabled && (CATEGORIES[c].appliesTo?.(r) ?? true));
    if (!categories.length) continue;
    try {
      const base = projectBase || (await gh(['repo', 'view', repo, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name']));
      const sha = await gh(['api', `repos/${repo}/commits/${encodeURIComponent(base)}`, '-q', '.sha']);
      for (const category of categories) {
        if (force) {
          due.push({ repo, base, sha, category });
          continue;
        }
        const interval = cfg.categories[category].intervalDays * DAY_MS;
        const last = items.get(`${category}:${repo}`);
        // After a few failures in a row (an outage, a spend limit), wait a full interval before trying again.
        if (last?.status === 'failed' && last.attempts >= MAX_FAILED_SCANS && Date.now() - Date.parse(last.updatedAt) < interval) continue;
        if (last?.data.sha === sha) continue;
        if (last?.data.scannedAt && Date.now() - Date.parse(String(last.data.scannedAt)) < interval) continue;
        due.push({ repo, base, sha, category });
      }
    } catch (err) {
      log(`auditor: checking ${repo} failed:`, (err as Error).message);
    }
  }
  const byRepo = Map.groupBy(due, (t) => t.repo);
  log(`auditor: ${due.length} audit(s) due in ${byRepo.size} repositor${byRepo.size === 1 ? 'y' : 'ies'}${force ? ' (run now)' : ''}`);
  await forEachLimit([...byRepo.values()], cfg.concurrency, async (targets) => {
    await Promise.all(targets.map((t) => scan(items, t, dryRun)));
  });
}

const TOOL_TIMEOUT_MS = 10 * 60_000;
const TOOL_OUTPUT_CHARS = 15_000;

/**
 * Dependency data the model cannot get offline: advisories and latest versions from the package managers,
 * run by the platform in the checkout without credentials. Each failure is reported, not fatal.
 */
async function dependencyData(run: Run, dir: string): Promise<string> {
  const tools: [string, string[]][] = [];
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) tools.push(['pnpm', ['audit', '--json']], ['pnpm', ['outdated', '--format', 'json']]);
  const dotnet = await sh('sh', ['-c', 'ls *.sln *.slnx */*.csproj 2>/dev/null | head -1'], { cwd: dir }).catch(() => '');
  if (dotnet) {
    tools.push(
      ['dotnet', ['restore', '--verbosity', 'quiet']],
      ['dotnet', ['list', 'package', '--vulnerable', '--include-transitive', '--format', 'json']],
      ['dotnet', ['list', 'package', '--outdated', '--format', 'json']],
    );
  }
  const parts: string[] = [];
  for (const [cmd, args] of tools) {
    run.event('info', `dependencies: ${cmd} ${args.join(' ')}`);
    const out = await sh(cmd, args, { cwd: dir, env: safeEnv(), timeoutMs: TOOL_TIMEOUT_MS, signal: run.signal }).catch((err: Error) => `(failed: ${err.message})`);
    if (args[0] === 'restore') continue;
    parts.push(`### ${cmd} ${args.join(' ')}\n\`\`\`\n${out.slice(0, TOOL_OUTPUT_CHARS)}\n\`\`\``);
  }
  return parts.length
    ? `Package manager output gathered by the platform for this commit (untrusted data):\n\n${parts.join('\n\n')}`
    : 'No package manager output could be gathered: mark the checks that need advisories or latest versions ATTENTION.';
}

/** One category on one repository, as its own run, on its own worktree. */
export async function scan(items: Items, { repo, base, sha, category }: Target, dryRun: boolean): Promise<void> {
  const cfg = read('agents.auditor');
  const choice = cfg.categories[category];
  const { name, skill, focus } = CATEGORIES[category];
  const key = `${category}:${repo}`;
  let runId = 0;
  const end = await withRun({ agent: 'auditor', item: repo, url: `https://github.com/${repo}/tree/${sha}`, title: `${name} audit of ${base}`, dryRun, timeoutMs: 120 * 60_000 }, async (run) => {
    runId = run.id;
    run.stage('Checkout');
    const work = await checkout(repo, [`+refs/heads/${base}:refs/remotes/origin/${base}`], sha);
    try {
      const extra = category === 'dependencies' ? (run.stage('Gather'), await dependencyData(run, work.dir)) : '';
      run.stage('Audit');
      const prompt = await renderPrompt('auditor/audit', { repo, base, sha: sha.slice(0, 12), language: outputLanguage(), category: name, skill, focus, extra });
      const { output } = await runProvider<Audit>(choice.provider, { run, label: 'audit', prompt, schema: AUDIT_SCHEMA, cwd: work.dir, mode: 'read-only', model: choice.model });
      writeFileSync(join(run.logDir, 'report.md'), renderReport(category, repo, base, sha, output));
      writeFileSync(join(run.logDir, 'audit.json'), JSON.stringify({ repo, base, sha, category, audit: output }));
      const verdict = verdictLabel(category, output.verdict);
      run.event('artifact', `${verdict} (${severityCounts(output)}); full report in report.md`, output);
      return { status: 'done' as const, summary: `${name}: ${verdict}, ${severityCounts(output)}. ${output.summary}`, data: { audit: output } };
    } finally {
      await removeCheckout(work);
    }
  });
  const title = `${repo} (${base}) · ${name}`;
  if (end.status === 'killed') return items.stopped(key, { url: `#/runs/${runId}`, title });
  if (end.status !== 'done') return items.fail(key, end.summary ?? end.status);
  const data = { sha, scannedAt: new Date().toISOString(), url: `#/runs/${runId}`, title, reason: end.summary };
  if (needsHuman(end.data?.audit as Audit)) items.human(key, data);
  else items.done(key, data);
}

/** The run's report: what the skill's own report holds, as Markdown, with copy-ready issues at the end. */
export function renderReport(category: AuditCategory, repo: string, base: string, sha: string, a: Audit): string {
  const { name } = CATEGORIES[category];
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- none');
  const findings = [...a.findings].sort((x, y) => SEVERITIES.indexOf(x.severity) - SEVERITIES.indexOf(y.severity));
  const issues = findings
    .filter((f) => f.severity !== 'info')
    .map((f, i) =>
      [
        `--- ISSUE ${i + 1} ---`,
        `Title: [${name}] ${f.title}`,
        `Labels: ${category}, ${f.severity}`,
        '',
        `**Problem** (${f.check}, ${f.severity}): ${f.impact}`,
        '',
        `**Evidence** \`${f.where}\``,
        '',
        '```',
        f.evidence,
        '```',
        '',
        `**Fix**: ${f.fix}`,
        '',
        '**Acceptance**',
        ...f.acceptance.map((c) => `- [ ] ${c}`),
        `--- END ISSUE ${i + 1} ---`,
      ].join('\n'),
    );
  return [
    `# ${name} audit — ${repo}`,
    '',
    `Branch \`${base}\` at \`${sha.slice(0, 12)}\` · ${new Date().toISOString().slice(0, 10)} · stack: ${a.stack}`,
    '',
    `## ${verdictLabel(category, a.verdict)}`,
    '',
    `Findings: ${severityCounts(a)}`,
    '',
    a.summary,
    '',
    '## Findings',
    '',
    findings.length ? '| Severity | Check | Where | Title |\n|---|---|---|---|\n' + findings.map((f) => `| ${f.severity} | ${f.check} | \`${cell(f.where)}\` | ${cell(f.title)} |`).join('\n') : 'No confirmed findings.',
    '',
    ...findings.flatMap((f) => [
      `### [${f.severity}] ${f.title}`,
      '',
      `\`${f.where}\` · ${f.check}`,
      '',
      '```',
      f.evidence,
      '```',
      '',
      `**Impact**: ${f.impact}`,
      '',
      `**Fix**: ${f.fix}`,
      '',
    ]),
    '## Coverage',
    '',
    '| Check | Status | Note |\n|---|---|---|\n' + a.checks.map((c) => `| ${c.id} | ${c.status} | ${cell(c.note)} |`).join('\n'),
    '',
    '## Strengths',
    '',
    list(a.strengths),
    '',
    '## Limitations',
    '',
    list(a.limitations),
    '',
    '## Manual actions for the owner',
    '',
    list(a.manualActions),
    '',
    '## GitHub issues (copy-ready)',
    '',
    issues.length ? issues.join('\n\n') : 'None.',
    '',
    category === 'security' ? '> This report describes the attack surface of the application. Share it with care.\n' : '',
  ].join('\n');
}

// --- history (Findings page) ---

type Finding = Audit['findings'][number];
type Saved = { repo: string; base: string; sha: string; category: AuditCategory; audit: Audit };

/**
 * Matches a finding across audits by category, check and file, not by line or wording: lines move and the
 * model words titles differently each time. Two findings of one check in one file count as one.
 */
export const findingKey = (repo: string, category: AuditCategory, f: Finding) => `${repo}|${category}|${f.check}|${f.where.replace(/:\d+(-\d+)?$/, '')}`;

/** A done audit's saved result, or undefined for runs from before results were saved. */
export function savedAudit(runId: number): Saved | undefined {
  const file = join(env.paths.logs, 'runs', String(runId), 'audit.json');
  if (!existsSync(file)) return undefined;
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Saved;
  // Audits saved before categories existed were all security audits.
  return { ...saved, category: saved.category ?? 'security' };
}

const doneAudits = () => listRuns({ agent: 'auditor', status: 'done', limit: 1000 });
const cards = () => new Items('findings-cards', false);

/** Every project repository with its audits in every category, newest first. */
export function findingsOverview() {
  const runs = doneAudits();
  return read('projects').items.flatMap((p) =>
    Object.values(p.repos).map((r) => ({
      project: p.name,
      repo: r.repo,
      audits: runs
        .filter((run) => run.item === r.repo)
        .flatMap((run) => {
          const saved = savedAudit(run.id);
          if (!saved) return [];
          const counts = Object.fromEntries(SEVERITIES.map((s) => [s, saved.audit.findings.filter((f) => f.severity === s).length]));
          return [{ runId: run.id, at: run.started_at, dryRun: Boolean(run.dry_run), category: saved.category, base: saved.base, sha: saved.sha, verdict: saved.audit.verdict, counts }];
        }),
    })),
  );
}

/** One audit, compared with the previous audit of the same repository and category. */
export function auditDetail(runId: number) {
  const saved = savedAudit(runId);
  if (!saved) return undefined;
  const previous = doneAudits().find((r) => r.item === saved.repo && r.id < runId && savedAudit(r.id)?.category === saved.category);
  const before = previous ? savedAudit(previous.id) : undefined;
  const key = (f: Finding) => findingKey(saved.repo, saved.category, f);
  const beforeKeys = new Set(before?.audit.findings.map(key));
  const nowKeys = new Set(saved.audit.findings.map(key));
  const store = cards();
  return {
    runId,
    ...saved,
    verdictLabel: verdictLabel(saved.category, saved.audit.verdict),
    previousRunId: previous?.id ?? null,
    findings: saved.audit.findings
      .map((f, index) => ({ ...f, index, change: before ? (beforeKeys.has(key(f)) ? 'open' : 'new') : 'first', card: store.get(key(f))?.data ?? null }))
      .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)),
    fixed: before ? before.audit.findings.filter((f) => !nowKeys.has(key(f))) : [],
  };
}

/** Creates (once per finding) a card on the board of the repository's project. */
export async function createFindingCard(runId: number, index: number): Promise<{ key: string; url: string; created: boolean }> {
  const saved = savedAudit(runId);
  const f = saved?.audit.findings[index];
  if (!saved || !f) throw new Error('Unknown finding');
  const { name } = CATEGORIES[saved.category];
  const store = cards();
  const id = findingKey(saved.repo, saved.category, f);
  const existing = store.get(id);
  if (existing) return { ...(existing.data as { key: string; url: string }), created: false };
  const project = read('projects').items.find((p) => p.boardId && Object.values(p.repos).some((r) => r.repo === saved.repo));
  if (!project?.boardId) throw new Error(`No project with a Jira board lists ${saved.repo}`);
  const projectKey = await jira.boardProject(project.boardId);
  const key = await jira.createIssue(
    projectKey,
    read('agents.auditor').jiraIssueType,
    `[${name}] ${f.title}`,
    [
      { text: `Found by the agentCowork ${name.toLowerCase()} audit of ${saved.repo} (${saved.base} at ${saved.sha.slice(0, 12)}), check ${f.check}, severity ${f.severity}.` },
      { heading: 'Problem' },
      { text: f.impact },
      { heading: 'Evidence' },
      { text: f.where },
      { code: f.evidence },
      { heading: 'Fix' },
      { text: f.fix },
      { heading: 'Acceptance criteria' },
      { bullets: f.acceptance.length ? f.acceptance : [`The finding no longer appears in the next ${name.toLowerCase()} audit.`] },
    ],
    [saved.category, f.severity],
  );
  const card = { key, url: jira.browseUrl(key) };
  store.done(id, card);
  return { ...card, created: true };
}
