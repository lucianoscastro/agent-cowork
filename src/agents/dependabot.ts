import { outputLanguage, projectRepos, read } from '../config.ts';
import { Items, sql } from '../db.ts';
import { actionsLinks, failedLogTail, gh, ghJson } from '../integrations/github.ts';
import * as jira from '../integrations/jira.ts';
import { runProvider } from '../providers/index.ts';
import { withRun, type Run, type RunEnd } from '../runs.ts';
import { checkout, forEachLimit, log, removeCheckout, renderPrompt } from '../sh.ts';
import { runVerify, verifyCommandsFor } from './verify.ts';
import { takeForce } from './status.ts';
import { notify } from '../notify.ts';

type Check = { __typename?: string; status?: string; conclusion?: string; state?: string; name?: string; context?: string; detailsUrl?: string; targetUrl?: string };
type DepPr = {
  number: number;
  url: string;
  title: string;
  body: string;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  statusCheckRollup: Check[];
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  latestReviews?: { author?: { login: string }; authorAssociation?: string; state: string; body: string; submittedAt: string }[];
  commits?: { committedDate: string }[];
};
type Assessment = { decision: 'merge' | 'human'; risks: string[]; summary: string };
export type UpdateType = 'patch' | 'minor' | 'major';

/** How long a new PR may have no checks before that counts as "this repository runs none". */
const NO_CHECKS_GRACE_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const FOOTER = '\n\n---\n🤖 agentCowork Dependabot agent';
const SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['merge', 'human'] },
    risks: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['decision', 'risks', 'summary'],
};

export type Bump = { pkg: string; from: string; to: string };

/** "Bump foo from 1.2.3 to 1.3.0" (any prefix, optional "in /dir"). Grouped updates are not parsed. */
export function parseBump(title: string): Bump | undefined {
  const m = title.match(/\bbump (\S+) from v?(\S+) to v?(\S+?)(?:\s+in\s+\S+)?$/i);
  return m ? { pkg: m[1], from: m[2], to: m[3] } : undefined;
}

/**
 * Every package a Dependabot PR updates: the title for a single update, else each "Bumps/Updates/Updated `pkg`
 * from A to B" line of a grouped PR's body (quoted release notes ignored). Empty when the PR names a count of
 * updates ("with 3 updates") that doesn't match what was found: an update nobody read must not slip through.
 */
export function parseBumps(title: string, body: string): Bump[] {
  const single = parseBump(title);
  if (single) return [single];
  const found = new Map<string, Bump>();
  const own = body.split('\n').filter((l) => !l.trimStart().startsWith('>')).join('\n');
  const line = /\b(?:Bumps|Updates|Updated)\s+\[?`?([^\s`[\]()]+)`?\]?(?:\([^)]*\))?\s+from\s+v?(\d[\w.+-]*)\s+to\s+v?(\d[\w.+-]*)/gi;
  for (const m of own.matchAll(line)) {
    const strip = (v: string) => v.replace(/\.+$/, '');
    if (!found.has(m[1])) found.set(m[1], { pkg: m[1], from: strip(m[2]), to: strip(m[3]) });
  }
  const count = /with (\d+) updates?/i.exec(title);
  if (count && Number(count[1]) !== found.size) return [];
  return [...found.values()];
}

/** Semver distance. In 0.x a minor bump may break, so it counts as major; unparseable versions too. */
export function updateType(from: string, to: string): UpdateType {
  const parse = (v: string) => v.split(/[.+-]/).slice(0, 3).map((n) => Number(n));
  const [a, b] = [parse(from), parse(to)];
  if ([...a, ...b].some((n) => !Number.isInteger(n))) return 'major';
  if (a[0] !== b[0] || (a[0] === 0 && a[1] !== b[1])) return 'major';
  return a[1] !== b[1] ? 'minor' : 'patch';
}

const failed = (c: Check) => ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'].includes(c.conclusion ?? c.state ?? '');

/** 'pass', 'pending' or 'fail' for the PR's status checks (no checks counts as pass). */
export function checksState(checks: Check[]): 'pass' | 'pending' | 'fail' {
  const pending = (c: Check) =>
    c.__typename === 'CheckRun' ? c.status !== 'COMPLETED' : ['PENDING', 'EXPECTED'].includes(c.state ?? '');
  if (checks.some(failed)) return 'fail';
  return checks.some(pending) ? 'pending' : 'pass';
}

/** Publication date of a version, from the package registry when Dependabot's ecosystem has one. */
async function releaseDate(branch: string, pkg: string, version: string): Promise<string | undefined> {
  try {
    if (branch.startsWith('dependabot/npm_and_yarn/')) {
      const res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}`);
      return res.ok ? ((await res.json()) as { time?: Record<string, string> }).time?.[version] : undefined;
    }
    if (branch.startsWith('dependabot/nuget/')) {
      const url = `https://api.nuget.org/v3/registration5-gz-semver2/${pkg.toLowerCase()}/${version.toLowerCase()}.json`;
      const res = await fetch(url);
      return res.ok ? ((await res.json()) as { published?: string }).published : undefined;
    }
  } catch {
    // Registry unreachable: fall back to the PR date.
  }
  return undefined;
}

