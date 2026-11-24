import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { outputLanguage, type Project, read, repoFolder, verifyCommands } from '../config.ts';
import type { Item, Items } from '../db.ts';
import { env } from '../env.ts';
import { gh, ghJson, PEOPLE } from '../integrations/github.ts';
import * as jira from '../integrations/jira.ts';
import { BOT_MARK } from '../integrations/jira.ts';
import { brainContext, learning } from '../brain.ts';
import { runProvider } from '../providers/index.ts';
import { withRun, type Run, type RunEnd } from '../runs.ts';
import { checkout, fetchBranches, log, pushBranch, removeCheckout, renderPrompt, run as sh, untrusted } from '../sh.ts';
import { checkDiff, refusedPush } from './diff-policy.ts';
import { BUILD_SCHEMA, type Built, describeRepo, NeedsInput, type RepoCheckout, verifyWithFixes } from './developer.ts';

/** A PR the developer opened and follows until it is merged or closed. */
export type WatchedPr = { repo: string; url: string; number: number; branch: string; base: string };

type Author = { login: string; __typename: string } | null;
type Note = { databaseId: number; body: string; author: Author; authorAssociation?: string; createdAt: string; url: string };
type Thread = { id: string; isResolved: boolean; path: string; line: number | null; comments: { nodes: Note[] } };
type CheckNode =
  | { __typename: 'CheckRun'; databaseId: number; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: 'StatusContext'; context: string; state: string; description: string | null; targetUrl: string | null };
export type PrSnapshot = {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headRefOid: string;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  checks: CheckNode[];
  threads: Thread[];
  comments: Note[];
};
export type PendingWork = { failing: CheckNode[]; running: boolean; conflict: boolean; threads: Thread[]; comments: Note[] };

type Reply = { id: string; action: 'fixed' | 'declined' | 'answered' | 'noted'; reply: string };
type FollowUp = { status: 'done' | 'needs_input'; summary: string; replies: Reply[] };
const FOLLOW_UP_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'needs_input'] },
    summary: { type: 'string' },
    replies: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, action: { type: 'string', enum: ['fixed', 'declined', 'answered', 'noted'] }, reply: { type: 'string' } },
        required: ['id', 'action', 'reply'],
      },
    },
  },
  required: ['status', 'summary', 'replies'],
};

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);
const ours = (n: Note) => n.body.includes(BOT_MARK);
/**
 * Who may steer the agent from a pull request: the repository's own people and the apps installed on it (review bots).
 * Anyone else's comment is ignored: on a public repository anyone can comment.
 */
const trusted = (n: Note) => n.author?.__typename === 'Bot' || PEOPLE.includes(n.authorAssociation ?? '');

/**
 * What still needs the developer on one PR. Exported for tests.
 * - Red checks, or a conflict with the base branch.
 * - Unresolved review threads whose last word is not the agent's (from people or review bots).
 * - Conversation comments and review bodies from people, newer than the last ones handled.
 */
export function pendingWork(s: PrSnapshot, handledUntil: string, handledNotes: number[] = []): PendingWork {
  const failing = s.checks.filter((c) => FAILED.has(c.__typename === 'CheckRun' ? (c.conclusion ?? '') : c.state));
  const running = s.checks.some((c) => (c.__typename === 'CheckRun' ? c.status !== 'COMPLETED' : c.state === 'PENDING' || c.state === 'EXPECTED'));
  // A thread comes back only when someone writes in it after the agent handled it.
  const threads = s.threads.filter((t) => {
    const last = t.comments.nodes.at(-1);
    return !t.isResolved && last !== undefined && !ours(last) && trusted(last) && !handledNotes.includes(last.databaseId);
  });
  const comments = s.comments.filter((c) => c.createdAt > handledUntil && c.body.trim() && !ours(c) && c.author?.__typename === 'User' && trusted(c));
  return { failing, running, conflict: s.mergeable === 'CONFLICTING', threads, comments };
}

