import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { envSecretName, hostOf, outputLanguage, parseTestVars, type Project, type RepoEnvironment, read } from '../config.ts';
import { getSecret, Items } from '../db.ts';
import { env } from '../env.ts';
import { gh, ghJson } from '../integrations/github.ts';
import * as jira from '../integrations/jira.ts';
import { runProvider } from '../providers/index.ts';
import { type Run, type RunEnd, withRun } from '../runs.ts';
import { checkout, log, maskSecrets, REDACTED, removeCheckout, renderPrompt, withLock } from '../sh.ts';
import { branchOf, isolate, parseReport, type ResolvedSuite, resolveSuite, type TestResult, testLabel } from './suite.ts';
import { streamCommand } from './verify.ts';
import { takeForce } from './status.ts';

const SUITE_TIMEOUT_MS = 4 * 60 * 60_000;
const TEST_TIMEOUT_MS = 20 * 60_000;
const MAX_ATTACHMENT_BYTES = 9 * 1024 * 1024;
const MCP_CLI = '/usr/local/lib/playwright-mcp/cli.js';
const BROWSER = '/usr/bin/chromium';

// --- test source for the model ---

/** The scenario's Gherkin, with its tags, from the feature file. Exported for tests. */
export function scenarioText(feature: string, line: number): string {
  const lines = feature.split('\n');
  let start = line - 1;
  while (start > 0 && lines[start - 1].trim().startsWith('@')) start--;
  let end = line;
  while (end < lines.length && !/^\s*(@|Scenario|Scenario Outline|Example|Rule|Feature|Background)\b/.test(lines[end])) end++;
  return lines.slice(start, end).join('\n').trimEnd();
}

/**
 * What the model reads about a failing test: the scenario's Gherkin for Cucumber, otherwise the test's
 * code from its line on. Exported for tests.
 */
export function testSource(content: string, line: number, framework: string): string {
  if (framework === 'cucumber') return scenarioText(content, line);
  const lines = content.split('\n');
  const from = Math.max(0, line - 1);
  return lines.slice(from, from + 60).join('\n').trimEnd();
}

/** Secret variables as the browser tool's secrets: JSON objects (test users) flattened to NAME_KEY_FIELD. Exported for tests. */
export function flattenSecrets(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (prefix: string, v: unknown) => {
    if (v && typeof v === 'object') for (const [k, inner] of Object.entries(v)) walk(`${prefix}_${k.replace(/\W+/g, '_').toUpperCase()}`, inner);
    else if (v !== undefined && v !== null) out[prefix] = String(v);
  };
  for (const [name, value] of Object.entries(vars)) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        walk(name, parsed);
        continue;
      }
    } catch {
      // not JSON: a plain value
    }
    out[name] = value;
  }
  return out;
}

const SENSITIVE = /pass|pwd|token|secret|key|auth|session|cookie|otp|code|cpf|card/i;

type HarPair = { name: string; value: string };
type HarMessage = { headers?: HarPair[]; cookies?: HarPair[]; queryString?: HarPair[]; postData?: { text?: string; params?: HarPair[] } };

/**
 * A HAR fit to attach to a bug: request bodies and form fields, credentials and session headers, cookie
 * values and sensitive query parameters removed, then any secret value left anywhere masked. Exported for tests.
 */
export function sanitizeHar(har: string, secrets: string[]): string {
  const doc = JSON.parse(har) as { log?: { entries?: { request?: HarMessage; response?: HarMessage }[] } };
  const mask = (pairs: HarPair[] | undefined, when: (name: string) => boolean) => pairs?.forEach((p) => when(p.name) && (p.value = REDACTED));
  for (const entry of doc.log?.entries ?? []) {
    for (const m of [entry.request, entry.response]) {
      if (!m) continue;
      mask(m.headers, (n) => /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i.test(n));
      mask(m.cookies, () => true);
      mask(m.queryString, (n) => SENSITIVE.test(n));
      if (m.postData) {
        if (m.postData.text) m.postData.text = REDACTED;
        mask(m.postData.params, () => true);
      }
    }
  }
  return maskSecrets(JSON.stringify(doc), secrets);
}

// --- model answers ---

