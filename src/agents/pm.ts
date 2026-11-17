import { randomUUID } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brainContext, learning } from '../brain.ts';
import { outputLanguage, type Project, read, repoFolder } from '../config.ts';
import { Items, MAX_ATTEMPTS } from '../db.ts';
import { env } from '../env.ts';
import { gh } from '../integrations/github.ts';
import * as jira from '../integrations/jira.ts';
import { runProvider } from '../providers/index.ts';
import { type Run, type RunEnd, withRun } from '../runs.ts';
import { wake } from '../scheduler.ts';
import { type Checkout, checkout, forEachLimit, log, removeCheckout, renderPrompt } from '../sh.ts';
import { type Finding, formatFindings, REVIEW_SCHEMA, type Review, reviewPasses } from './developer.ts';
import { takeForce } from './status.ts';

const { BOT_MARK } = jira;
/** The run's work folder in the workspace: the documents the lead returns are saved there, then attached to the card. */
const SPEC = 'spec';

type Doc = { name: string; content: string };
type Spec = { status: 'ready' | 'needs_input'; questions: string; title: string; summary: string; files: Doc[] };
const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_input'] },
    questions: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  },
  required: ['status', 'questions', 'title', 'summary', 'files'],
};

/** The label that starts the Developer, from its trigger. */
const readyLabel = () => jira.triggerLabel(read('agents.developer').triggerJql) ?? 'agent-ready';

/**
 * Agent G: a card with the trigger label gets its spec documents (spec, design, ADRs, tasks) as Markdown
 * attachments, then goes straight to the Developer. Gray areas are asked on the card first, in one batch.
 */
export async function pollPm(): Promise<void> {
  const cfg = read('agents.pm');
  const { dryRun } = cfg;
  const items = new Items('pm', dryRun);
  // Run now: every card with the label again, even one already specified.
  const force = takeForce('pm');
  const projects = read('projects').items;
  const queue = new Map<string, Project>();
  const waiting = items.list('waiting');
  // Cards waiting for an answer keep the label: left out of the search, they never crowd out new ones.
  // ponytail: up to 100 waiting cards in the JQL; past that, the oldest still take search slots.
  const keys = waiting.map((w) => w.key).filter((k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k)).slice(0, 100);
  const jql = `labels = "${cfg.label}" AND statusCategory != Done${keys.length ? ` AND key not in (${keys.join(', ')})` : ''}`;
  // ponytail: one board search per project per poll; fine for a handful of projects.
  for (const project of projects) {
    if (!project.boardId) continue;
    for (const key of await jira.searchBoard(project.boardId, jql)) {
      const item = items.get(key);
      // The label comes off at the hand-off: back on a card already specified, a person asks for a new version.
      const due = !item || (item.status === 'failed' && item.attempts < MAX_ATTEMPTS) || (item.status === 'done' && !dryRun);
      if (force || (due && item?.status !== 'waiting')) queue.set(key, project);
    }
  }
  // Cards waiting for an answer resume once someone answers; done on the board or deleted, any card leaves the inbox.
  for (const c of [...waiting, ...items.list('failed'), ...items.list('human')]) {
    const project = projects.find((p) => p.name === c.data.project);
    if (!c.data.project || queue.has(c.key)) continue;
    try {
      const issue = await jira.getIssue(c.key);
      const answered = c.status === 'waiting' && (c.data.resume || jira.hasAnswer(issue.fields.comment.comments, String(c.data.waitingSince)));
      if (issue.fields.status.statusCategory.key === 'done') items.done(c.key, { closed: true });
      else if (answered && project) queue.set(c.key, project);
    } catch (err) {
      if (jira.missing(err)) items.done(c.key, { closed: true, missing: true });
      else log(`pm: checking ${c.key} on the board failed:`, (err as Error).message);
    }
  }
  await forEachLimit([...queue], cfg.concurrency, ([key, project]) => handle(items, key, project, dryRun));
}

async function handle(items: Items, key: string, project: Project, dryRun: boolean): Promise<void> {
  const cfg = read('agents.pm');
  // url and title: the Inbox links the card, where the answer goes.
  const data = { project: project.name, url: jira.browseUrl(key), title: key };
  const end = await withRun(
    { agent: 'pm', item: key, url: data.url, title: project.name, dryRun, timeoutMs: cfg.limits.runMinutes * 60_000 },
    (run) => learning(run, project.name, cfg.lead, dryRun, (signals) => specify(run, key, project, dryRun, signals)),
  );
  if (end.status === 'done') items.done(key, { summary: end.summary });
  else if (end.status === 'waiting') items.wait(key, { ...data, reason: end.summary, waitingSince: end.data?.waitingSince ?? new Date().toISOString() });
  else if (end.status === 'killed') items.stopped(key, data);
  else items.fail(key, end.summary ?? end.status, data);
}