const hasWork = (p: PendingWork) => p.failing.length > 0 || p.conflict || p.threads.length > 0 || p.comments.length > 0;
const hasPeople = (p: PendingWork) => p.threads.length > 0 || p.comments.length > 0;

const SNAPSHOT_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state headRefOid mergeable
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { databaseId name status conclusion detailsUrl }
        ... on StatusContext { context state description targetUrl }
      } } } } } }
      reviewThreads(first: 100) { nodes { id isResolved path line comments(first: 50) { nodes { databaseId body createdAt url authorAssociation author { login __typename } } } } }
      comments(last: 100) { nodes { databaseId body createdAt url authorAssociation author { login __typename } } }
      reviews(last: 50) { nodes { databaseId body createdAt url authorAssociation author { login __typename } } }
    }
  }
}`;

async function snapshot(pr: WatchedPr): Promise<PrSnapshot> {
  const [owner, name] = pr.repo.split('/');
  type Raw = {
    state: PrSnapshot['state'];
    headRefOid: string;
    mergeable: PrSnapshot['mergeable'];
    commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: CheckNode[] } } | null } }[] };
    reviewThreads: { nodes: Thread[] };
    comments: { nodes: Note[] };
    reviews: { nodes: Note[] };
  };
  const res = await ghJson<{ data: { repository: { pullRequest: Raw } } }>([
    'api', 'graphql', '-f', `query=${SNAPSHOT_QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${pr.number}`,
  ]);
  const p = res.data.repository.pullRequest;
  return {
    state: p.state,
    headRefOid: p.headRefOid,
    mergeable: p.mergeable,
    checks: p.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [],
    threads: p.reviewThreads.nodes,
    comments: [...p.comments.nodes, ...p.reviews.nodes],
  };
}

type Task = { project: Project; run: () => Promise<void> };

/** Checks every followed card's PRs and returns a follow-up run for those that need one. */
export async function followUpTasks(items: Items, projects: Project[], dryRun: boolean): Promise<Task[]> {
  const tasks: Task[] = [];
  for (const item of items.list('watching')) {
    const project = projects.find((p) => p.name === item.data.project);
    const prs = (item.data.prs ?? []) as WatchedPr[];
    try {
      const snaps = await Promise.all(prs.map(snapshot));
      if (snaps.every((s) => s.state !== 'OPEN')) {
        const merged = snaps.some((s) => s.state === 'MERGED');
        const { mergedTransition } = read('agents.developer');
        // Merged: the card moves on. Closed without a merge: someone else decides where it goes.
        if (merged && !dryRun) {
          try {
            await jira.comment(item.key, `${BOT_MARK} Pull requests merged:\n${prs.map((pr) => pr.url).join('\n')}`);
            if (mergedTransition) await jira.transition(item.key, mergedTransition);
          } catch (err) {
            // A card deleted meanwhile has nowhere to move; its PRs are done all the same.
            if (!jira.missing(err)) throw err;
          }
        }
        items.done(item.key, { ...item.data, closed: snaps.map((s, i) => `${prs[i].url}: ${s.state.toLowerCase()}`) });
        log(`developer: ${item.key} PRs ${merged ? 'merged' : 'closed'}, card done`);
        // How the PRs ended teaches too: why one was rejected, and what people corrected before merging.
        if (project && !dryRun) tasks.push({ project, run: () => learnFromOutcome(item, project, prs, snaps) });
        continue;
      }
      const open = prs.map((pr, i) => ({ pr, snap: snaps[i] })).filter(({ snap }) => snap.state === 'OPEN');
      const handledNotes = (item.data.handledNotes ?? []) as number[];
      const work = open.map(({ pr, snap }) => ({ pr, snap, pending: pendingWork(snap, String(item.data.handledUntil ?? ''), handledNotes) }));
      const people = work.some((w) => hasPeople(w.pending));
      const pipeline = work.some((w) => w.pending.failing.length > 0 || w.pending.conflict);
      const heads = work.map((w) => w.snap.headRefOid).join(',');
      if (!people && !pipeline) {
        // Green and answered (or still running): a later red pipeline starts a fresh round count.
        if (!work.some((w) => w.pending.running) && (item.data.rounds || item.data.parked)) items.watch(item.key, { ...item.data, rounds: 0, parked: false });
        continue;
      }
      // Parked after too many red rounds: only people bring it back. The same red head is not retried.
      if (!people && (item.data.parked || item.data.lastHead === heads)) continue;
      if (!project) {
        log(`developer: ${item.key} follows PRs of unknown project "${String(item.data.project)}"`);
        continue;
      }
      tasks.push({ project, run: () => followUp(items, item, project, work, heads, dryRun) });
    } catch (err) {
      log(`developer: checking the PRs of ${item.key} failed:`, (err as Error).message);
    }
  }
  return tasks;
}

async function followUp(
  items: Items,
  item: Item,
  project: Project,
  work: { pr: WatchedPr; snap: PrSnapshot; pending: PendingWork }[],
  heads: string,
  dryRun: boolean,
): Promise<void> {
  const cfg = read('agents.developer');
  const pipeline = work.some((w) => w.pending.failing.length > 0 || w.pending.conflict);
  // A person writing on a parked PR resumes it with a fresh round count.
  const rounds = (item.data.parked ? 0 : Number(item.data.rounds ?? 0)) + (pipeline ? 1 : 0);
  const notes = work.flatMap((w) => w.pending.threads.map((t) => t.comments.nodes.at(-1)!.databaseId));
  const newest = work.flatMap((w) => w.pending.comments.map((c) => c.createdAt)).reduce((a, b) => (a > b ? a : b), String(item.data.handledUntil ?? ''));
  const end = await withRun(
    { agent: 'developer', item: item.key, url: work[0].pr.url, title: `${project.name} · PR follow-up`, dryRun, timeoutMs: cfg.limits.runMinutes * 60_000, card: item.key },
    (run) =>
      rounds > cfg.limits.followUp
        ? park(run, work, rounds - 1)
        : learning(run, project.name, cfg.lead, dryRun, (signals) => attend(run, item.key, project, work.filter((w) => hasWork(w.pending)), signals)),
  );
  // Stopped from the UI counts as parked: it waits in the inbox until Retry or a new comment.
  const parked = end.status === 'parked' || end.status === 'waiting' || end.status === 'killed';
  items.watch(item.key, {
    ...item.data,
    handledUntil: newest,
    // ponytail: grows by one id per handled thread for the card's lifetime; tiny next to the PRs themselves.
    handledNotes: [...((item.data.handledNotes ?? []) as number[]), ...notes],
    lastHead: heads,
    rounds: parked ? rounds - 1 : rounds,
    parked,
    reason: end.status === 'killed' ? 'Stopped from the UI. Retry resumes following the PR.' : parked ? end.summary : undefined,
  });
}

type PrCommit = { sha: string; parents: unknown[]; commit: { message: string; author: { name: string; email: string } } };

/** Commits people pushed on the agent's branch: not the agent's or a bot's, and not merges that brought the base in. Exported for tests. */
export const peopleCommits = (commits: PrCommit[], agentEmail: string) =>
  commits.filter((c) => c.parents.length === 1 && c.commit.author.email !== agentEmail && !c.commit.author.email.includes('[bot]'));

/**
 * What people wrote on a PR after the agent last followed it up: comments and review bodies newer than the
 * last handled, and in each review thread what came after the last comment the agent handled. Exported for tests.
 */
export function saidSince(s: PrSnapshot, handledUntil: string, handledNotes: number[]): string[] {
  const person = (n: Note) => n.author?.__typename === 'User' && trusted(n) && !ours(n) && n.body.trim() !== '' && n.createdAt > handledUntil;
  return [
    ...s.comments.filter(person).map((n) => `- ${n.author!.login}: ${untrusted(n.body.slice(0, 1500))}`),
    ...s.threads.flatMap((t) => {
      const nodes = t.comments.nodes;
      const handled = nodes.findLastIndex((n) => handledNotes.includes(n.databaseId));
      return nodes.slice(handled + 1).filter(person).map((n) => `- ${n.author!.login} on ${t.path}${t.line ? `:${t.line}` : ''}: ${untrusted(n.body.slice(0, 1500))}`);
    }),
  ];
}

/**
 * Learns from how a card's PRs ended, as its own run, only when there is a lesson: a PR closed without a merge
 * where people said why, people's own commits on the agent's branch before the merge (the exact correction),
 * or what people wrote after the last follow-up. A plain merge teaches nothing.
 * ponytail: the first 100 commits of a PR, and the diffs of 5 of them; the lessons are in the first ones.
 */
async function learnFromOutcome(item: Item, project: Project, prs: WatchedPr[], snaps: PrSnapshot[]): Promise<void> {
  const cfg = read('agents.developer');
  const handledUntil = String(item.data.handledUntil ?? '');
  const handledNotes = (item.data.handledNotes ?? []) as number[];
  try {
    const signals: string[] = [];
    for (const [i, pr] of prs.entries()) {
      const snap = snaps[i];
      const said = saidSince(snap, handledUntil, handledNotes);
      if (snap.state === 'CLOSED' && said.length) signals.push(`${pr.url} was closed without being merged. What people wrote:\n${said.join('\n')}`);
      if (snap.state !== 'MERGED') continue;
      if (said.length) signals.push(`People wrote on ${pr.url} before it was merged:\n${said.join('\n')}`);
      const commits = peopleCommits(await ghJson<PrCommit[]>(['api', `repos/${pr.repo}/pulls/${pr.number}/commits?per_page=100`]), process.env.GIT_AUTHOR_EMAIL ?? '');
      const changes: string[] = [];
      for (const c of commits.slice(0, 5)) {
        const diff = await gh(['api', '-H', 'Accept: application/vnd.github.diff', `repos/${pr.repo}/commits/${c.sha}`]);
        changes.push(`- ${c.commit.author.name}: ${c.commit.message.split('\n')[0]}\n\`\`\`diff\n${diff.slice(0, 4000)}\n\`\`\``);
      }
      if (changes.length) signals.push(`People corrected the agent's work on ${pr.url} with their own commits before merging it:\n${changes.join('\n')}`);
    }
    if (!signals.length) return;
    const states = snaps.map((s, i) => `${prs[i].url} ${s.state.toLowerCase()}`).join(', ');
    await withRun({ agent: 'developer', item: item.key, url: prs[0].url, title: `${project.name} · PR outcome`, dryRun: false, card: item.key }, (run) =>
      learning(run, project.name, cfg.lead, false, async (collected) => {
        collected.push(...signals);
        return { status: 'done', summary: `Learned from how the pull requests ended: ${states}` };
      }),
    );
  } catch (err) {
    log(`developer: learning from the PRs of ${item.key} failed:`, (err as Error).message);
  }
}