/** Agent B: assesses, approves and merges Dependabot PRs within the policy; everything else goes to a human. */
export async function pollDependabot(): Promise<void> {
  const cfg = read('agents.dependabot');
  const { dryRun } = read('agents.dependabot');
  const items = new Items('dependabot', dryRun);
  // Run now: every open Dependabot PR is assessed again, even a commit already handled.
  const force = takeForce('dependabot');
  for (const { repo } of projectRepos()) {
    let prs: DepPr[];
    try {
      prs = await ghJson<DepPr[]>([
        'pr', 'list', '--repo', repo, '--author', 'app/dependabot', '--state', 'open', '--limit', '50',
        '--json', 'number,url,title,body,headRefOid,headRefName,baseRefName,createdAt,statusCheckRollup,mergeable,latestReviews',
      ]);
      // Commits only for approved PRs: listing them for all 50 exceeds GitHub's 500,000-node GraphQL limit.
      for (const pr of prs) {
        if (pr.latestReviews?.some((r) => r.state === 'APPROVED')) pr.commits = (await ghJson<Pick<DepPr, 'commits'>>(['pr', 'view', pr.url, '--json', 'commits'])).commits;
      }
    } catch (err) {
      log(`dependabot: listing ${repo} failed:`, (err as Error).message);
      continue;
    }
    await forEachLimit(prs, cfg.concurrency, async (pr) => {
      // A person's approval is a new key, so a PR parked for a human is assessed again once someone approves it.
      const key = `${pr.url}@${pr.headRefOid}${approvers(pr).length ? '+approved' : ''}`;
      if (!force && items.skip(key)) return;
      const gate = await precheck(repo, pr, cfg.cooldownDays, cfg.allowedUpdates);
      if (gate.wait) return; // cooldown or CI still running: look again on a later poll
      const end = await withRun({ agent: 'dependabot', item: `${repo}#${pr.number}`, url: pr.url, title: pr.title, dryRun }, (run) =>
        handle(run, repo, pr, gate, dryRun),
      );
      if (end.status === 'done') items.done(key, { summary: end.summary });
      else if (end.status === 'waiting') items.human(key, { url: pr.url, title: pr.title, reason: end.summary });
      else if (end.status === 'killed') items.stopped(key, { url: pr.url, title: pr.title });
      else items.fail(key, end.summary ?? end.status);
    });
  }
}

const PEOPLE = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/**
 * Who approved the PR's current commit on GitHub (a developer, the operator), not counting this agent's own
 * approvals, which carry the agentCowork footer since the token may be the operator's own account. An approval
 * older than the last commit is stale: Dependabot may have moved the PR to another version since (a rebase too
 * needs a new approval).
 */
export function approvers(pr: Pick<DepPr, 'latestReviews' | 'commits'>): string[] {
  const head = pr.commits?.at(-1)?.committedDate;
  return (pr.latestReviews ?? [])
    .filter((r) => r.state === 'APPROVED' && !r.body.includes('🤖 agentCowork') && (!head || Date.parse(r.submittedAt) >= Date.parse(head)))
    // People with a say on the repository only: a bot or app approving would bypass the update policy.
    .filter((r) => PEOPLE.includes(r.authorAssociation ?? '') && !/\[bot\]$/i.test(r.author?.login ?? '[bot]'))
    .map((r) => r.author?.login ?? 'someone');
}

