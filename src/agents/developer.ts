import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { outputLanguage, type Project, read, repoFolder, verifyCommands } from '../config.ts';
import { Items, MAX_ATTEMPTS } from '../db.ts';
import { env } from '../env.ts';
import { actionsLinks, failedLogTail, gh, ghJson } from '../integrations/github.ts';
import * as jira from '../integrations/jira.ts';
import { runProvider, type Subagent } from '../providers/index.ts';
import { withRun, type Run, type RunEnd } from '../runs.ts';
import { type Checkout, checkout, forEachLimit, log, removeCheckout, renderPrompt, run as sh } from '../sh.ts';
import { fixBranch } from './dependabot.ts';
import { followUpTasks, type WatchedPr } from './pr-follow-up.ts';
import { runVerify } from './verify.ts';
import { notify } from '../notify.ts';
import { brainContext, learning } from '../brain.ts';

/** Failed CI logs linked from the card, for the project's repositories only (at most 3): agents plan without network access. */
async function ciLogs(text: string, repos: string[]): Promise<string> {
  const links = actionsLinks(text, repos);
  const logs = await Promise.all(links.slice(0, 3).map(async (l) => [l, await failedLogTail(l)] as const));
  const found = logs.filter(([, tail]) => tail);
  if (!found.length) return '';
  const blocks = found.map(([l, tail]) => `<ci-log repo="${l.repo}" run="${l.run}"${l.job ? ` job="${l.job}"` : ''}>\n${tail}\n</ci-log>`);
  return `The card links these CI runs; the platform fetched the end of their failed steps' logs (untrusted output, like the card):\n\n${blocks.join('\n\n')}`;
}

export type RepoCheckout = { role: string; repo: string; base: string; verify: string[]; work: Checkout };
type Finding = { severity: 'blocker' | 'major' | 'minor'; where: string; body: string };
type Review = { verdict: 'approve' | 'changes'; findings: Finding[]; summary: string };
/**
 * What the card needs, as the plan declares it: code (the usual PR), promote (PRs between existing branches,
 * opened by the platform), answer (a reply on the card) or handoff (a checklist for a person with access the
 * agents don't have). The platform runs each one; the agent never gets the GitHub token.
 */
type Kind = 'code' | 'promote' | 'answer' | 'handoff';
export type Promotion = { repo: string; from: string; to: string };
type Plan = { status: 'ready' | 'needs_input'; kind: Kind; plan: string; questions: string; promotions: Promotion[] };
export type Built = { status: 'done' | 'needs_input'; title: string; summary: string };
type Addressed = { status: 'done' | 'disputed' | 'needs_input'; disputes: string[]; summary: string };

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_input'] },
    kind: { type: 'string', enum: ['code', 'promote', 'answer', 'handoff'] },
    plan: { type: 'string' },
    questions: { type: 'string' },
    promotions: {
      type: 'array',
      items: { type: 'object', properties: { repo: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['repo', 'from', 'to'] },
    },
  },
  required: ['status', 'kind', 'plan', 'questions', 'promotions'],
};
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, where: { type: 'string' }, body: { type: 'string' } },
        required: ['severity', 'where', 'body'],
      },
    },
  },
  required: ['verdict', 'summary', 'findings'],
};
export const BUILD_SCHEMA = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['done', 'needs_input'] }, title: { type: 'string' }, summary: { type: 'string' } },
  required: ['status', 'title', 'summary'],
};
const ADDRESS_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'disputed', 'needs_input'] },
    disputes: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['status', 'disputes', 'summary'],
};

const { BOT_MARK } = jira;
/** A review counts as passed when nothing blocking or major is left. */
export const reviewPasses = (r: Review) => r.verdict === 'approve' || !r.findings.some((f) => f.severity !== 'minor');
/** One verdict from several reviews: it passes only when each review passes, with every finding kept. Exported for tests. */
export function mergeReviews(reviews: Review[]): Review {
  if (reviews.length === 1) return reviews[0];
  return {
    verdict: reviews.every(reviewPasses) ? 'approve' : 'changes',
    findings: reviews.flatMap((r) => r.findings),
    summary: reviews.map((r) => r.summary).join(' '),
  };
}
const formatFindings = (findings: Finding[]) => findings.map((f) => `- [${f.severity}] ${f.where}: ${f.body}`).join('\n');