/** Too many red rounds: says so on each PR and waits for a person. */
async function park(run: Run, work: { pr: WatchedPr }[], rounds: number): Promise<RunEnd> {
  const text = `${BOT_MARK} agentCowork could not get this PR green after ${rounds} rounds and needs a human. A new comment here brings it back.`;
  for (const { pr } of work) await gh(['pr', 'comment', pr.url, '--body', text]);
  run.event('artifact', 'Parked for a human', text);
  return { status: 'parked', summary: `The pipeline is still red after ${rounds} follow-up rounds.` };
}

async function attend(run: Run, key: string, project: Project, work: { pr: WatchedPr; snap: PrSnapshot; pending: PendingWork }[], signals: string[]): Promise<RunEnd> {
  const cfg = read('agents.developer');
  run.stage('Checkout');
  const workspace = join(env.paths.work, 'worktrees', `${key}-follow-${randomUUID().slice(0, 8)}`);
  const repos: (RepoCheckout & { pr: WatchedPr })[] = [];
  try {
    for (const { pr, pending } of work) {
      const projectRepo = Object.values(project.repos).find((r) => r.repo === pr.repo);
      const role = repoFolder(pr.repo);
      const co = await checkout(
        pr.repo,
        [`+refs/heads/${pr.branch}:refs/remotes/origin/${pr.branch}`, `+refs/heads/${pr.base}:refs/remotes/origin/${pr.base}`],
        `refs/remotes/origin/${pr.branch}`,
        { branch: pr.branch, dir: join(workspace, role) },
      );
      const r = { role, repo: pr.repo, base: pr.base, verify: projectRepo ? verifyCommands(projectRepo) : [], work: co, pr };
      repos.push(r);
      // A conflict is merged here; the lead resolves the markers and the platform commits the merge.
      if (pending.conflict) await sh('git', ['merge', '--no-commit', '--no-ff', `refs/remotes/origin/${pr.base}`], { cwd: co.dir }).catch(() => {});
    }

    run.stage('Gather');
    const sections = await Promise.all(work.map(async (w) => describeWork(w)));
    const vars = {
      key,
      repos: repos.map(describeRepo).join('\n'),
      work: sections.join('\n\n'),
      language: outputLanguage(),
      brain: await brainContext(project.name, workspace, sections.join('\n').slice(0, 4000), { cwd: workspace, dirs: repos.map((r) => r.work.dir) }),
    };
    // People's review comments are the strongest lesson: what this team expects from a change.
    const said = work.flatMap(({ pr, pending }) =>
      [...pending.threads.flatMap((t) => t.comments.nodes.map((n) => ({ n, where: `${t.path}${t.line ? `:${t.line}` : ''}` }))), ...pending.comments.map((n) => ({ n, where: '' }))]
        .filter(({ n }) => n.author?.__typename === 'User' && trusted(n) && !ours(n))
        .map(({ n, where }) => `- ${n.author!.login} on ${pr.repo}#${pr.number}${where ? ` (${where})` : ''}: ${untrusted(n.body.slice(0, 1500))}`),
    );
    if (said.length) signals.push(`People reviewed the pull requests:\n${said.join('\n')}`);
    const lead = (label: string, prompt: string) =>
      runProvider(cfg.lead.provider, { run, label, prompt, schema: label.startsWith('fix') ? BUILD_SCHEMA : FOLLOW_UP_SCHEMA, cwd: workspace, mode: 'write', model: cfg.lead.model });

    run.stage('Attend');
    const result = (await lead('follow-up', await renderPrompt('developer/follow-up', vars))).output as FollowUp;
    run.event('artifact', `Follow-up: ${result.status}`, result);
    const red = work.flatMap((w) => w.pending.failing.map((c) => (c.__typename === 'CheckRun' ? c.name : c.context)));
    if (red.length) signals.push(`The pull request pipeline was red (${red.join(', ')}); what the developer changed: ${result.summary}`);
    if (said.length) signals.push(`How the developer handled it: ${result.summary}\n${result.replies.map((r) => `- ${r.action}: ${r.reply.slice(0, 500)}`).join('\n')}`);
    if (result.status === 'needs_input') return await ask(run, work, result.summary);

    let failure: string | undefined;
    try {
      failure = await verifyWithFixes(run, key, 'Address PR feedback', repos, cfg.limits.verify, async (f, attempt) => {
        const fixed = (await lead(`fix-${attempt}`, await renderPrompt('developer/fix', { ...vars, project: project.name, summary: `feedback on its open PRs`, description: '', failure: f }))).output as Built;
        signals.push(`The must-pass commands failed:\n${f.slice(-1500)}\nThe fix: ${fixed.summary}`);
        return fixed;
      });
    } catch (err) {
      if (err instanceof NeedsInput) return await ask(run, work, err.message);
      throw err;
    }
    if (failure) return await ask(run, work, `Build or tests still fail locally after ${cfg.limits.verify} fix attempts, so nothing was pushed.\n\n${failure.slice(-1500)}`);

    run.stage('Push');
    // The platform's checks on what this push adds to each PR, all before any push: CI definitions and credentials stop it.
    const blocked: string[] = [];
    for (const r of repos) {
      await fetchBranches(r.work, r.pr.repo, [r.pr.base, r.pr.branch]);
      const checked = await checkDiff(r.work.dir, `refs/remotes/origin/${r.pr.base}`, { since: `refs/remotes/origin/${r.pr.branch}`, folder: repoFolder(r.pr.repo) });
      if (checked.blocked.length || checked.warnings.length) run.event('warn', `Platform checks on ${r.pr.url}`, checked);
      blocked.push(...checked.blocked);
    }
    if (blocked.length) return await ask(run, work, refusedPush(blocked));
    for (const r of repos) {
      const ahead = Number(await sh('git', ['rev-list', '--count', `refs/remotes/origin/${r.pr.branch}..HEAD`], { cwd: r.work.dir }));
      if (ahead > 0) {
        await pushBranch(r.work, r.pr.repo, r.pr.branch);
        run.event('artifact', `Pushed ${ahead} commit(s) to ${r.pr.url}`);
      }
    }

    run.stage('Reply');
    await postReplies(run, work, result.replies);
    return { status: 'done', summary: result.summary };
  } finally {
    for (const r of repos) await removeCheckout(r.work).catch(() => {});
    await rm(workspace, { recursive: true, force: true });
  }
}