async function specify(run: Run, key: string, project: Project, dryRun: boolean, signals: string[]): Promise<RunEnd> {
  const cfg = read('agents.pm');
  const issue = await jira.getIssue(key);
  const people = issue.fields.comment.comments.filter((c) => !jira.adfToText(c.body).trimStart().startsWith(BOT_MARK));
  if (people.length) signals.push(`People wrote on card ${key}:\n${jira.formatComments(people).slice(-6000)}`);

  run.stage('Intake');
  const workspace = join(env.paths.work, 'worktrees', `spec-${key}-${randomUUID().slice(0, 8)}`);
  const folder = join(workspace, SPEC);
  const repos: Checkout[] = [];
  try {
    // The card's current Markdown attachments: the latest version of its documents, and people's notes.
    const attached = await jira.saveMarkdownAttachments(key, folder);
    const before = await docsIn(folder);
    const checkouts: string[] = [];
    for (const r of Object.values(project.repos)) {
      const base = project.baseBranch || read('agents.developer').baseBranch || (await gh(['repo', 'view', r.repo, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name']));
      repos.push(await checkout(r.repo, [`+refs/heads/${base}:refs/remotes/origin/${base}`], `refs/remotes/origin/${base}`, { dir: join(workspace, repoFolder(r.repo)) }));
      checkouts.push(`- \`${repoFolder(r.repo)}/\`: ${r.repo}, branch \`${base}\``);
    }
    const description = jira.adfToText(issue.fields.description);
    const vars: Record<string, string> = {
      key,
      project: project.name,
      summary: issue.fields.summary,
      description,
      comments: jira.formatComments(issue.fields.comment.comments),
      language: outputLanguage(),
      repos: checkouts.join('\n'),
      folder: SPEC,
      mode: before.has('spec.md')
        ? `Mode: **new version**. The card's documents are in \`${SPEC}/\` (${attached.join(', ')}), and people put the card back for a new version: update them from the card's latest discussion and keep what still holds.`
        : `Mode: **new**.${attached.length ? ` \`${SPEC}/\` holds the card's Markdown attachments (${attached.join(', ')}): read them as part of the card.` : ''}`,
      reviewContext: '',
      brain: await brainContext(project.name, workspace, `${issue.fields.summary}\n${description}`),
    };
    // Read only, like every call that reads people's text: the lead returns the documents and the platform saves them.
    const lead = async (label: string, extra: Record<string, string> = {}): Promise<Spec> => {
      const prompt = await renderPrompt('pm/specify', { ...vars, ...extra });
      const { output } = await runProvider<Spec>(cfg.lead.provider, { run, label, prompt, schema: SPEC_SCHEMA, cwd: workspace, mode: 'read-only', model: cfg.lead.model });
      if (output.status === 'ready') await save(run, folder, output.files);
      return output;
    };

    run.stage('Specify');
    let spec = await lead('specify');
    if (spec.status === 'needs_input') return await ask(run, key, spec.questions, dryRun);

    // --- Review by an independent model, bounded; what is left goes on the card for the people reviewing the code ---
    let findings: Finding[] = [];
    let passed = true;
    const rounds = cfg.reviewer.enabled ? cfg.limits.specReview : 0;
    for (let round = 1; round <= rounds; round++) {
      run.stage(`Spec review ${round}`);
      const prompt = await renderPrompt('pm/review-spec', vars);
      const { output: review } = await runProvider<Review>(cfg.reviewer.provider, { run, label: `review-spec-${round}`, prompt, schema: REVIEW_SCHEMA, cwd: workspace, mode: 'read-only', model: cfg.reviewer.model, avoid: [cfg.lead.provider] });
      run.event('artifact', `Spec review ${round}: ${review.verdict}`, review);
      findings = review.findings;
      passed = reviewPasses(review);
      if (passed || round === rounds) break;
      signals.push(`The spec reviewer asked for changes (the documents were revised):\n${formatFindings(review.findings)}`);
      run.stage(`Revise ${round}`);
      spec = await lead(`revise-${round}`, {
        reviewContext: `## Review findings\n\nAn independent reviewer read your documents in \`${SPEC}/\` and asked for changes. Fix every blocker and major finding (or say in \`summary\` why one does not apply), then return all the fields again, with every document in \`files\`.\n\n<review_findings>\n${formatFindings(review.findings)}\n</review_findings>`,
      });
      // A finding only people can settle: ask, and hand nothing to the Developer yet.
      if (spec.status === 'needs_input') return await ask(run, key, spec.questions, dryRun);
    }

    run.stage('Hand-off');
    const after = await docsIn(folder);
    // A version is attached whole, so the Developer reads one consistent set; nothing new is attached when nothing changed.
    const changed = after.size !== before.size || [...after].some(([name, text]) => before.get(name) !== text);
    const docs = [...after.keys()];
    run.event('artifact', `Documents (${docs.length}${changed ? '' : ', unchanged'})`, [...after].map(([name, text]) => `### ${name}\n\n${text.slice(0, 20_000)}`).join('\n\n'));
    // A one-way door decided here binds later cards: the brain learns it from this run.
    for (const [name, text] of after) if (name.startsWith('ADR-') && before.get(name) !== text) signals.push(`Decision recorded for ${key} (${name}):\n${text.slice(0, 2000)}`);
    const ready = readyLabel();
    const notes = findings.length ? `\n\n${passed ? 'Reviewer notes' : 'Reviewer findings still open'}:\n${formatFindings(findings)}` : '';
    if (dryRun) return { status: 'done', summary: `would attach ${changed ? docs.join(', ') : 'nothing (unchanged)'} to ${key} and hand it to the Developer: ${spec.title}\n\n${spec.summary}${notes}` };
    if (changed) await jira.attach(key, [...after].map(([name, text]) => ({ name, type: 'text/markdown', data: Buffer.from(text) })));
    await jira.comment(key, `${BOT_MARK} Spec documents ${changed ? 'attached' : 'unchanged'}: ${docs.join(', ')}\n\n${spec.summary}${notes}\n\nHanded to the Developer (label ${ready}). To change the spec, comment what to change and put the label ${cfg.label} back.`);
    await jira.relabel(key, [cfg.label], [ready]);
    // Straight to the Developer: its next poll starts now instead of after the interval.
    wake('developer');
    return { status: 'done', summary: `${changed ? 'attached' : 'kept'} ${docs.join(', ')} on ${key} and handed it to the Developer: ${spec.title}` };
  } finally {
    for (const r of repos) await removeCheckout(r).catch(() => {});
    await rm(workspace, { recursive: true, force: true });
  }
}