/** Agent A: turns agent-ready Jira cards into verified, independently reviewed draft PRs. */
export async function pollDeveloper(): Promise<void> {
  const cfg = read('agents.developer');
  const { dryRun } = read('agents.developer');
  const items = new Items('developer', dryRun);
  const projects = read('projects').items;
  const waiting = items.list('waiting');
  // Failed on a provider limit (no attempt used): back in the queue once the provider is available again,
  // whatever the card's status now (a resumed card sits in Blocked or In Progress, outside the trigger JQL).
  const limited = items.list('failed').filter((f) => f.attempts < MAX_ATTEMPTS && f.data.project);
  const waitingKeys = new Set(waiting.map((w) => w.key));
  const queue = new Map<string, Project>();
  // ponytail: one board search per project per poll; fine for a handful of projects.
  for (const project of projects) {
    if (!project.boardId) continue;
    for (const key of await jira.searchBoard(project.boardId, cfg.triggerJql)) {
      if (!waitingKeys.has(key) && !queue.has(key) && !items.skip(key)) queue.set(key, project);
    }
  }
  // Cards waiting for a human resume only when someone answers on the card.
  for (const f of limited) {
    const project = projects.find((p) => p.name === f.data.project);
    if (!project || queue.has(f.key)) continue;
    try {
      if ((await jira.getIssue(f.key)).fields.status.statusCategory.key === 'done') items.done(f.key, { closed: true });
      else queue.set(f.key, project);
    } catch (err) {
      log(`developer: checking ${f.key} after a provider limit failed:`, (err as Error).message);
    }
  }
  for (const w of waiting) {
    try {
      const issue = await jira.getIssue(w.key);
      const project = projects.find((p) => p.name === w.data.project);
      if (issue.fields.status.statusCategory.key === 'done') items.done(w.key, { closed: true });
      else if (project && (w.data.resume || jira.hasAnswer(issue.fields.comment.comments, String(w.data.waitingSince)))) queue.set(w.key, project);
    } catch (err) {
      log(`developer: checking ${w.key} for an answer failed:`, (err as Error).message);
    }
  }
  const tasks = [...queue].map(([key, project]) => ({ project, run: () => handle(items, key, project, dryRun) }));
  // Open PRs of earlier cards: answer new comments and fix a red pipeline until each PR closes.
  tasks.push(...(await followUpTasks(items, projects, dryRun)));
  // Each card has its own worktree and branch, so cards of one project run in parallel too; two PRs touching
  // the same files may conflict after the first merges, which the PR follow-up handles.
  await forEachLimit(tasks, cfg.concurrency, ({ run }) => run());
}

async function handle(items: Items, key: string, project: Project, dryRun: boolean): Promise<void> {
  const cfg = read('agents.developer');
  const end = await withRun(
    { agent: 'developer', item: key, url: jira.browseUrl(key), title: project.name, dryRun, timeoutMs: cfg.limits.runMinutes * 60_000 },
    (run) => learning(run, project.name, cfg.lead, dryRun, (signals) => work(run, key, project, dryRun, signals)),
  );
  const prs = (end.data?.prs ?? []) as WatchedPr[];
  if (end.status === 'done' && prs.length) {
    // The card is not finished while its PRs are open: keep them green and answered until they close.
    items.watch(key, { project: project.name, prs, url: prs[0].url, title: key, summary: end.summary, handledUntil: new Date().toISOString(), rounds: 0 });
  } else if (end.status === 'done') items.done(key, { summary: end.summary });
  else if (end.status === 'waiting' || end.status === 'parked') {
    // url and title: the Inbox links the card, where the answer goes.
    items.wait(key, { project: project.name, url: jira.browseUrl(key), title: key, reason: end.summary, waitingSince: end.data?.waitingSince ?? new Date().toISOString() });
  } else if (end.status === 'killed') {
    items.stopped(key, { project: project.name, url: jira.browseUrl(key), title: key });
  } else {
    items.fail(key, end.summary ?? end.status, { project: project.name, url: jira.browseUrl(key), title: key });
    if (!dryRun) {
      // The reason goes on the card: the next run reads the discussion, and a bare "failed" reads as the code's fault.
      const reason = (end.summary ?? '').split('\n')[0].slice(0, 300);
      await jira.comment(key, `${BOT_MARK} agentCowork could not finish this card (${end.status})${reason ? `: ${reason}` : ''}. See the run log.`).catch(() => {});
    }
  }
}