/** Posts a question on each PR and parks until a person answers there. */
async function ask(run: Run, work: { pr: WatchedPr }[], text: string): Promise<RunEnd> {
  for (const { pr } of work) await gh(['pr', 'comment', pr.url, '--body', `${BOT_MARK} agentCowork needs a human to continue on this PR:\n\n${text}`]);
  run.event('artifact', 'Asked on the PR', text);
  return { status: 'waiting', summary: text };
}

/** The prompt's view of one PR: failing checks with their logs, open threads and new comments, each with an id. Exported for tests. */
export async function describeWork({ pr, pending }: { pr: WatchedPr; pending: PendingWork }): Promise<string> {
  const folder = repoFolder(pr.repo);
  const parts = [`### ${pr.url} (folder \`${folder}/\`, branch \`${pr.branch}\`)`];
  if (pending.conflict) parts.push(`- The branch conflicted with \`${pr.base}\`. The platform merged \`origin/${pr.base}\` into it: resolve every conflict marker.`);
  for (const c of pending.failing) parts.push(await failureDetails(pr.repo, c));
  for (const t of pending.threads) {
    const conversation = t.comments.nodes.filter(trusted).map((n) => `  - ${n.author?.login ?? 'unknown'}: ${untrusted(n.body.trim())}`).join('\n');
    parts.push(`- Review thread \`thread:${pr.repo}#${pr.number}:${t.id}:${t.comments.nodes.at(-1)!.databaseId}\` on \`${folder}/${t.path}${t.line ? `:${t.line}` : ''}\`:\n${conversation}`);
  }
  for (const c of pending.comments) parts.push(`- Comment \`comment:${pr.repo}#${pr.number}:${c.databaseId}\` by ${c.author?.login ?? 'unknown'}:\n  ${untrusted(c.body.trim())}`);
  return parts.join('\n');
}