type Gate = { wait?: boolean; human?: string; rebase?: string; ciFailing?: string; bumps?: Bump[] };
const RANK: Record<UpdateType, number> = { patch: 0, minor: 1, major: 2 };

/** Platform rules that need no model: semver policy, cooldown, conflicts and CI state. */
async function precheck(repo: string, pr: DepPr, cooldownDays: number, allowed: string[]): Promise<Gate> {
  const bumps = parseBumps(pr.title, pr.body);
  if (!bumps.length) return { human: 'Unrecognized update (the packages and versions could not be read from the PR): a human must review it.' };
  const outside = bumps.filter((b) => !allowed.includes(updateType(b.from, b.to)));
  // A person who approved the PR accepted the updates outside the policy: it follows the normal flow.
  if (outside.length && !approvers(pr).length) {
    return { human: `${outside.map((b) => `${updateType(b.from, b.to)} update of ${b.pkg} (${b.from} → ${b.to})`).join('; ')}: outside the auto-merge policy.` };
  }
  const released = await Promise.all(bumps.map(async (b) => (await releaseDate(pr.headRefName, b.pkg, b.to)) ?? pr.createdAt));
  if (released.some((at) => Date.now() - Date.parse(at) < cooldownDays * DAY_MS)) return { wait: true };
  // Dependabot resolves its own conflicts when asked; the rebased commit is assessed from scratch.
  if (pr.mergeable === 'CONFLICTING') return { rebase: 'The PR conflicts with its base branch.' };
  // No checks at all is not a pass: CI may not have started yet, or the repository has none.
  if (!pr.statusCheckRollup?.length) {
    return Date.now() - Date.parse(pr.createdAt) < NO_CHECKS_GRACE_MS ? { wait: true } : { human: 'No CI checks ran on this PR: a human must review it.' };
  }
  const checks = checksState(pr.statusCheckRollup);
  if (checks === 'pending') return { wait: true };
  if (checks === 'fail') {
    // Dependabot can't fix code, only rebase: worth it when the base moved on (the fix may already be there).
    const behind = Number(await gh(['api', `repos/${repo}/compare/${encodeURIComponent(pr.baseRefName)}...${pr.headRefOid}`, '-q', '.behind_by']).catch(() => '0'));
    return behind > 0
      ? { rebase: `Required checks are failing and the branch is ${behind} commit(s) behind ${pr.baseRefName}: the fix may already be there.` }
      : { ciFailing: `Required checks are failing on a branch up to date with ${pr.baseRefName}, and Dependabot can't fix code.`, bumps };
  }
  return { bumps };
}

