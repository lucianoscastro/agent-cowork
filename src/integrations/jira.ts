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
  };
};
type Transition = { id: string; name: string; to: { name: string } };

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
  const query = `jql=${encodeURIComponent(jql)}&fields=summary&maxResults=20`;
  const { issues } = await api<{ issues: { key: string }[] }>(`agile/1.0/board/${boardId}/issue?${query}`);
  return issues.map((i) => i.key);
}

export function getIssue(key: string): Promise<Issue> {
  return api<Issue>(`api/3/issue/${key}?fields=summary,description,comment,status`);
}

/** Accepts either the transition name or its target status name, case-insensitively. */
export async function transition(key: string, name: string): Promise<void> {
  const { transitions } = await api<{ transitions: Transition[] }>(`api/3/issue/${key}/transitions`);
  const wanted = name.toLowerCase();
  const match = transitions.find((t) => t.name.toLowerCase() === wanted || t.to.name.toLowerCase() === wanted);
  if (!match) throw new Error(`${key}: no transition "${name}" (available: ${transitions.map((t) => t.name).join(', ')})`);
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

/** Creates a card and returns its key. */
export async function createIssue(projectKey: string, issueType: string, summary: string, description: DocBlock[], labels: string[]): Promise<string> {
  const { key } = await api<{ key: string }>('api/3/issue', {
    method: 'POST',
    body: { fields: { project: { key: projectKey }, issuetype: { name: issueType }, summary: summary.slice(0, 250), description: toAdf(description), labels } },
  });
  return key;
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