type Reproduction = {
  verdict: 'bug' | 'test_problem' | 'environment' | 'not_reproduced';
  confidence: 'high' | 'medium' | 'low';
  title: string;
  summary: string;
  steps: string[];
  expected: string;
  actual: string;
  evidence: string;
};
type Exploration = {
  summary: string;
  anomalies: { title: string; severity: 'critical' | 'high' | 'medium' | 'low'; confirmed: boolean; steps: string[]; expected: string; actual: string; evidence: string }[];
};
const s = { type: 'string' };
const list = { type: 'array', items: s };
const REPRODUCTION_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['bug', 'test_problem', 'environment', 'not_reproduced'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    title: s,
    summary: s,
    steps: list,
    expected: s,
    actual: s,
    evidence: s,
  },
  required: ['verdict', 'confidence', 'title', 'summary', 'steps', 'expected', 'actual', 'evidence'],
};
const EXPLORATION_SCHEMA = {
  type: 'object',
  properties: {
    summary: s,
    anomalies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: s,
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          confirmed: { type: 'boolean' },
          steps: list,
          expected: s,
          actual: s,
          evidence: s,
        },
        required: ['title', 'severity', 'confirmed', 'steps', 'expected', 'actual', 'evidence'],
      },
    },
  },
  required: ['summary', 'anomalies'],
};

// --- the agent ---

/**
 * Agent E, per project test environment: once a day, the end-to-end suites of the repositories checked for
 * them; every few hours, an exploration of what changed in the repositories checked for it.
 */
export async function pollSentinel(): Promise<void> {
  const cfg = read('agents.sentinel');
  const { dryRun } = read('agents.sentinel');
  const items = new Items('sentinel', dryRun);
  const now = new Date().toISOString();
  const force = takeForce('sentinel');
  for (const project of read('projects').items) {
    const env = project.environment;
    if (!env) continue;
    const key = force ? `manual:${project.name}:${now}` : `nightly:${project.name}:${now.slice(0, 10)}`;
    if (Object.values(env.repos).some((t) => t.e2e) && (force || now.slice(11, 16) >= cfg.nightlyAt) && !items.get(key)) {
      await withLock(`sentinel:${project.name}`, async () => {
        const end = await runEnvironment(project, force ? 'Manual run' : 'Nightly run', dryRun);
        // A setup problem (a checked repository with no suite) is one inbox entry per project, replaced each run
        // while it lasts and removed once a run finds every suite.
        const setup = `setup:${project.name}`;
        if (end.status === 'waiting') items.human(setup, { title: `${project.name}: end-to-end tests not run`, reason: end.summary });
        else if (end.status === 'done') items.forget(setup);
        if (end.status === 'done' || end.status === 'waiting') items.done(key, { summary: end.summary });
        else if (end.status === 'killed') items.stopped(key, { title: project.name });
        else items.fail(key, end.summary ?? end.status);
      });
    }
    for (const [repo, target] of Object.entries(env.repos)) {
      if (target.explore) await exploreChanges(items, project, repo, target, dryRun, force);
    }
  }
}

/** One run of a project's test environment, every repository in turn. Exported so an environment can be exercised on its own. */
export function runEnvironment(project: Project, title: string, dryRun: boolean): Promise<RunEnd> {
  const repos = Object.entries(project.environment!.repos).filter(([, t]) => t.e2e);
  const urls = repos.map(([, t]) => t.baseUrl);
  return withRun({ agent: 'sentinel', item: project.name, url: urls[0], title, dryRun, timeoutMs: 6 * 60 * 60_000 }, async (run) => {
    const outcomes: string[] = [];
    const problems: string[] = [];
    for (const [repo, target] of repos) {
      const json = getSecret(envSecretName(project.name, repo));
      const secrets = json ? parseTestVars(json) : {};
      const end = await testRepo(run, project, repo, target, secrets, dryRun);
      // A setup problem in one repository does not stop the others.
      if (end.status === 'waiting') problems.push(`${repo}: ${end.summary}`);
      else if (end.status !== 'done') return { ...end, summary: `${repo}: ${end.summary ?? end.status}` };
      else outcomes.push(`${repo}: ${end.summary}`);
    }
    writeFileSync(join(run.logDir, 'sentinel-report.md'), [`# ${project.name}`, '', ...[...problems, ...outcomes].map((o) => `- ${o}`), ''].join('\n'));
    return { status: problems.length ? 'waiting' : 'done', summary: [...problems, ...outcomes].join('\n').slice(0, 2000) };
  });
}

