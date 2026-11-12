import { type NotifyEvent, read, SECRETS } from './config.ts';
import { getSecret, type InboxEntry } from './db.ts';
import { env } from './env.ts';
import { log } from './sh.ts';

export type Notification = { title: string; text: string; url?: string; agent?: string };

const TIMEOUT_MS = 10_000;

/**
 * The JSON posted to the webhook. Generic on purpose: `text` is what Slack and Mattermost show, `content` what
 * Discord shows; the other fields are for anything that reads JSON (n8n, Zapier, a custom endpoint). Exported for tests.
 */
export function webhookBody(event: NotifyEvent | 'test', n: Notification, uiUrl: string, at = new Date().toISOString()) {
  const link = n.url ?? (uiUrl ? `${uiUrl}/#/inbox` : undefined);
  const message = [`[${env.instanceName}] ${n.title}`, n.text, link].filter(Boolean).join('\n');
  return { event, title: n.title, text: message, content: message.slice(0, 2000), url: link, agent: n.agent, instance: env.instanceName, at };
}

/** Posts the result; throws on a bad response, for the UI's test button. */
async function postWebhook(event: NotifyEvent | 'test', n: Notification): Promise<void> {
  const hook = getSecret(SECRETS.webhookUrl);
  if (!hook) throw new Error('No webhook URL stored');
  const res = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookBody(event, n, read('notifications').uiUrl)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`webhook answered ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** The channels that are set up: a stored webhook. */
function channels(): { name: string; send: (event: NotifyEvent | 'test', n: Notification) => Promise<void> }[] {
  return getSecret(SECRETS.webhookUrl) ? [{ name: 'webhook', send: postWebhook }] : [];
}

/**
 * Tells every configured channel about an event when it is turned on. Never throws and never blocks the
 * caller: a channel that fails is logged, the agents carry on.
 */
export function notify(event: NotifyEvent, n: Notification): void {
  if (!read('notifications').events[event]) return;
  for (const c of channels()) c.send(event, n).catch((err: Error) => log(`notify (${event}) via ${c.name} failed:`, err.message));
}

/** The UI's "Send test": every configured channel, and how each one answered. */
export async function sendTest(): Promise<{ ok: boolean; message: string }> {
  const list = channels();
  if (!list.length) return { ok: false, message: 'No webhook URL stored' };
  const n = { title: 'Test notification', text: 'Notifications from agentCowork reach this channel.' };
  const results = await Promise.all(list.map((c) => c.send('test', n).then(() => `${c.name}: sent`, (err: Error) => `${c.name}: ${err.message}`)));
  return { ok: results.every((r) => r.endsWith(': sent')), message: results.join(' · ') };
}

const AGENT_NAMES: Record<string, string> = { approver: 'Approver', dependabot: 'Dependabot', developer: 'Developer', auditor: 'Auditor', sentinel: 'Sentinel', documenter: 'Documenter' };

/** An item that now waits for a person: what it is, why, and where to look. */
export function notifyInbox({ agent, key, data }: InboxEntry): void {
  const what = typeof data.title === 'string' && data.title ? data.title : key;
  const why = String(data.reason ?? data.error ?? 'Waiting for a person.').split('\n')[0].slice(0, 400);
  notify('inbox', { title: `${AGENT_NAMES[agent] ?? agent}: ${what} needs you`, text: why, url: typeof data.url === 'string' ? data.url : undefined, agent });
}