async function work(run: Run, key: string, project: Project, dryRun: boolean, signals: string[]): Promise<RunEnd> {
  const cfg = read('agents.developer');
  const language = outputLanguage();
  const issue = await jira.getIssue(key);
  if (!dryRun && cfg.startTransition) await jira.transition(key, cfg.startTransition);

  /** Posts to the card, moves it to Blocked, and ends the run waiting for a human comment. */
  const block = async (status: 'waiting' | 'parked', text: string, intro?: string): Promise<RunEnd> => {
    run.event('artifact', status === 'waiting' ? 'Asked on the card' : 'Parked for a human', text);
    if (dryRun) return { status, summary: text, data: { waitingSince: new Date().toISOString() } };
    intro ??= status === 'waiting'
      ? 'agentCowork needs more information to continue. Reply in a comment and it will resume.'
      : 'agentCowork stopped and needs a human. Reply in a comment to resume, or take the card over.';
    const { created } = await jira.comment(key, `${BOT_MARK} ${intro}\n\n${text}`);
    if (cfg.blockedTransition) await jira.transition(key, cfg.blockedTransition);
    return { status, summary: text, data: { waitingSince: created } };
  };

  run.stage('Intake');
  const workspace = join(env.paths.work, 'worktrees', `${key}-${randomUUID().slice(0, 8)}`);
  const branch = `ai/${key}`;
  const repos: RepoCheckout[] = [];
  try {
    const fix = fixBranch(key);
    for (const r of Object.values(project.repos)) {
      const { repo } = r;
      const role = repoFolder(repo);
      const verify = verifyCommands(r);
      // A Dependabot fix card works on Dependabot's branch, and its PR goes into it.
      const base =
        (fix?.repo === repo ? fix.branch : '') ||
        project.baseBranch || cfg.baseBranch || (await gh(['repo', 'view', repo, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name']));
      const work = await checkout(repo, [`+refs/heads/${base}:refs/remotes/origin/${base}`], `refs/remotes/origin/${base}`, {
        branch,
        dir: join(workspace, role),
      });
      repos.push({ role, repo, base, verify, work });
    }
    const description = jira.adfToText(issue.fields.description);
    const comments = jira.formatComments(issue.fields.comment.comments);
    const people = issue.fields.comment.comments.filter((c) => !jira.adfToText(c.body).trimStart().startsWith(BOT_MARK));
    if (people.length) signals.push(`People wrote on card ${key}:\n${jira.formatComments(people).slice(-6000)}`);
    const vars: Record<string, string> = {
      key,
      project: project.name,
      repos: repos.map(describeRepo).join('\n'),
      summary: issue.fields.summary,
      description,
      comments,
      toolchain: await toolchain(),
      ciLogs: await ciLogs(`${description}\n${comments}`, repos.map((r) => r.repo)),
      language,
      reviewContext: '',
      plan: '',
      brain: await brainContext(project.name, workspace, `${issue.fields.summary}\n${description}`),
    };
    const lead = (label: string, prompt: string, schema: object, mode: 'read-only' | 'write', subagents?: Record<string, Subagent>) =>
      runProvider(cfg.lead.provider, { run, label, prompt, schema, cwd: workspace, mode, model: cfg.lead.model, subagents });
    // The independent reviewers that are on (none, one or both) review in parallel; with both, each must pass.
    const reviewers = [cfg.reviewer, cfg.secondReviewer].map((r, i) => ({ ...r, i })).filter((r) => r.enabled);
    // A reviewer falling back takes the lead's or the other reviewer's provider only when no other is left.
    const avoid = [cfg.lead.provider, ...reviewers.map((r) => r.provider)];
    const reviewer = async (label: string, prompt: string): Promise<{ output: Review }> => {
      const reviews = await Promise.all(
        reviewers.map(async (r) => {
          const tag = r.i === 0 ? '' : '-2nd';
          const { output } = await runProvider<Review>(r.provider, { run, label: `${label}${tag}`, prompt, schema: REVIEW_SCHEMA, cwd: workspace, mode: 'read-only', model: r.model, avoid });
          return { ...output, findings: output.findings.map((f) => (r.i === 0 ? f : { ...f, body: `[second reviewer] ${f.body}` })) };
        }),
      );
      return { output: mergeReviews(reviews) };
    };

    // --- Plan, with a bounded plan review by the independent reviewer ---
    run.stage('Plan');
    let plan = (await lead('plan-1', await renderPrompt('developer/plan', vars), PLAN_SCHEMA, 'read-only')).output as Plan;
    for (let round = 1; ; round++) {
      if (plan.status === 'needs_input') return await block('waiting', plan.questions);
      // The reviewer judges the kind too: a promotion or a handoff must not stand in for a code change.
      vars.plan = plan.kind === 'code' ? plan.plan : `Kind: ${plan.kind}${plan.promotions.map((p) => `\n- promote ${p.repo}: ${p.from} → ${p.to}`).join('')}\n\n${plan.plan}`;
      if (round > cfg.limits.planReview || !reviewers.length) break;
      run.stage(`Plan review ${round}`);
      const review = (await reviewer(`review-plan-${round}`, await renderPrompt('developer/review-plan', vars))).output;
      run.event('artifact', `Plan review ${round}: ${review.verdict}`, review);
      if (reviewPasses(review)) break;
      if (round === cfg.limits.planReview) {
        return await block('parked', `The reviewer still requests plan changes after ${round} rounds:\n\n${formatFindings(review.findings)}`);
      }
      signals.push(`The plan reviewer asked for changes (the plan was revised):\n${formatFindings(review.findings)}`);
      vars.reviewContext = `The independent reviewer asked for changes to your previous plan. Revise it.\n\n<previous_plan>\n${plan.plan}\n</previous_plan>\n\n<review_findings>\n${formatFindings(review.findings)}\n</review_findings>`;
      plan = (await lead(`plan-${round + 1}`, await renderPrompt('developer/plan', vars), PLAN_SCHEMA, 'read-only')).output as Plan;
    }

    if (plan.kind === 'answer') {
      run.event('artifact', 'Answer', plan.plan);
      if (!dryRun) {
        await jira.comment(key, `${BOT_MARK} agentCowork's answer (no code change was needed):\n\n${plan.plan}`);
        if (cfg.doneTransition) await jira.transition(key, cfg.doneTransition);
      }
      return { status: 'done', summary: `${dryRun ? 'would answer' : 'answered'} on the card` };
    }
    if (plan.kind === 'handoff') {
      return await block('parked', plan.plan, 'agentCowork cannot do this part: it needs a person with access the agents do not have. Nothing to answer: do the checklist below, then comment on the card when it is done (it resumes) or move the card on.');
    }
    if (plan.kind === 'promote') {
      run.stage('Promote');
      const { urls, synced } = await openPromotions(run, key, project, plan.promotions, plan.plan, dryRun);
      const text = [
        urls.length && `Pull requests opened from the existing branches (nothing was merged):\n${urls.join('\n')}`,
        synced.length && `Nothing to promote:\n${synced.map((s) => `- ${s}`).join('\n')}`,
      ].filter(Boolean).join('\n\n');
      run.event('artifact', `Promotion${dryRun ? ' (dry run)' : ''}`, text);
      if (!dryRun) {
        await jira.comment(key, `${BOT_MARK} ${text}\n\n${plan.plan}`);
        if (urls.length) notify('pr', { title: `Developer opened ${urls.length === 1 ? 'a promotion pull request' : `${urls.length} promotion pull requests`} for ${key}`, text: urls.join('\n'), url: urls[0], agent: 'developer' });
        if (cfg.doneTransition) await jira.transition(key, cfg.doneTransition);
      }
      // Not watched by the PR follow-up: its fixes would push to the source branch itself.
      return { status: 'done', summary: `${dryRun ? 'would promote' : 'promoted'}: ${urls.join(', ') || 'already in sync'}` };
    }

    // --- Build ---
    run.stage('Build');
    const subagents =
      cfg.lead.provider === 'claude'
        ? {
            coder: { description: 'Implements one well-defined step of the approved plan in the given files.', prompt: await renderPrompt('developer/agents/coder', {}), model: cfg.coderModel || undefined },
            tester: { description: 'Writes and runs tests for one change of the approved plan.', prompt: await renderPrompt('developer/agents/tester', {}), model: cfg.testerModel || undefined },
          }
        : undefined;
    const built = (await lead('build', await renderPrompt('developer/implement', vars), BUILD_SCHEMA, 'write', subagents)).output as Built;
    if (built.status === 'needs_input') return await block('waiting', built.summary);

    // --- Verify: the platform runs the commands; the lead fixes failures, a bounded number of times ---
    const verifyLoop = (title: string) =>
      verifyWithFixes(run, key, title, repos, cfg.limits.verify, async (failure, attempt) => {
        const fixed = (await lead(`fix-${attempt}`, await renderPrompt('developer/fix', { ...vars, failure }), BUILD_SCHEMA, 'write', subagents)).output as Built;
        signals.push(`The must-pass commands failed:\n${failure.slice(-1500)}\nThe fix: ${fixed.summary}`);
        return fixed;
      });
    let failure: string | undefined;
    try {
      failure = await verifyLoop(built.title);
    } catch (err) {
      if (err instanceof NeedsInput) return await block('waiting', err.message);
      throw err;
    }
    if (failure) return await block('parked', `Build or tests still fail after ${cfg.limits.verify} fix attempts, so no PR was opened.\n\n${failure}`);
    if (!(await anyChanged(repos))) return await block('waiting', `No code changes were needed or made.\n\n${built.summary}`);

    // --- Diff review by the independent reviewer; the lead fixes or disputes, bounded ---
    let notes: Finding[] = [];
    for (let round = 1; round <= cfg.limits.diffReview && reviewers.length; round++) {
      run.stage(`Diff review ${round}`);
      const review = (await reviewer(`review-diff-${round}`, await renderPrompt('developer/review-diff', vars))).output;
      run.event('artifact', `Diff review ${round}: ${review.verdict}`, review);
      if (reviewPasses(review)) {
        notes = review.findings;
        break;
      }
      if (round === cfg.limits.diffReview) {
        return await block('parked', `The reviewer still has findings after ${round} rounds:\n\n${formatFindings(review.findings)}`);
      }
      run.stage(`Address review ${round}`);
      const addressed = (await lead(`address-${round}`, await renderPrompt('developer/address-review', { ...vars, findings: formatFindings(review.findings) }), ADDRESS_SCHEMA, 'write', subagents)).output as Addressed;
      if (addressed.status === 'needs_input') return await block('waiting', addressed.summary);
      if (addressed.status === 'done') signals.push(`The diff reviewer's findings, fixed by the author:\n${formatFindings(review.findings)}\nHow: ${addressed.summary}`);
      if (addressed.status === 'disputed') {
        return await block('parked', `The author disputes the reviewer's findings; a human must decide.\n\nFindings:\n${formatFindings(review.findings)}\n\nAuthor's position:\n${addressed.disputes.map((d) => `- ${d}`).join('\n')}`);
      }
      try {
        failure = await verifyLoop('Address review findings');
      } catch (err) {
        if (err instanceof NeedsInput) return await block('waiting', err.message);
        throw err;
      }
      if (failure) return await block('parked', `Build or tests fail after addressing the review.\n\n${failure}`);
    }

    // --- Ship ---
    run.stage('Ship');
    // The minor findings left (manual checks included) reach the person who reviews the PR.
    const body = notes.length ? `${built.summary}\n\n## Reviewer notes\n\n${formatFindings(notes)}` : built.summary;
    const urls: string[] = [];
    const prs: WatchedPr[] = [];
    // Before any push: a branch of that name holding someone else's commits stops the card, in every repository.
    for (const r of repos) {
      if ((await commitsAhead(r)) === 0) continue;
      const foreign = await foreignCommits(r.repo, r.base, branch);
      if (foreign) return await block('parked', `The branch \`${branch}\` in ${r.repo} already has commits by ${foreign}, so it was not overwritten. Rename or delete that branch and comment here to resume, or take the card over.`);
    }
    for (const r of repos) {
      if ((await commitsAhead(r)) === 0) continue;
      const url = await publish(run, key, branch, r, built.title, body, dryRun);
      urls.push(url);
      if (!dryRun) prs.push({ repo: r.repo, url, number: Number(url.split('/').pop()), branch, base: r.base });
    }
    run.event('artifact', `Pull requests${dryRun ? ' (dry run)' : ''}`, urls);
    if (!dryRun) {
      await jira.comment(key, `${BOT_MARK} Pull requests opened:\n${urls.join('\n')}\n\n${body}`);
      notify('pr', { title: `Developer opened ${urls.length === 1 ? 'a pull request' : `${urls.length} pull requests`} for ${key}`, text: `${built.title}\n${urls.join('\n')}`, url: urls[0], agent: 'developer' });
      if (cfg.doneTransition) await jira.transition(key, cfg.doneTransition);
    }
    return { status: 'done', summary: `${dryRun ? 'would open' : 'opened'} ${urls.join(', ')}: ${built.title}`, data: { prs } };
  } finally {
    for (const r of repos) await removeCheckout(r.work).catch(() => {});
    await rm(workspace, { recursive: true, force: true });
  }
}

export class NeedsInput extends Error {}

const BRANCH = /^\w[\w./-]{0,200}$/;
/** Whether a promotion the plan declared is a pair of branch names of this project's repositories. Exported for tests. */
export const validPromotion = (project: Project, p: Promotion): boolean =>
  Object.values(project.repos).some((r) => r.repo === p.repo) && BRANCH.test(p.from) && BRANCH.test(p.to) && !p.from.includes('..') && !p.to.includes('..') && p.from !== p.to;

/**
 * Opens (or reuses) one PR per declared promotion, from one existing branch into another of the same
 * repository, with the plan as its description; never merges or pushes. GitHub's compare also proves both
 * branches exist. A pair already in sync is reported, not opened.
 */
async function openPromotions(run: Run, key: string, project: Project, promotions: Promotion[], body: string, dryRun: boolean): Promise<{ urls: string[]; synced: string[] }> {
  const cfg = read('agents.developer');
  // ponytail: at most 10 PRs per card; a larger promotion is split into cards.
  if (!promotions.length || promotions.length > 10) throw new Error(`The plan declared ${promotions.length} promotions; between 1 and 10 are allowed`);
  const bad = promotions.filter((p) => !validPromotion(project, p));
  if (bad.length) throw new Error(`Not a pair of branches of this project's repositories: ${bad.map((p) => `${p.repo} ${p.from} → ${p.to}`).join(', ')}`);
  const urls: string[] = [];
  const synced: string[] = [];
  for (const p of promotions) {
    const ahead = Number(await gh(['api', `repos/${p.repo}/compare/${encodeURIComponent(p.to)}...${encodeURIComponent(p.from)}`, '-q', '.ahead_by']));
    if (!ahead) {
      synced.push(`${p.repo}: \`${p.to}\` already has every commit of \`${p.from}\``);
      continue;
    }
    if (dryRun) {
      urls.push(`${p.repo} ${p.from} → ${p.to} (dry run)`);
      continue;
    }
    const existing = await gh(['pr', 'list', '--repo', p.repo, '--head', p.from, '--base', p.to, '--state', 'open', '--json', 'url', '-q', '.[0].url']);
    const url =
      existing ||
      (await gh([
        'pr', 'create', '--repo', p.repo, '--base', p.to, '--head', p.from,
        '--title', `${key}: Sync ${p.from} → ${p.to}`,
        '--body', `${body}\n\n---\n${BOT_MARK} Generated by agentCowork from ${key}`,
        ...(cfg.draft ? ['--draft'] : []),
      ]));
    run.event('artifact', `${existing ? 'Reused' : 'Opened'} ${url}`);
    urls.push(url);
  }
  return { urls, synced };
}

/** Commits and verifies; on a red result asks `fix` and tries again, up to `limit` times. Returns the last failure. */
export async function verifyWithFixes(
  run: Run,
  key: string,
  title: string,
  repos: RepoCheckout[],
  limit: number,
  fix: (failure: string, attempt: number) => Promise<Built>,
): Promise<string | undefined> {
  let failure = await commitAndVerify(run, key, title, repos);
  for (let attempt = 1; failure && attempt <= limit; attempt++) {
    run.stage(`Fix ${attempt}`);
    const fixed = await fix(failure, attempt);
    if (fixed.status === 'needs_input') throw new NeedsInput(fixed.summary);
    failure = await commitAndVerify(run, key, 'Fix build and tests', repos);
  }
  return failure;
}

let toolchainCache: Promise<string> | undefined;
/** The versions the must-pass commands run with, so a plan doesn't guess what the platform has installed. */
function toolchain(): Promise<string> {
  const version = (cmd: string, args: string[]) => sh(cmd, args).then((out) => out.trim(), () => 'not installed');
  toolchainCache ??= Promise.all([
    version('node', ['--version']),
    version('pnpm', ['--version']),
    version('dotnet', ['--list-sdks']).then((out) => out.split('\n').map((l) => l.split(' ')[0]).join(', ')),
  ]).then(([node, pnpm, dotnet]) => `Node ${node}, pnpm ${pnpm}, .NET SDK ${dotnet}`);
  return toolchainCache;
}

export function describeRepo(r: RepoCheckout): string {
  const checks = r.verify.length ? `; must pass: ${r.verify.map((c) => `\`${c}\``).join(', ')}` : '';
  return `- \`${r.role}/\`: ${r.repo}, base \`origin/${r.base}\`${checks}`;
}

export async function commitsAhead({ base, work }: RepoCheckout): Promise<number> {
  return Number(await sh('git', ['rev-list', '--count', `refs/remotes/origin/${base}..HEAD`], { cwd: work.dir }));
}

async function anyChanged(repos: RepoCheckout[]): Promise<boolean> {
  for (const r of repos) if ((await commitsAhead(r)) > 0) return true;
  return false;
}

/** Commits pending changes, then runs the verify commands of every changed repo. */
export async function commitAndVerify(run: Run, key: string, message: string, repos: RepoCheckout[]): Promise<string | undefined> {
  run.stage('Verify');
  for (const r of repos) {
    const cwd = r.work.dir;
    if (await sh('git', ['status', '--porcelain'], { cwd })) {
      await sh('git', ['add', '-A'], { cwd });
      await sh('git', ['commit', '-m', `${key}: ${message}`], { cwd });
    }
  }
  for (const r of repos) {
    if ((await commitsAhead(r)) === 0) continue;
    const failure = await runVerify(run, r.work.dir, r.role, r.verify);
    if (failure) return failure;
  }
  return undefined;
}

/**
 * Who else wrote commits on an existing branch (on top of the base), if anyone: the agent force-pushes only
 * a branch that is absent or holds its own commits, never someone's work under the same name.
 */
export async function foreignCommits(repo: string, base: string, branch: string): Promise<string | undefined> {
  const exists = await gh(['api', `repos/${repo}/branches/${encodeURIComponent(branch)}`, '-q', '.name']).catch(() => '');
  if (!exists) return undefined;
  const emails = await ghJson<string[]>(['api', `repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`, '--jq', '[.commits[].commit.author.email] | unique']);
  const others = emails.filter((e) => e !== process.env.GIT_AUTHOR_EMAIL);
  return others.length ? others.join(', ') : undefined;
}

/** Pushes and opens (or reuses) the PR for one changed repo; returns its URL. */
async function publish(run: Run, key: string, branch: string, r: RepoCheckout, title: string, body: string, dryRun: boolean): Promise<string> {
  const cfg = read('agents.developer');
  if (dryRun) return `${r.repo} (dry run)`;
  await sh('git', ['push', '--force', 'origin', `HEAD:refs/heads/${branch}`], { cwd: r.work.dir });
  // A card sent back for rework updates its existing PR instead of failing on a duplicate.
  const existing = await gh(['pr', 'list', '--repo', r.repo, '--head', branch, '--json', 'url', '-q', '.[0].url']);
  const url =
    existing ||
    (await gh([
      'pr', 'create', '--repo', r.repo, '--base', r.base, '--head', branch,
      '--title', `${key}: ${title}`,
      '--body', `${body}\n\n---\n${BOT_MARK} Generated by agentCowork from ${key}`,
      ...(cfg.draft ? ['--draft'] : []),
    ]));
  run.event('artifact', `${existing ? 'Updated' : 'Opened'} ${url}`);
  return url;
}