type Context = {
  run: Run;
  project: Project;
  /** Where the repository is deployed, and its short name (the host). */
  baseUrl: string;
  name: string;
  suite?: ResolvedSuite;
  /** The test variables, by name. */
  secrets: Record<string, string>;
  /** The suite's folder in the checkout, or an empty folder without a suite. */
  dir: string;
  branch: string;
  sha: string;
  vars: NodeJS.ProcessEnv;
  dryRun: boolean;
};

/** A repository's end-to-end suite: failures retried alone, reproduced in a browser, real bugs filed. */
async function testRepo(run: Run, project: Project, repo: string, target: RepoEnvironment, secrets: Record<string, string>, dryRun: boolean): Promise<RunEnd> {
  const cfg = read('agents.sentinel');
  run.stage(`Detect: ${repo}`);
  const found = await resolveSuite(project, repo, target.branch);
  for (const note of found.notes) run.event('info', `${repo}: ${note}`);
  const { suite } = found;
  // Checked but nothing to run: a person fixes the branch or unchecks it (Projects → Test environment).
  if (!suite) {
    const why = found.branch ? `no end-to-end suite on ${found.branch}` : found.notes.join(' ');
    return { status: 'waiting', summary: `End-to-end tests are checked but did not run: ${why}. Fix the branch, or uncheck end-to-end tests in Projects → Test environment.` };
  }
  const base = { run, project, baseUrl: target.baseUrl, name: hostOf(target.baseUrl), secrets, dryRun };

  const vars: NodeJS.ProcessEnv = { ...secrets, CI: 'true' };
  for (const name of suite.urlVars) vars[name] = target.baseUrl;
  const { branch } = suite;
  run.stage(`Checkout: ${repo}`);
  const sha = await gh(['api', `repos/${repo}/commits/${encodeURIComponent(branch)}`, '-q', '.sha']);
  const work = await checkout(repo, [`+refs/heads/${branch}:refs/remotes/origin/${branch}`], sha);
  const ctx: Context = { ...base, suite, vars, dir: suite.workdir ? join(work.dir, suite.workdir) : work.dir, branch, sha };
  try {
    run.stage(`Setup: ${repo}`);
    for (const command of suite.setupCommands) {
      const { code, tail } = await streamCommand(run, run.transcript('setup'), 'setup', command, ctx.dir, { env: vars, timeoutMs: 30 * 60_000 });
      if (code !== 0) return { status: 'failed', summary: `Setup failed: \`${command}\` (exit ${code})\n${tail.slice(-1500)}` };
    }

    run.stage(`Suite: ${repo}`);
    const results = await runSuite(ctx, '', 'suite', SUITE_TIMEOUT_MS);
    if (!results) return { status: 'failed', summary: `The suite wrote no ${suite.reportFormat} report.` };

    const failed = results.filter((r) => r.status === 'failed');
    const passed = results.filter((r) => r.status === 'passed').length;
    run.event('artifact', `${repo} ${branch}@${sha.slice(0, 7)}: ${passed} passed, ${failed.length} failed, ${results.length - passed - failed.length} not run`, { failed: failed.map((f) => f.id) });

    const outcomes: string[] = [];
    for (const test of failed.slice(0, cfg.maxInvestigations)) outcomes.push(await investigate(ctx, test));
    if (failed.length > cfg.maxInvestigations) outcomes.push(`${failed.length - cfg.maxInvestigations} more failures left for the next run (limit ${cfg.maxInvestigations}).`);
    return { status: 'done', summary: `${suite.framework} on ${branch}@${sha.slice(0, 7)}: ${passed} passed, ${failed.length} failed. ${outcomes.join(' ')}` };
  } finally {
    await removeCheckout(work).catch(() => {});
  }
}

