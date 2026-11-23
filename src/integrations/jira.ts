import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { read, SECRETS } from '../config.ts';
import { getSecret } from '../db.ts';

export type AdfNode = { type?: string; text?: string; content?: AdfNode[] };
export type Comment = { created: string; author?: { displayName: string }; body: AdfNode };
export type Issue = {
  key: string;
  fields: {
    summary: string;
    description: AdfNode | null;
    comment: { comments: Comment[] };
    status: { name: string; statusCategory: { key: string } };
    labels: string[];
    subtasks?: Subtask[];
    parent?: { key: string };
  };
};
export type Subtask = { key: string; fields: { summary: string; status: { statusCategory: { key: string } } } };
type Transition = { id: string; name: string; to: { name: string; statusCategory?: { key: string } } };

// Prefixes the agent's own comments: it may share the Jira account of the human who answers.
export const BOT_MARK = '🤖';
const BLOCK_NODES = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'tableRow']);

/** Flattens Jira's Atlassian Document Format into plain text for prompts. */
export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(adfToText).join('');
  return BLOCK_NODES.has(node.type ?? '') ? `${inner}\n` : inner;
}

/** True when a human commented after the agent asked its question. */
export function hasAnswer(comments: Comment[], since: string): boolean {
  return comments.some(
    (c) => Date.parse(c.created) > Date.parse(since) && !adfToText(c.body).trimStart().startsWith(BOT_MARK),
  );
}

export function formatComments(comments: Comment[]): string {
  const lines = comments.map((c) => `${c.author?.displayName ?? 'unknown'} (${c.created}):\n${adfToText(c.body).trim()}`);
  return lines.join('\n\n') || '(no comments)';
}

export function jiraStatus(): { ready: boolean; reason?: string } {
  const { url, email } = read('jira');
  if (!url || !email) return { ready: false, reason: 'Jira site and email not set' };
  if (!getSecret(SECRETS.jiraToken)) return { ready: false, reason: 'Jira API token not set' };
  return { ready: true };
}