const TAIL = 6000;

/** Why a check failed: the failed job log for GitHub Actions, the check's own report (Sonar and others) otherwise. */
async function failureDetails(repo: string, c: CheckNode): Promise<string> {
  if (c.__typename === 'StatusContext') return `- Failing status \`${c.context}\`: ${c.description ?? ''} ${c.targetUrl ?? ''}`;
  const actions = c.detailsUrl?.match(/\/actions\/runs\/(\d+)/);
  try {
    if (actions) {
      const logs = await gh(['run', 'view', actions[1], '--repo', repo, '--log-failed']);
      return `- Failing check \`${c.name}\` (GitHub Actions). Failed steps, last lines:\n\`\`\`\n${logs.slice(-TAIL)}\n\`\`\``;
    }
    type Out = { output: { title: string | null; summary: string | null; text: string | null } };
    const { output } = await ghJson<Out>(['api', `repos/${repo}/check-runs/${c.databaseId}`]);
    const notes = await ghJson<{ path: string; start_line: number; message: string }[]>(['api', `repos/${repo}/check-runs/${c.databaseId}/annotations`]).catch(() => []);
    const lines = notes.slice(0, 50).map((a) => `  - ${a.path}:${a.start_line} ${a.message}`).join('\n');
    const report = [output.title, output.summary, output.text].filter(Boolean).join('\n\n').slice(0, TAIL);
    return `- Failing check \`${c.name}\` (${c.detailsUrl ?? 'external'}):\n${report}${lines ? `\n  Annotations:\n${lines}` : ''}`;
  } catch (err) {
    return `- Failing check \`${c.name}\` (${c.detailsUrl ?? ''}); its details could not be read: ${(err as Error).message.slice(0, 200)}`;
  }
}