/** Runs the suite (or one test, through extra arguments) with the platform's own report, and reads it. */
async function runSuite(ctx: Context, extraArgs: string, label: string, timeoutMs: number): Promise<TestResult[] | undefined> {
  const suite = ctx.suite!;
  const reportDir = await mkdtemp(join(tmpdir(), 'sentinel-report-'));
  const report = join(reportDir, suite.reportFormat === 'junit' ? 'report.xml' : 'report.json');
  try {
    const env = { ...ctx.vars, ...Object.fromEntries(suite.reportEnv.map((n) => [n, report])) };
    const args = suite.reportArgs.replace('{report}', report);
    const command = [suite.runCommand, extraArgs, args].filter(Boolean).join(' ');
    const { tail } = await streamCommand(ctx.run, ctx.run.transcript(label), label, command, ctx.dir, { env, timeoutMs });
    // A JSON reporter without a file setting prints to the output: take the JSON from there.
    const text = existsSync(report) ? readFileSync(report, 'utf8') : suite.reportFormat === 'playwright-json' ? jsonFromOutput(ctx.run.transcript(label)) : undefined;
    if (!text) {
      ctx.run.event('warn', `No report from \`${command}\`: ${tail.slice(-300)}`);
      return undefined;
    }
    return parseReport(suite.reportFormat, text);
  } catch (err) {
    ctx.run.event('warn', `Reading the report failed: ${(err as Error).message.slice(0, 300)}`);
    return undefined;
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
}

/** The JSON a reporter printed, recovered from the command's transcript. */
function jsonFromOutput(transcript: string): string | undefined {
  if (!existsSync(transcript)) return undefined;
  const out = readFileSync(transcript, 'utf8')
    .split('\n')
    .flatMap((l) => {
      try {
        const e = JSON.parse(l) as { type?: string; text?: string };
        return e.type === 'verify.out' && e.text ? [e.text] : [];
      } catch {
        return [];
      }
    })
    .join('');
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  return start >= 0 && end > start ? out.slice(start, end + 1) : undefined;
}

const slug = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60);