async function handle(run: Run, repo: string, pr: DepPr, gate: Gate, dryRun: boolean): Promise<RunEnd> {
  const cfg = read('agents.dependabot');
  const toHuman = async (reason: string): Promise<RunEnd> => {
    run.event('artifact', `Needs a human: ${reason}`);
    if (!dryRun) await gh(['pr', 'comment', pr.url, '--body', `${reason}${FOOTER}`]);
    return { status: 'waiting', summary: reason };
  };
  // Dependabot reads only a comment that is exactly its command. Its new commit is a new item, assessed from scratch.
  const askRebase = async (reason: string): Promise<RunEnd> => {
    run.event('artifact', `Asked Dependabot to rebase: ${reason}`);
    if (dryRun) return { status: 'done', summary: `would ask Dependabot to rebase: ${reason}` };
    await gh(['pr', 'comment', pr.url, '--body', '@dependabot rebase']);
    return { status: 'done', summary: `asked Dependabot to rebase: ${reason}` };
  };
  if (gate.human) return toHuman(gate.human);
  if (gate.rebase) return askRebase(gate.rebase);
  if (gate.ciFailing) {
    const card = cfg.failingCiCard ? await openFixCard(run, repo, pr, gate.bumps!, gate.ciFailing, dryRun) : undefined;
    return card ?? toHuman(`${gate.ciFailing} A person must fix it.`);
  }
  const bumps = gate.bumps!;
  const worst = bumps.map((b) => updateType(b.from, b.to)).sort((a, b) => RANK[b] - RANK[a])[0];

  run.stage('Checkout');
  const work = await checkout(
    repo,
    [`+refs/pull/${pr.number}/head:refs/remotes/pr/${pr.number}`, `+refs/heads/${pr.baseRefName}:refs/remotes/origin/${pr.baseRefName}`],
    pr.headRefOid,
  );
  try {
    const commands = verifyCommandsFor(repo);
    if (!commands?.length) return toHuman(`${repo} has no verify commands (Projects, or the stack's defaults in General): nothing proves the update builds.`);
    run.stage('Verify');
    const failure = await runVerify(run, work.dir, repo, commands);
    if (failure) return toHuman(`Verification failed:\n${failure}`);

    run.stage('Assess');
    const prompt = await renderPrompt('dependabot/assess', {
      url: pr.url,
      title: pr.title,
      body: pr.body.slice(0, 20_000),
      base: pr.baseRefName,
      updates: bumps.map((b) => `- \`${b.pkg}\` ${b.from} → ${b.to} (${updateType(b.from, b.to)})`).join('\n'),
      updateType: worst,
      fix: fixCardOf(pr, dryRun)
        ? `- CI failed on this update, so the Developer agent fixed it in ${fixCardOf(pr, dryRun)}, through a pull request into this branch that was reviewed on its own. Changes to code, tests or configuration from that fix are expected: check them only for how they use the updated packages.`
        : '',
      approval: approvers(pr).length
        ? `- ${approvers(pr).join(', ')} approved this PR on GitHub, accepting its ${worst} update. Breaking changes in the release notes are expected: report one as a risk only when it affects how this repository uses the package.`
        : '',
      language: outputLanguage(),
    });
    const { output } = await runProvider<Assessment>(cfg.provider, {
      run,
      label: 'assess',
      prompt,
      schema: SCHEMA,
      cwd: work.dir,
      mode: 'read-only',
      model: cfg.model,
    });
    run.event('artifact', `Assessment: ${output.decision}`, output);
    if (output.decision !== 'merge' || output.risks.length) {
      return toHuman(`${output.summary}\n\n${output.risks.map((r) => `- ${r}`).join('\n')}`);
    }
    if (dryRun) return { status: 'done', summary: `would approve and ${cfg.mergeMethod}-merge: ${output.summary}` };

    run.stage('Merge');
    await gh(['pr', 'review', pr.url, '--approve', '--body', `${output.summary}${FOOTER}`]);
    try {
      await gh(['pr', 'merge', pr.url, `--${cfg.mergeMethod}`, '--match-head-commit', pr.headRefOid]);
    } catch (err) {
      const message = (err as Error).message;
      // The base moved between the check and the merge: let Dependabot rebase instead of asking a person.
      if (/not mergeable|cannot be cleanly created|conflict/i.test(message)) return askRebase('Approved, but the merge hit a conflict with the base branch.');
      return toHuman(`Approved, but the merge was refused: ${message.slice(0, 300)}`);
    }
    run.event('artifact', `Merged with ${cfg.mergeMethod}`);
    notify('merged', { title: `Dependabot merged ${repo}#${pr.number}`, text: `${pr.title}: ${output.summary}`, url: pr.url, agent: 'dependabot' });
    return { status: 'done', summary: `approved and merged: ${output.summary}` };
  } finally {
    await removeCheckout(work);
  }
}

/** The fix card opened for this PR (its Jira key), if CI failed on it before. */
function fixCardOf(pr: DepPr, dryRun: boolean): string | undefined {
  return new Items('dependabot', dryRun).get(`card:${pr.url}`)?.data.key as string | undefined;
}

/**
 * The Dependabot branch a fix card works on: the Developer checks it out and opens its PR into it, so the update
 * merges once, through Dependabot's PR. Read from the record of the card's creation, never from the card's text.
 */
export function fixBranch(cardKey: string): { repo: string; branch: string } | undefined {
  const row = sql()
    .prepare("SELECT data FROM items WHERE key LIKE 'dependabot:card:%' AND json_extract(data, '$.key') = ?")
    .get(cardKey) as { data: string } | undefined;
  const data = row && (JSON.parse(row.data) as { repo?: string; branch?: string });
  return data?.repo && data.branch ? { repo: data.repo, branch: data.branch } : undefined;
}