export const browseUrl = (key: string) => `${read('jira').url}/browse/${key}`;

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { url, email } = read('jira');
  const method = init.method ?? 'GET';
  const res = await fetch(`${url}/rest/${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${email}:${getSecret(SECRETS.jiraToken) ?? ''}`)}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new Error(`Jira ${method} ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Keys of the cards on the configured board that match the JQL. */
export async function searchBoard(boardId: string, jql: string): Promise<string[]> {
  const query = `jql=${encodeURIComponent(jql)}&fields=issuetype&maxResults=20`;
  const { issues } = await api<{ issues: { key: string; fields?: { issuetype?: { subtask?: boolean } } }[] }>(`agile/1.0/board/${boardId}/issue?${query}`);
  // A sub-task is a step of its card (the Product Manager's tasks), never a card of its own, whatever the JQL.
  return issues.filter((i) => !i.fields?.issuetype?.subtask).map((i) => i.key);
}

/** Jira answers 404 for a deleted card, and for one this account can no longer see. */
export const missing = (err: unknown) => /: 404 /.test((err as Error).message);

export function getIssue(key: string): Promise<Issue> {
  return api<Issue>(`api/3/issue/${key}?fields=summary,description,comment,status,labels,subtasks,parent`);
}

/** Takes labels off a card and puts others on, in one update (a label already in that state is a no-op). */
export async function relabel(key: string, remove: string[], add: string[]): Promise<void> {
  await api(`api/3/issue/${key}`, { method: 'PUT', body: { update: { labels: [...remove.map((l) => ({ remove: l })), ...add.map((l) => ({ add: l }))] } } });
}

/** The cards an agent takes: its own label, within the JQL every agent shares (`jira.readyJql`, e.g. a status). */
export const cardJql = (label: string) => `labels = "${label}" AND (${read('jira').readyJql})`;

type Attachment = { id: string; filename: string; created: string; size: number; content: string };
/** A name safe to save under a folder: a Markdown file name, no path. Exported for tests. */
export const markdownName = (name: string) => /^[\w][\w .()-]{0,120}\.md$/i.test(name) && !name.includes('..');
/**
 * The Product Manager's documents: a spec, or a discovery, with the clickable prototypes it adds when people approve
 * them on the card. Each version is attached as a whole set, so a version drops one by leaving it out.
 */
export const SPEC_DOC = /^(spec|design|tasks|discovery)\.md$|^ADR-\d{2}-[\w-]{1,80}\.md$|^mockup-[\w-]{1,80}\.html$/;
/** The Developer's plan, attached for people and replaced by each new one; runs never read it back, they plan afresh. */
export const PLAN_DOC = 'developer-plan.md';
/** A discovery's documents: what it proposes and the prototypes of its screens. */
export const DISCOVERY_DOC = /^discovery\.md$|^mockup-[\w-]{1,80}\.html$/;

/**
 * Which attachments a run reads, the newest of each name: people's Markdown notes, and of the spec documents only
 * the set attached with the newest `spec.md` or `discovery.md`. Exported for tests.
 * ponytail: a version is one upload, seconds apart; a minute of slack.
 */
export function currentDocs<T extends Pick<Attachment, 'filename' | 'created'>>(attachments: T[]): T[] {
  const sorted = attachments
    .filter((a) => a.filename !== PLAN_DOC && (markdownName(a.filename) || SPEC_DOC.test(a.filename)))
    .sort((x, y) => Date.parse(x.created) - Date.parse(y.created));
  const spec = sorted.findLast((a) => a.filename === 'spec.md' || a.filename === 'discovery.md');
  const since = spec ? Date.parse(spec.created) - 60_000 : 0;
  const latest = new Map<string, T>();
  for (const a of sorted) if (!SPEC_DOC.test(a.filename) || Date.parse(a.created) >= since) latest.set(a.filename, a);
  // The spec documents first: a cap on the count never drops them for people's notes.
  const all = [...latest.values()];
  return [...all.filter((a) => SPEC_DOC.test(a.filename)), ...all.filter((a) => !SPEC_DOC.test(a.filename))];
}

/**
 * Saves the card's current Markdown attachments and prototypes in `dir` (see `currentDocs`), only those whose name
 * `pick` takes, and returns their names. Credentials go only to the configured Jira site.
 * ponytail: at most 20 files of up to 200 KB each; a card's spec is a handful of small files.
 */
export async function saveMarkdownAttachments(key: string, dir: string, pick: (name: string) => boolean = () => true): Promise<string[]> {
  const { url, email } = read('jira');
  const { fields } = await api<{ fields: { attachment?: Attachment[] } }>(`api/3/issue/${key}?fields=attachment`);
  const files = currentDocs((fields.attachment ?? []).filter((a) => a.size <= 200_000 && a.content.startsWith(`${url}/`)))
    .filter((a) => pick(a.filename))
    .slice(0, 20);
  await mkdir(dir, { recursive: true });
  for (const a of files) {
    const res = await fetch(a.content, { headers: { Authorization: `Basic ${btoa(`${email}:${getSecret(SECRETS.jiraToken) ?? ''}`)}` } });
    if (!res.ok) throw new Error(`Jira attachment ${a.filename} of ${key}: ${res.status}`);
    await writeFile(join(dir, a.filename), Buffer.from(await res.arrayBuffer()));
  }
  return files.map((a) => a.filename);
}

/**
 * The discovery a card is part of: when its parent card holds a `discovery.md`, the parent's current discovery and
 * prototypes are saved in `dir`, and its key and their names returned; otherwise nothing, and `dir` stays absent.
 * ponytail: the latest version, approved or not; people create the child cards once the discovery is approved.
 */
export async function saveDiscovery(issue: Issue, dir: string): Promise<{ key: string; files: string[] } | undefined> {
  const parent = issue.fields.parent?.key;
  if (!parent) return undefined;
  const files = await saveMarkdownAttachments(parent, dir, (name) => DISCOVERY_DOC.test(name));
  if (files.includes('discovery.md')) return { key: parent, files };
  await rm(dir, { recursive: true, force: true });
  return undefined;
}

/**
 * Accepts either the transition name or its target status name, case-insensitively. A card already in that status
 * (a resumed or retried run) stays, as no transition leads to it.
 */
export function transition(key: string, name: string): Promise<void> {
  const wanted = name.toLowerCase();
  return transitionBy(key, `"${name}"`, (t) => t.name.toLowerCase() === wanted || t.to.name.toLowerCase() === wanted, (status) => status.toLowerCase() === wanted);
}

export type FlowStep = 'start' | 'blocked' | 'review' | 'ready';

/** Where a step of the shared flow moves a card: waiting for an approval goes where waiting for people does, unless set. */
export function flowStatus(step: FlowStep): string {
  const flow = read('jira');
  return step === 'review' ? flow.reviewTransition || flow.blockedTransition : flow[`${step}Transition`];
}

/** Moves a card along the flow every agent shares (Setup → Accounts → Jira): taken, waiting for people or their approval, handed over. */
export function moveCard(key: string, step: FlowStep): Promise<void> {
  const name = flowStatus(step);
  return name ? transition(key, name) : Promise.resolve();
}

/**
 * An agent takes a card: with `jira.assign` on, it is assigned to the account the agents act as, so the board shows who
 * is on it (first, as a workflow may ask for an assignee to move a card), then it moves along the shared flow. A refused
 * assignment does not stop the work: its reason is returned.
 */
export async function takeCard(key: string): Promise<string | undefined> {
  const refused = read('jira').assign
    ? await api<{ accountId: string }>('api/3/myself')
        .then((me) => api(`api/3/issue/${key}/assignee`, { method: 'PUT', body: { accountId: me.accountId } }))
        .then(() => undefined, (err: Error) => err.message)
    : undefined;
  await moveCard(key, 'start');
  return refused;
}

/** Moves an issue to the first status of a category (`indeterminate`: in progress, `done`), whatever the workflow names it. */
export const moveTo = (key: string, category: 'indeterminate' | 'done') => transitionBy(key, `to a ${category} status`, (t) => t.to.statusCategory?.key === category);

async function transitionBy(key: string, what: string, pick: (t: Transition) => boolean, there?: (status: string) => boolean): Promise<void> {
  const { transitions } = await api<{ transitions: Transition[] }>(`api/3/issue/${key}/transitions`);
  const match = transitions.find(pick);
  if (!match && there && there((await api<{ fields: { status: { name: string } } }>(`api/3/issue/${key}?fields=status`)).fields.status.name)) return;
  if (!match) throw new Error(`${key}: no transition ${what} (available: ${transitions.map((t) => t.name).join(', ')})`);
  await api(`api/3/issue/${key}/transitions`, { method: 'POST', body: { transition: { id: match.id } } });
}

/** Above a comment's text, a colored panel with a larger title: green to approve, yellow to answer, blue when nobody has to act. */
export type Callout = { tone: 'success' | 'warning' | 'info'; title: string; text: string };

/**
 * A comment's document: one paragraph per line, **text** in bold (an unpaired ** stays as typed). A callout's title
 * opens with the bot mark, so the comment still reads as the bot's. Exported for tests.
 */
export function commentDoc(text: string, callout?: Callout): object {
  const inline = (line: string) =>
    line.split(/\*\*(.+?)\*\*/).flatMap((part, i) => (part ? [i % 2 ? { type: 'text', text: part, marks: [{ type: 'strong' }] } : { type: 'text', text: part }] : []));
  const paragraphs = (lines: string) => lines.split('\n').map((line) => ({ type: 'paragraph', content: inline(line) }));
  const panel = callout && {
    type: 'panel',
    attrs: { panelType: callout.tone },
    content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: `${BOT_MARK} ${callout.title}` }] }, ...paragraphs(callout.text)],
  };
  return { type: 'doc', version: 1, content: [...(panel ? [panel] : []), ...(text || !panel ? paragraphs(text) : [])] };
}

/** Posts a comment (one paragraph per line); returns Jira's timestamp so answers compare on its clock. */
export function comment(key: string, text: string, callout?: Callout): Promise<{ created: string }> {
  const post = (doc: object) => api<{ created: string }>(`api/3/issue/${key}/comment`, { method: 'POST', body: { body: doc } });
  if (!callout) return post(commentDoc(text));
  // A site that refuses the panel gets the same words, its title in bold.
  return post(commentDoc(text, callout)).catch((err: Error) =>
    /: 400 /.test(err.message) ? post(commentDoc(`${BOT_MARK} **${callout.title}**\n${callout.text}${text ? `\n\n${text}` : ''}`)) : Promise.reject(err),
  );
}

/**
 * Logs time on a card (its Work log, apart from the comments), leaving the estimate as it is and notifying nobody.
 * Jira's smallest entry is a minute.
 */
export function addWorklog(key: string, started: string, seconds: number, text: string, link?: string): Promise<unknown> {
  // One paragraph per line of the text, the link at the end of the first.
  const [first, ...rest] = text.split('\n').map((line) => [{ type: 'text', text: line }] as object[]);
  if (link) first.push({ type: 'text', text: ' · ' }, { type: 'text', text: link, marks: [{ type: 'link', attrs: { href: link } }] });
  const content = [first, ...rest].map((line) => ({ type: 'paragraph', content: line }));
  return api(`api/3/issue/${key}/worklog?adjustEstimate=leave&notifyUsers=false`, {
    method: 'POST',
    body: { started: started.replace('Z', '+0000'), timeSpentSeconds: Math.max(60, Math.round(seconds / 60) * 60), comment: { type: 'doc', version: 1, content } },
  });
}

/** A block of an issue description: a heading, paragraphs, a code block or a bullet list. */
export type DocBlock = { heading: string } | { text: string } | { code: string } | { bullets: string[] };

const textNode = (text: string) => (text ? [{ type: 'text', text }] : []);

/** Builds the Atlassian document format for an issue description. Exported for tests. */
export function toAdf(blocks: DocBlock[]): object {
  const content = blocks.map((b) => {
    if ('heading' in b) return { type: 'heading', attrs: { level: 3 }, content: textNode(b.heading) };
    if ('code' in b) return { type: 'codeBlock', content: textNode(b.code) };
    if ('bullets' in b) {
      return { type: 'bulletList', content: b.bullets.map((t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: textNode(t) }] })) };
    }
    return { type: 'paragraph', content: textNode(b.text) };
  });
  return { type: 'doc', version: 1, content };
}

/** The Jira project of a board: where cards created for that board's work go. */
export async function boardProject(boardId: string): Promise<string> {
  const { values } = await api<{ values: { key: string }[] }>(`agile/1.0/board/${boardId}/project`);
  if (!values[0]) throw new Error(`Board ${boardId} has no Jira project`);
  return values[0].key;
}

/** Creates a card (a sub-task of `parent`, when given) and returns its key. */
export async function createIssue(projectKey: string, issueType: string, summary: string, description: DocBlock[], labels: string[], parent?: string): Promise<string> {
  const { key } = await api<{ key: string }>('api/3/issue', {
    method: 'POST',
    body: { fields: { project: { key: projectKey }, issuetype: { name: issueType }, summary: summary.slice(0, 250), description: toAdf(description), labels, ...(parent && { parent: { key: parent } }) } },
  });
  return key;
}

/** The name of the project's sub-task issue type, when it has one (the name differs per site and language). */
export async function subtaskType(projectKey: string): Promise<string | undefined> {
  const { issueTypes } = await api<{ issueTypes: { name: string; subtask: boolean }[] }>(`api/3/project/${projectKey}`);
  return issueTypes.find((t) => t.subtask)?.name;
}

export async function setSummary(key: string, summary: string): Promise<void> {
  await api(`api/3/issue/${key}`, { method: 'PUT', body: { fields: { summary: summary.slice(0, 250) } } });
}

/** Keys and summaries of the issues matching a JQL query (at most 20). */
export async function searchIssues(jql: string): Promise<{ key: string; summary: string }[]> {
  const { issues } = await api<{ issues: { key: string; fields: { summary: string } }[] }>('api/3/search/jql', {
    method: 'POST',
    body: { jql, fields: ['summary'], maxResults: 20 },
  });
  return issues.map((i) => ({ key: i.key, summary: i.fields.summary }));
}

/** Attaches files to an issue (screenshots, HAR, logs). */
export async function attach(key: string, files: { name: string; type: string; data: Buffer }[]): Promise<void> {
  if (!files.length) return;
  const { url, email } = read('jira');
  const form = new FormData();
  for (const f of files) form.append('file', new Blob([new Uint8Array(f.data)], { type: f.type }), f.name);
  const res = await fetch(`${url}/rest/api/3/issue/${key}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${email}:${getSecret(SECRETS.jiraToken) ?? ''}`)}`, 'X-Atlassian-Token': 'no-check' },
    body: form,
  });
  if (!res.ok) throw new Error(`Jira attach ${key}: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/**
 * Attaches files in place of their earlier versions, so people see one current copy: the new ones first, then every
 * older attachment `old` names (by default, one with a name being attached) is removed. A failed attach throws; the
 * names it could not remove are returned. Exported for tests.
 */
export async function replaceAttachments(
  key: string,
  files: { name: string; type: string; data: Buffer }[],
  old: (name: string) => boolean = (name) => files.some((f) => f.name === name),
): Promise<string[]> {
  const { fields } = await api<{ fields: { attachment?: Attachment[] } }>(`api/3/issue/${key}?fields=attachment`);
  await attach(key, files);
  const left: string[] = [];
  for (const a of (fields.attachment ?? []).filter((a) => old(a.filename))) {
    await api(`api/3/attachment/${a.id}`, { method: 'DELETE' }).catch(() => left.push(a.filename));
  }
  return left;
}

/** Connection test for the UI: who the credentials act as, and the name of each project's board. */
export async function testJira(): Promise<string> {
  const me = await api<{ displayName: string }>('api/3/myself');
  const boards = [...new Set(read('projects').items.map((p) => p.boardId).filter(Boolean))];
  const names = await Promise.all(boards.map(async (id) => `board ${id} "${(await api<{ name: string }>(`agile/1.0/board/${id}`)).name}"`));
  return [me.displayName, ...names].join(' · ');
}

export type Check = { label: string; ok: boolean; detail: string };

/**
 * Checks a project's board against the agents' Jira settings: the board, the developer's trigger
 * JQL on it, and every status and issue type the agents name. Runs on the board id as typed in the UI.
 */
export async function checkBoard(boardId: string): Promise<Check[]> {
  const board = await api<{ name: string }>(`agile/1.0/board/${boardId}`);
  const projectKey = await boardProject(boardId);
  const checks: Check[] = [{ label: 'Board', ok: true, detail: `"${board.name}" in project ${projectKey}` }];

  const dev = read('agents.developer');
  try {
    const keys = await searchBoard(boardId, cardJql(dev.label));
    checks.push({ label: 'Trigger JQL', ok: true, detail: keys.length ? `${keys.length >= 20 ? '20+' : keys.length} card(s) match now: ${keys.slice(0, 5).join(', ')}` : 'valid, no card matches now' });
  } catch (err) {
    checks.push({ label: 'Trigger JQL', ok: false, detail: (err as Error).message.replace(/^Jira GET [^:]+: /, '') });
  }

  const [byType, project] = await Promise.all([
    api<{ statuses: { name: string }[] }[]>(`api/3/project/${projectKey}/statuses`),
    api<{ issueTypes: { name: string }[] }>(`api/3/project/${projectKey}`),
  ]);
  const statuses = [...new Set(byType.flatMap((t) => t.statuses.map((s) => s.name)))];
  const types = project.issueTypes.map((t) => t.name);
  const has = (list: string[], name: string) => list.some((x) => x.toLowerCase() === name.toLowerCase());

  const dependabot = read('agents.dependabot');
  const flow = read('jira');
  const wantedStatuses: [string, string][] = [
    ['Agents · when taken', flow.startTransition],
    ['Agents · waiting for people', flow.blockedTransition],
    ['Agents · waiting for approval', flow.reviewTransition],
    ['Agents · handed to another agent', flow.readyTransition],
    ['Developer · PRs open', dev.doneTransition],
    ['Developer · PRs merged', dev.mergedTransition],
    ['Dependabot · CI card moves to', dependabot.cardTransition],
  ];
  if (flow.assign) {
    const wanted = { ASSIGN_ISSUES: 'Assign issues', ASSIGNABLE_USER: 'Assignable user' };
    const { permissions } = await api<{ permissions: Record<string, { havePermission?: boolean }> }>(
      `api/3/mypermissions?projectKey=${projectKey}&permissions=${Object.keys(wanted).join(',')}`,
    );
    const missing = Object.entries(wanted).filter(([p]) => !permissions[p]?.havePermission).map(([, name]) => name);
    checks.push({
      label: 'Agents · assigned when taken',
      ok: missing.length === 0,
      detail: missing.length ? `the Jira account lacks the ${missing.join(' and ')} permission on ${projectKey}: the cards it takes keep their assignee` : 'the Jira account can assign the cards it takes to itself',
    });
  }
  if (flow.worklog) {
    const on = await api<{ timeTrackingEnabled?: boolean }>('api/3/configuration').then((c) => c.timeTrackingEnabled === true, () => false);
    checks.push({ label: 'Agents · work log', ok: on, detail: on ? 'time tracking is on' : 'time tracking is off on this site (Jira settings → Issues → Time tracking): the runs cannot log their time' });
  }
  for (const [label, name] of wantedStatuses.filter(([, n]) => n)) {
    // A transition name also works at run time, so a miss here is worth a look rather than certainly wrong.
    checks.push({ label, ok: has(statuses, name), detail: has(statuses, name) ? name : `"${name}" is not a status of ${projectKey} (statuses: ${statuses.join(', ')})` });
  }
  const wantedTypes: [string, string][] = [
    ['Auditor · issue type', read('agents.auditor').jiraIssueType],
    ['Sentinel · bug type', read('agents.sentinel').bugIssueType],
    ['Dependabot · CI card type', dependabot.cardIssueType],
  ];
  for (const [label, name] of wantedTypes.filter(([, n]) => n)) {
    checks.push({ label, ok: has(types, name), detail: has(types, name) ? name : `"${name}" is not an issue type of ${projectKey} (types: ${types.join(', ')})` });
  }
  return checks;
}