/** Finds a test's source file in the checkout: as reported, or by its name further down. */
function sourceOf(ctx: Context, test: TestResult): string | undefined {
  for (const candidate of [join(ctx.dir, test.file), join(ctx.dir, 'tests', test.file), join(ctx.dir, 'e2e', test.file)]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  return undefined;
}

/** A failed test: run again alone; failing every time, reproduced in a browser by the model and filed when it is a bug. */
async function investigate(ctx: Context, test: TestResult): Promise<string> {
  const cfg = read('agents.sentinel');
  const suite = ctx.suite!;
  const { run } = ctx;
  run.stage(`Investigate ${test.title.slice(0, 60)}`);
  let last = test;
  for (let attempt = 1; attempt <= cfg.retries; attempt++) {
    const fresh = (await runSuite(ctx, isolate(suite.isolateArgs, test), `retry-${slug(test.title)}-${attempt}`, TEST_TIMEOUT_MS))?.find((r) => r.id === test.id);
    if (fresh?.status === 'passed') {
      run.event('artifact', `"${test.title}" passed when run alone (attempt ${attempt}): flaky, not filed`);
      return `"${test.title}": flaky (passed alone on attempt ${attempt}).`;
    }
    if (fresh) last = fresh;
  }

  const content = sourceOf(ctx, test);
  const source = content ? testSource(content, test.line, suite.framework) : `${test.title} (source file not found)`;
  const label = `reproduce-${slug(test.title)}`;
  const browser = prepareBrowser(ctx, label);
  const prompt = await renderPrompt('sentinel/reproduce', {
    project: ctx.project.name,
    environment: `${ctx.name} (${ctx.baseUrl})`,
    framework: suite.framework,
    test: source,
    file: test.file,
    failedStep: last.failedStep ?? '(not reported)',
    error: last.error ?? '(no message)',
    retries: cfg.retries ? `It failed again in all ${cfg.retries} runs on its own.` : 'It was not run again on its own.',
    secrets: browser.secretNames.join(', ') || '(none)',
    language: outputLanguage(),
  });
  let output: Reproduction;
  try {
    ({ output } = await runProvider<Reproduction>(cfg.provider, { run, label, prompt, schema: REPRODUCTION_SCHEMA, cwd: ctx.dir, mode: 'read-only', model: cfg.model, browser: browser.config }));
  } catch (err) {
    collectEvidence(ctx, label, browser.outDir);
    return `"${test.title}": reproduction failed (${(err as Error).message.slice(0, 300)}).`;
  }
  const files = [...collectEvidence(ctx, label, browser.outDir), ...last.screenshots.slice(0, 3).map((s, i) => ({ name: `${slug(test.title)}-suite-${i + 1}.png`, type: s.type, data: Buffer.from(s.data, 'base64') }))];
  run.event('artifact', `"${test.title}": ${output.verdict} (${output.confidence})`, output);
  if (output.verdict !== 'bug' || output.confidence !== 'high') {
    return `"${test.title}": ${output.verdict.replace('_', ' ')} (${output.confidence}), not filed. ${output.summary}`;
  }
  const filed = await fileBug(ctx, testLabel(test.id), output.title, [
    { text: output.summary },
    { heading: 'Environment' },
    { text: `${ctx.name}: ${ctx.baseUrl} · tested ${suite.repo} ${ctx.branch}@${ctx.sha.slice(0, 7)}` },
    { heading: 'Failing test' },
    { text: `${test.title} · ${test.file}${test.line ? `:${test.line}` : ''}` },
    { code: source },
    { heading: 'Steps to reproduce' },
    { bullets: output.steps.length ? output.steps : ['See the test above.'] },
    { heading: 'Expected' },
    { text: output.expected },
    { heading: 'Actual' },
    { text: output.actual },
    { heading: 'Failure in the suite' },
    { code: `${last.failedStep ?? ''}\n${(last.error ?? '').slice(0, 3000)}`.trim() },
    { heading: 'Evidence' },
    { text: `${output.evidence} ${cfg.retries ? `It failed in the suite and in all ${cfg.retries} runs on its own.` : ''}`.trim() },
  ], files);
  return `"${test.title}": bug, ${filed}.`;
}

// --- exploration: what changed, every few hours ---

type Changes = { commits: { sha: string; message: string }[]; files: { filename: string; status: string }[] };
const CARD_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/** What changed on a branch, for the model: commits (newest first), the cards they name, the changed files. Exported for tests. */
export function describeChanges(changes: Changes, cards: Record<string, string>): string {
  const commits = [...changes.commits].reverse().slice(0, 30).map((c) => `- ${c.sha.slice(0, 7)} ${c.message.split('\n')[0]}`);
  const named = Object.entries(cards).map(([key, summary]) => `- ${key}: ${summary}`);
  const files = changes.files.slice(0, 150).map((f) => `- ${f.status} ${f.filename}`);
  return [
    `Commits (${changes.commits.length}, newest first):`,
    ...commits,
    ...(named.length ? ['', 'Cards they name:', ...named] : []),
    '',
    `Changed files (${changes.files.length}):`,
    ...files,
  ].join('\n');
}

/**
 * Explores a repository when its branch moved since the last exploration, at most once every few hours. The
 * first time it looks at the last 10 commits. A failed exploration keeps its starting point, so the next one
 * covers the same changes.
 */
async function exploreChanges(items: Items, project: Project, repo: string, target: RepoEnvironment, dryRun: boolean, force: boolean): Promise<void> {
  const cfg = read('agents.sentinel');
  const stateKey = `explored:${project.name}|${repo}`;
  const state = (items.get(stateKey)?.data ?? {}) as { sha?: string; at?: string };
  if (!force && state.at && Date.now() - Date.parse(state.at) < cfg.exploreEveryHours * 3_600_000) return;
  const at = new Date().toISOString();
  let branch: string, head: string, from: string;
  try {
    branch = await branchOf(project, repo, target.branch);
    head = await gh(['api', `repos/${repo}/commits/${encodeURIComponent(branch)}`, '-q', '.sha']);
    from = state.sha ?? (await ghJson<{ sha: string }[]>(['api', `repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=11`])).at(-1)!.sha;
  } catch (err) {
    log(`sentinel: cannot read ${repo} to explore it: ${(err as Error).message.slice(0, 200)}`);
    items.done(stateKey, { ...state, at });
    return;
  }
  // Nothing new since the last exploration: no run, no cost.
  if (head === state.sha) return items.done(stateKey, { ...state, at });
  await withLock(`sentinel:${project.name}`, async () => {
    const end = await withRun({ agent: 'sentinel', item: `${project.name} · ${repo}`, url: target.baseUrl, title: 'Exploration', dryRun, timeoutMs: 2 * 60 * 60_000 }, (run) =>
      exploreRun(run, project, repo, target, branch, from, head, dryRun),
    );
    items.done(stateKey, { sha: end.status === 'done' ? head : state.sha, at });
  });
}

async function exploreRun(run: Run, project: Project, repo: string, target: RepoEnvironment, branch: string, from: string, head: string, dryRun: boolean): Promise<RunEnd> {
  run.stage('Changes');
  const changes = await ghJson<Changes>(['api', `repos/${repo}/compare/${from}...${head}`, '--jq', '{commits: [.commits[] | {sha, message: .commit.message}], files: [.files[]? | {filename, status}]}']);
  const cards: Record<string, string> = {};
  if (jira.jiraStatus().ready) {
    for (const key of [...new Set(changes.commits.flatMap((c) => c.message.match(CARD_KEY) ?? []))].slice(0, 5)) {
      const summary = await jira.getIssue(key).then((i) => i.fields.summary).catch(() => undefined);
      if (summary) cards[key] = summary;
    }
  }
  const described = describeChanges(changes, cards);
  writeFileSync(join(run.logDir, 'changes.md'), `# ${repo} ${branch} ${from.slice(0, 7)}..${head.slice(0, 7)}\n\n${described}\n`);
  const json = getSecret(envSecretName(project.name, repo));
  const secrets = json ? parseTestVars(json) : {};
  run.stage('Checkout');
  const work = await checkout(repo, [`+refs/heads/${branch}:refs/remotes/origin/${branch}`], head);
  try {
    const ctx: Context = { run, project, baseUrl: target.baseUrl, name: hostOf(target.baseUrl), secrets, dir: work.dir, branch, sha: head, vars: { ...secrets }, dryRun };
    return { status: 'done', summary: await explore(ctx, repo, described) };
  } finally {
    await removeCheckout(work).catch(() => {});
  }
}

/** What a confirmed exploration finding needs to become a Jira card later, from the inbox. */
type CardDraft = { project: string; runId: number; labels: string[]; blocks: jira.DocBlock[]; files: string[] };

/** One exploratory session on what changed; each confirmed finding goes to the inbox, ready to become a card. */
async function explore(ctx: Context, repo: string, changes: string): Promise<string> {
  const cfg = read('agents.sentinel');
  const label = `explore-${ctx.sha.slice(0, 7)}`;
  ctx.run.stage('Explore');
  const browser = prepareBrowser(ctx, label);
  const prompt = await renderPrompt('sentinel/explore', {
    project: ctx.project.name,
    repo,
    environment: `${ctx.name} (${ctx.baseUrl})`,
    changes,
    minutes: String(cfg.exploreMinutes),
    secrets: browser.secretNames.join(', ') || '(none)',
    language: outputLanguage(),
  });
  let output: Exploration;
  try {
    ({ output } = await runProvider<Exploration>(cfg.provider, {
      run: ctx.run,
      label,
      prompt,
      schema: EXPLORATION_SCHEMA,
      cwd: ctx.dir,
      mode: 'read-only',
      model: cfg.model,
      browser: browser.config,
    }));
  } catch (err) {
    collectEvidence(ctx, label, browser.outDir);
    throw err;
  }
  const files = collectEvidence(ctx, label, browser.outDir);
  ctx.run.event('artifact', `Exploration: ${output.anomalies.length} anomalies`, output);
  const inbox = new Items('sentinel', ctx.dryRun);
  const queued: string[] = [];
  for (const a of output.anomalies.filter((x) => x.confirmed && x.severity !== 'low')) {
    const fingerprint = `sentinel-explore-${createHash('sha1').update(`${repo}|${a.title.toLowerCase().replace(/\W+/g, ' ').trim()}`).digest('hex').slice(0, 10)}`;
    const key = `explore:${ctx.project.name}|${fingerprint}`;
    // Already in the inbox, dismissed, or carded: not again.
    if (inbox.get(key)) continue;
    const card: CardDraft = {
      project: ctx.project.name,
      runId: ctx.run.id,
      labels: ['sentinel', 'exploratory', fingerprint],
      files: files.map((f) => f.name),
      blocks: [
        { text: `Found by exploratory testing of ${repo} (${ctx.branch}@${ctx.sha.slice(0, 7)}). Severity: ${a.severity}.` },
        { heading: 'Environment' },
        { text: `${ctx.name}: ${ctx.baseUrl}` },
        { heading: 'Steps to reproduce' },
        { bullets: a.steps },
        { heading: 'Expected' },
        { text: a.expected },
        { heading: 'Actual' },
        { text: a.actual },
        { heading: 'Evidence' },
        { text: a.evidence },
      ],
    };
    inbox.human(key, { url: `#/runs/${ctx.run.id}`, title: `[Sentinel] ${a.title}`, reason: `${a.severity} · ${repo}: ${a.actual}`, card });
    queued.push(a.title);
  }
  return `${output.anomalies.length} anomalies, ${queued.length} sent to the inbox${queued.length ? ` (${queued.join('; ')})` : ''}. ${output.summary}`;
}

/** Turns an exploration finding waiting in the inbox into a Jira card on its project's board, with its evidence. */
export async function createExplorationCard(key: string, dryRun: boolean): Promise<{ key: string; url: string; created: boolean }> {
  const items = new Items('sentinel', dryRun);
  const item = items.get(key);
  const card = item?.data.card as CardDraft | undefined;
  if (!item || !card) throw new Error('Not an exploration finding');
  if (item.data.cardKey) return { key: String(item.data.cardKey), url: String(item.data.cardUrl), created: false };
  const project = read('projects').items.find((p) => p.name === card.project);
  if (!project?.boardId) throw new Error(`The project ${card.project} has no Jira board`);
  if (!jira.jiraStatus().ready) throw new Error('Jira is not configured (Integrations)');
  const projectKey = await jira.boardProject(project.boardId);
  const issue = await jira.createIssue(projectKey, read('agents.sentinel').bugIssueType, String(item.data.title), card.blocks, card.labels);
  const dir = join(env.paths.logs, 'runs', String(card.runId));
  const files = card.files
    .filter((f) => f === basename(f) && existsSync(join(dir, f)))
    .map((f) => ({ name: f, type: evidenceType(f), data: readFileSync(join(dir, f)) }));
  await jira.attach(issue, files).catch((err: Error) => log(`sentinel: attaching to ${issue} failed: ${err.message}`));
  const url = jira.browseUrl(issue);
  items.done(key, { ...item.data, cardKey: issue, cardUrl: url });
  return { key: issue, url, created: true };
}

/** The media type of an evidence file kept by the Sentinel; '' for anything else. */
const evidenceType = (f: string) =>
  f.endsWith('.png') ? 'image/png' : f.endsWith('.jpeg') || f.endsWith('.jpg') ? 'image/jpeg' : f.endsWith('.har') ? 'application/json' : f.endsWith('.log') ? 'text/plain' : '';

/** Writes the browser tool's config (Playwright MCP): headless, this environment's origin only, secrets masked, HAR recorded. */
function prepareBrowser(ctx: Context, label: string): { config: string; outDir: string; secretNames: string[] } {
  const outDir = join(ctx.run.logDir, `${label}-browser`);
  mkdirSync(outDir, { recursive: true });
  const secrets = flattenSecrets(ctx.secrets);
  // The secrets file (test-user credentials, never platform tokens) lives in /tmp only for the call's duration.
  const secretsFile = join(tmpdir(), `sentinel-${ctx.run.id}-${label}.env`);
  writeFileSync(secretsFile, Object.entries(secrets).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n'), { mode: 0o600 });
  const browserConfig = join(tmpdir(), `sentinel-${ctx.run.id}-${label}.json`);
  writeFileSync(browserConfig, JSON.stringify({ browser: { contextOptions: { recordHar: { path: join(outDir, 'session.har'), content: 'omit' } } } }));
  const config = join(tmpdir(), `sentinel-${ctx.run.id}-${label}-mcp.json`);
  const origin = new URL(ctx.baseUrl).origin;
  const args = [
    MCP_CLI, '--headless', '--isolated', '--no-sandbox', '--executable-path', BROWSER, '--ignore-roots',
    '--output-dir', outDir, '--allowed-origins', origin, '--secrets', secretsFile, '--config', browserConfig,
    '--console-level', 'warning', '--viewport-size', '1440x900',
  ];
  // Started inside the evidence folder: screenshots the model names land there, never in the checkout
  // (where the read-only guard would drop them).
  const quote = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;
  writeFileSync(config, JSON.stringify({ mcpServers: { playwright: { command: 'sh', args: ['-c', `cd ${quote(outDir)} && exec node ${args.map(quote).join(' ')}`] } } }));
  return { config, outDir, secretNames: Object.keys(secrets) };
}

/** Screenshots and the HAR the browser tool saved, ready to attach. The call's temporary files go first. */
function collectEvidence(ctx: Context, label: string, outDir: string): { name: string; type: string; data: Buffer }[] {
  for (const suffix of ['.env', '.json', '-mcp.json']) rmSync(join(tmpdir(), `sentinel-${ctx.run.id}-${label}${suffix}`), { force: true });
  if (!existsSync(outDir)) return [];
  const files: { name: string; type: string; data: Buffer }[] = [];
  for (const f of readdirSync(outDir)) {
    const p = join(outDir, f);
    if (!statSync(p).isFile()) continue;
    const type = evidenceType(f);
    if (!type || statSync(p).size > MAX_ATTACHMENT_BYTES) continue;
    // Flat in the run's folder too, so the run page lists them. Text evidence is cleaned of credentials first.
    const flat = join(ctx.run.logDir, `${label}-${f}`);
    if (type === 'application/json' || type === 'text/plain') {
      const secrets = Object.values(flattenSecrets(ctx.secrets));
      const text = readFileSync(p, 'utf8');
      let clean: string;
      try {
        clean = type === 'application/json' ? sanitizeHar(text, secrets) : maskSecrets(text, secrets);
      } catch {
        continue; // a HAR that cannot be read is not attached, rather than attached unclean
      }
      writeFileSync(flat, clean);
      rmSync(p, { force: true });
    } else {
      renameSync(p, flat);
    }
    files.push({ name: `${label}-${f}`, type, data: readFileSync(flat) });
  }
  return files.slice(-6);
}

/** Opens a bug on the project's board, or comments on the open one with the same label. */
async function fileBug(ctx: Context, label: string, title: string, blocks: jira.DocBlock[], files: { name: string; type: string; data: Buffer }[]): Promise<string> {
  const cfg = read('agents.sentinel');
  const summary = `[Sentinel] ${title}`;
  if (ctx.dryRun) {
    ctx.run.event('artifact', `Dry run: would file "${summary}" with ${files.length} attachment(s)`, { label, files: files.map((f) => f.name) });
    return `would file "${summary}"`;
  }
  // No Jira (or no board for this project): the bug waits in the inbox, with its evidence in the run.
  if (!ctx.project.boardId || !jira.jiraStatus().ready) {
    // Live runs only (a dry run never gets here), so it sits with the Sentinel's other live items.
    new Items('sentinel', false).human(`bug:${ctx.project.name}|${label}`, {
      url: `#/runs/${ctx.run.id}`,
      title: summary,
      reason: `${title}. ${files.length} attachment(s) in the run. Not filed: ${ctx.project.boardId ? 'Jira is not configured' : 'the project has no Jira board'}.`,
    });
    ctx.run.event('artifact', `Bug sent to the inbox (no Jira for this project): ${summary}`);
    return `sent to the inbox: "${summary}"`;
  }
  const projectKey = await jira.boardProject(ctx.project.boardId);
  const [open] = await jira.searchIssues(`project = "${projectKey}" AND labels = "sentinel" AND labels = "${label}" AND statusCategory != Done ORDER BY created DESC`);
  if (open) {
    await jira.comment(open.key, `${jira.BOT_MARK} Sentinel saw this again on ${ctx.name} (${ctx.branch}@${ctx.sha.slice(0, 7)}): ${title}`);
    await jira.attach(open.key, files).catch((err: Error) => ctx.run.event('warn', `Attaching to ${open.key} failed: ${err.message}`));
    ctx.run.event('artifact', `Commented on ${open.key}`, { url: jira.browseUrl(open.key) });
    return `seen again on ${open.key}`;
  }
  const key = await jira.createIssue(projectKey, cfg.bugIssueType, summary, blocks, ['sentinel', 'qa-e2e', label]);
  await jira.attach(key, files).catch((err: Error) => ctx.run.event('warn', `Attaching to ${key} failed: ${err.message}`));
  ctx.run.event('artifact', `Filed ${key}`, { url: jira.browseUrl(key) });
  log(`sentinel: filed ${key} for ${label}`);
  return `filed ${key}`;
}