/** Posts the questions on the card and ends the run waiting for an answer there. */
async function ask(run: Run, key: string, questions: string, dryRun: boolean): Promise<RunEnd> {
  run.event('artifact', 'Asked on the card', questions);
  if (dryRun) return { status: 'waiting', summary: questions, data: { waitingSince: new Date().toISOString() } };
  const { created } = await jira.comment(key, `${BOT_MARK} agentCowork needs your answers before writing the spec. Reply in one comment (for example "Q1 a, Q2 b") and it will continue.\n\n${questions}`);
  return { status: 'waiting', summary: questions, data: { waitingSince: created } };
}

/**
 * Replaces the documents in the work folder with the set the lead returned (people's notes stay). Exported for tests.
 * ponytail: up to 20 documents of 200 KB; a name outside the layout is refused, never written.
 */
export async function save(run: Run | undefined, folder: string, files: Doc[]): Promise<void> {
  const bad = files.filter((f) => !jira.SPEC_DOC.test(f.name) || f.content.length > 200_000);
  if (bad.length) run?.event('warn', `Ignored ${bad.length} document(s) outside the layout`, bad.map((f) => f.name));
  const good = files.filter((f) => !bad.includes(f)).slice(0, 20);
  if (!good.some((f) => f.name === 'spec.md')) throw new Error('The documents have no spec.md');
  for (const name of (await docsIn(folder)).keys()) await rm(join(folder, name));
  for (const f of good) await writeFile(join(folder, f.name), f.content);
}

/** The Product Manager's documents in the work folder, by name. */
async function docsIn(folder: string): Promise<Map<string, string>> {
  const names = (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter((e) => e.isFile() && jira.SPEC_DOC.test(e.name)).map((e) => e.name);
  return new Map(await Promise.all(names.map(async (n) => [n, await readFile(join(folder, n), 'utf8')] as const)));
}