/** The end of each failing Actions job's log (at most 3), for the card: the Developer plans without network access. */
async function failingLogs(repo: string, pr: DepPr): Promise<jira.DocBlock[]> {
  // Only this repository's runs: a check's link is set by whichever app reports it.
  const jobs = pr.statusCheckRollup.filter(failed).flatMap((c) => actionsLinks(c.detailsUrl ?? '', [repo]).map((link) => ({ name: c.name ?? 'job', link })));
  const blocks = await Promise.all(
    jobs.slice(0, 3).map(async ({ name, link }) => {
      const tail = await failedLogTail(link);
      return tail ? ([{ heading: `Log of ${name} (last lines)` }, { code: tail }] as jira.DocBlock[]) : [];
    }),
  );
  return blocks.flat();
}

/**
 * CI fails on an up-to-date PR: a card on the repository's project board so the Developer agent applies the update
 * and fixes what breaks (its PR supersedes Dependabot's, which closes by itself). One card per PR. Undefined when
 * there is no board or Jira, so the PR goes to a person instead.
 */
async function openFixCard(run: Run, repo: string, pr: DepPr, bumps: Bump[], reason: string, dryRun: boolean): Promise<RunEnd | undefined> {
  const cfg = read('agents.dependabot');
  const project = read('projects').items.find((p) => p.boardId && Object.values(p.repos).some((r) => r.repo === repo));
  if (!project?.boardId || !jira.jiraStatus().ready) return undefined;
  const items = new Items('dependabot', dryRun);
  const cardKey = `card:${pr.url}`;
  const existing = items.get(cardKey)?.data.key;
  if (existing) return { status: 'done', summary: `${reason} The Developer already has ${existing} for it.` };
  const updates = bumps.map((b) => `${b.pkg} ${b.from} → ${b.to} (${updateType(b.from, b.to)})`);
  const failing = pr.statusCheckRollup.filter(failed).map((c) => `${c.name ?? c.context ?? 'check'}: ${c.detailsUrl ?? c.targetUrl ?? 'no link'}`);
  const summary = `Fix CI for ${bumps.length === 1 ? `${bumps[0].pkg} ${bumps[0].to}` : `${bumps.length} dependency updates`} in ${repo}`;
  if (dryRun) return { status: 'done', summary: `would open "${summary}" on ${project.name}'s board for the Developer: ${reason}` };
  const description: jira.DocBlock[] = [
    { heading: 'What to do' },
    {
      text: `Dependabot's pull request ${pr.url} updates dependencies of ${repo}, but its required checks fail on a branch that is up to date with ${pr.baseRefName}. Dependabot can't fix code. The work starts from Dependabot's branch ${pr.headRefName}, which already has the update: fix the code, tests or configuration that break. The pull request goes into that branch; once it merges, Dependabot's pull request turns green and is merged as usual.`,
    },
    { heading: 'Updates' },
    { bullets: updates },
    { heading: 'Failing checks' },
    { bullets: failing.length ? failing : ['See the checks on the pull request.'] },
    ...(await failingLogs(repo, pr)),
  ];
  run.stage('Card');
  const key = await jira.createIssue(await jira.boardProject(project.boardId), cfg.cardIssueType, summary, description, [...cfg.cardLabels, 'dependabot-ci']);
  // The card's status is the Developer's trigger in some boards ("Ready for AI"); a missing transition is reported, not fatal.
  if (cfg.cardTransition) await jira.transition(key, cfg.cardTransition).catch((err: Error) => run.event('warn', err.message));
  const url = jira.browseUrl(key);
  items.done(cardKey, { key, url, repo, branch: pr.headRefName });
  await gh(['pr', 'comment', pr.url, '--body', `Required checks fail on this update and Dependabot can't fix code: opened ${url} for the Developer agent.${FOOTER}`]);
  run.event('artifact', `Opened ${key} for the Developer`, { key, url });
  return { status: 'done', summary: `opened ${key} for the Developer: ${reason}` };
}