/** Replies in each thread and resolves it; answers conversation comments in one PR comment. */
async function postReplies(run: Run, work: { pr: WatchedPr }[], replies: Reply[]): Promise<void> {
  const conversation = new Map<string, string[]>();
  for (const r of replies) {
    const label = r.action === 'fixed' ? 'Fixed' : r.action === 'declined' ? 'Not changed' : 'Answer';
    const thread = r.id.match(/^thread:([\w.-]+\/[\w.-]+)#(\d+):([^:]+):(\d+)$/);
    const comment = r.id.match(/^comment:([\w.-]+\/[\w.-]+)#(\d+):(\d+)$/);
    try {
      // Only this card's PRs: an id the model made up for another PR is ignored.
      const own = (repo: string, number: string) => work.some(({ pr }) => pr.repo === repo && String(pr.number) === number);
      if (thread && own(thread[1], thread[2])) {
        if (r.reply.trim()) {
          const body = `${BOT_MARK} **${label}.** ${r.reply}`;
          await gh(['api', '-X', 'POST', `repos/${thread[1]}/pulls/${thread[2]}/comments/${thread[4]}/replies`, '-f', `body=${body}`]);
        }
        // Only a fix closes the thread; a declined suggestion or an answer stays open for the reviewer to judge.
        if (r.action === 'fixed') {
          await gh(['api', 'graphql', '-f', 'query=mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }', '-F', `id=${thread[3]}`]);
        }
      } else if (comment && own(comment[1], comment[2]) && r.action !== 'noted' && r.reply.trim()) {
        const url = `https://github.com/${comment[1]}/pull/${comment[2]}`;
        conversation.set(url, [...(conversation.get(url) ?? []), `- **${label}** (comment ${comment[3]}): ${r.reply}`]);
      }
    } catch (err) {
      run.event('warn', `Replying to ${r.id} failed: ${(err as Error).message.slice(0, 300)}`);
    }
  }
  for (const [url, lines] of conversation) {
    await gh(['pr', 'comment', url, '--body', `${BOT_MARK} agentCowork addressed the comments:\n\n${lines.join('\n')}`]);
  }
  run.event('artifact', `Replied to ${replies.filter((r) => r.action !== 'noted').length} item(s)`);
}
