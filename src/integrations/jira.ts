import { mkdir, writeFile } from 'node:fs/promises';
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
  return api<Issue>(`api/3/issue/${key}?fields=summary,description,comment,status,labels,subtasks`);
}

/** Takes labels off a card and puts others on, in one update (a label already in that state is a no-op). */
export async function relabel(key: string, remove: string[], add: string[]): Promise<void> {
  await api(`api/3/issue/${key}`, { method: 'PUT', body: { update: { labels: [...remove.map((l) => ({ remove: l })), ...add.map((l) => ({ add: l }))] } } });
}

/** The label a trigger JQL selects cards by (`labels = "x"` or `labels in (x, …)`), if it has one. Exported for tests. */
export const triggerLabel = (jql: string): string | undefined => /labels\s*(?:=|in\s*\()\s*"?([\w.-]+)/i.exec(jql)?.[1];

type Attachment = { filename: string; created: string; size: number; content: string };
/** A name safe to save under a folder: a Markdown file name, no path. Exported for tests. */
export const markdownName = (name: string) => /^[\w][\w .()-]{0,120}\.md$/i.test(name) && !name.includes('..');
/** The Product Manager's documents. Each version is attached as a whole set, so a version drops one by leaving it out. */
export const SPEC_DOC = /^(spec|design|tasks)\.md$|^ADR-\d{2}-[\w-]{1,80}\.md$/;

/**
 * Which Markdown attachments a run reads, the newest of each name: people's notes, and of the spec documents only
 * the set attached with the newest `spec.md`. Exported for tests.
 * ponytail: a version is one upload, seconds apart; a minute of slack.
 */
export function currentDocs<T extends Pick<Attachment, 'filename' | 'created'>>(attachments: T[]): T[] {
  const sorted = attachments.filter((a) => markdownName(a.filename)).sort((x, y) => Date.parse(x.created) - Date.parse(y.created));
  const spec = sorted.findLast((a) => a.filename === 'spec.md');
  const since = spec ? Date.parse(spec.created) - 60_000 : 0;
  const latest = new Map<string, T>();
  for (const a of sorted) if (!SPEC_DOC.test(a.filename) || Date.parse(a.created) >= since) latest.set(a.filename, a);
  // The spec documents first: a cap on the count never drops them for people's notes.
  const all = [...latest.values()];
  return [...all.filter((a) => SPEC_DOC.test(a.filename)), ...all.filter((a) => !SPEC_DOC.test(a.filename))];
}

/**
 * Saves the card's current Markdown attachments in `dir` (see `currentDocs`) and returns their names. Credentials
 * go only to the configured Jira site.
 * ponytail: at most 20 files of up to 200 KB each; a card's spec is a handful of small files.
 */
export async function saveMarkdownAttachments(key: string, dir: string): Promise<string[]> {
  const { url, email } = read('jira');
  const { fields } = await api<{ fields: { attachment?: Attachment[] } }>(`api/3/issue/${key}?fields=attachment`);
  const files = currentDocs((fields.attachment ?? []).filter((a) => a.size <= 200_000 && a.content.startsWith(`${url}/`))).slice(0, 20);
  await mkdir(dir, { recursive: true });
  for (const a of files) {
    const res = await fetch(a.content, { headers: { Authorization: `Basic ${btoa(`${email}:${getSecret(SECRETS.jiraToken) ?? ''}`)}` } });
    if (!res.ok) throw new Error(`Jira attachment ${a.filename} of ${key}: ${res.status}`);
    await writeFile(join(dir, a.filename), Buffer.from(await res.arrayBuffer()));
  }
  return files.map((a) => a.filename);
}

/** Accepts either the transition name or its target status name, case-insensitively. */
export function transition(key: string, name: string): Promise<void> {
  const wanted = name.toLowerCase();
  return transitionBy(key, `"${name}"`, (t) => t.name.toLowerCase() === wanted || t.to.name.toLowerCase() === wanted);
}

/** Moves an issue to the first status of a category (`indeterminate`: in progress, `done`), whatever the workflow names it. */
export const moveTo = (key: string, category: 'indeterminate' | 'done') => transitionBy(key, `to a ${category} status`, (t) => t.to.statusCategory?.key === category);

async function transitionBy(key: string, what: string, pick: (t: Transition) => boolean): Promise<void> {
  const { transitions } = await api<{ transitions: Transition[] }>(`api/3/issue/${key}/transitions`);
  const match = transitions.find(pick);
  if (!match) throw new Error(`${key}: no transition ${what} (available: ${transitions.map((t) => t.name).join(', ')})`);
  await api(`api/3/issue/${key}/transitions`, { method: 'POST', body: { transition: { id: match.id } } });
}

/** Posts a comment (one paragraph per line); returns Jira's timestamp so answers compare on its clock. */
export function comment(key: string, text: string): Promise<{ created: string }> {
  const paragraphs = text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }));
  return api(`api/3/issue/${key}/comment`, { method: 'POST', body: { body: { type: 'doc', version: 1, content: paragraphs } } });
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
    const keys = await searchBoard(boardId, dev.triggerJql);
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
  const wantedStatuses: [string, string][] = [
    ['Developer · when picked', dev.startTransition],
    ['Developer · waiting for a human', dev.blockedTransition],
    ['Developer · PRs open', dev.doneTransition],
    ['Developer · PRs merged', dev.mergedTransition],
    ['Dependabot · CI card moves to', dependabot.cardTransition],
  ];
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
