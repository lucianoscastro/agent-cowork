import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decrypt, encrypt } from './crypto.ts';

let db: DatabaseSync | undefined;
let secretKey = '';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (
  key TEXT PRIMARY KEY, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, data TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, item TEXT NOT NULL, url TEXT, title TEXT,
  status TEXT NOT NULL, stage TEXT, dry_run INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, ended_at TEXT,
  summary TEXT, error TEXT, usage TEXT);
CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  at TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, data TEXT);
CREATE INDEX IF NOT EXISTS run_events_run ON run_events(run_id);
CREATE TABLE IF NOT EXISTS limits (provider TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
`;

export function openDb(dir: string, key: string): DatabaseSync {
  mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(join(dir, 'agentcowork.db'));
  db.exec(SCHEMA);
  secretKey = key;
  return db;
}

export function sql(): DatabaseSync {
  if (!db) throw new Error('database not open');
  return db;
}

const now = () => new Date().toISOString();

// --- settings: one JSON document per section ---

export function getSetting<T>(key: string, defaults: T): T {
  const row = sql().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? { ...defaults, ...(JSON.parse(row.value) as Partial<T>) } : defaults;
}

export function putSetting(key: string, value: unknown): void {
  sql()
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, JSON.stringify(value), now());
}

// --- secrets: encrypted at rest, never returned to the UI ---

export function setSecret(name: string, value: string): void {
  sql()
    .prepare('INSERT INTO secrets (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(name, encrypt(secretKey, value), now());
}

export function getSecret(name: string): string | undefined {
  const row = sql().prepare('SELECT value FROM secrets WHERE name = ?').get(name) as { value: string } | undefined;
  return row ? decrypt(secretKey, row.value) : undefined;
}

/** When a secret was last stored, never its value. */
export function secretUpdatedAt(name: string): string | undefined {
  return (sql().prepare('SELECT updated_at FROM secrets WHERE name = ?').get(name) as { updated_at: string } | undefined)?.updated_at;
}

export function deleteSecret(name: string): void {
  sql().prepare('DELETE FROM secrets WHERE name = ?').run(name);
}

export function secretNames(): string[] {
  return (sql().prepare('SELECT name FROM secrets ORDER BY name').all() as { name: string }[]).map((r) => r.name);
}

// --- items: what each agent already handled (PR@sha, card key), so each is processed once ---

// A failed item is not picked up again on its own: automatic retries repeated the same failure and spent tokens. Retry is a person's call (Inbox).
export const MAX_ATTEMPTS = 1;
/** A provider's usage or spend limit: it says nothing about the item, so it never uses up the item's attempts. */
export const LIMIT_ERROR = /hit your .*limit|usage limit|spend limit|rate limit|out of credits|\b429\b/i;

// watching: the developer's PRs are open and it keeps them green and answered until they close.
export type ItemStatus = 'done' | 'failed' | 'waiting' | 'human' | 'watching';
export type Item = { key: string; status: ItemStatus; attempts: number; data: Record<string, unknown>; updatedAt: string };

export type InboxEntry = { agent: string; key: string; status: ItemStatus; data: Record<string, unknown> };
let inboxListener: ((entry: InboxEntry) => void) | undefined;
/** Called when a live item starts needing a person, or needs one again for a new reason: notifications hook here. */
export const onInbox = (fn: (entry: InboxEntry) => void) => void (inboxListener = fn);

/** Whether an item shows in the Inbox: the same rule as the Inbox page. */
export const needsPerson = (status: ItemStatus, attempts: number, data: Record<string, unknown>) =>
  status === 'waiting' || status === 'human' || (status === 'failed' && attempts >= MAX_ATTEMPTS) || (status === 'watching' && Boolean(data.parked));

/** Item state for one agent; dry runs use their own namespace so a shadow run never marks real work done. */
export class Items {
  #prefix: string;
  #agent: string;
  #dryRun: boolean;

  constructor(agent: string, dryRun: boolean) {
    this.#prefix = `${dryRun ? 'dry:' : ''}${agent}:`;
    this.#agent = agent;
    this.#dryRun = dryRun;
  }

  get(key: string): Item | undefined {
    const row = sql().prepare('SELECT * FROM items WHERE key = ?').get(this.#prefix + key) as
      | { key: string; status: ItemStatus; attempts: number; data: string | null; updated_at: string }
      | undefined;
    if (!row) return undefined;
    return { key, status: row.status, attempts: row.attempts, data: JSON.parse(row.data ?? '{}'), updatedAt: row.updated_at };
  }

  /** Done, handed to a human, or out of retries. Waiting items are resumed by their agent, not re-picked. */
  skip(key: string): boolean {
    const item = this.get(key);
    if (!item) return false;
    return item.status !== 'failed' || item.attempts >= MAX_ATTEMPTS;
  }

  done(key: string, data: Record<string, unknown> = {}): void {
    this.#put(key, 'done', 0, data);
  }

  fail(key: string, error: string, data: Record<string, unknown> = {}): void {
    const attempts = (this.get(key)?.attempts ?? 0) + (LIMIT_ERROR.test(error) ? 0 : 1);
    this.#put(key, 'failed', attempts, { ...data, error });
  }

  wait(key: string, data: Record<string, unknown>): void {
    this.#put(key, 'waiting', 0, data);
  }

  human(key: string, data: Record<string, unknown>): void {
    this.#put(key, 'human', 0, data);
  }

  /** A run stopped from the UI: handed to a person instead of being picked up again on the next poll. */
  stopped(key: string, data: Record<string, unknown> = {}): void {
    this.#put(key, 'human', 0, { ...data, reason: 'Stopped from the UI. Retry runs it again; Remove drops it.' });
  }

  watch(key: string, data: Record<string, unknown>): void {
    this.#put(key, 'watching', 0, data);
  }

  forget(key: string): void {
    sql().prepare('DELETE FROM items WHERE key = ?').run(this.#prefix + key);
  }

  list(status: ItemStatus): Item[] {
    const rows = sql()
      .prepare('SELECT * FROM items WHERE key LIKE ? AND status = ? ORDER BY updated_at')
      .all(`${this.#prefix}%`, status) as { key: string; attempts: number; data: string | null; updated_at: string }[];
    return rows.map((r) => ({
      key: r.key.slice(this.#prefix.length),
      status,
      attempts: r.attempts,
      data: JSON.parse(r.data ?? '{}'),
      updatedAt: r.updated_at,
    }));
  }

  #put(key: string, status: ItemStatus, attempts: number, data: Record<string, unknown>): void {
    const before = inboxListener && !this.#dryRun ? this.get(key) : undefined;
    this.#write(key, status, attempts, data);
    // A card put back in the queue (Retry, a restart) resumes on its own: nobody needs telling.
    if (!inboxListener || this.#dryRun || data.resume || !needsPerson(status, attempts, data)) return;
    const again = before && needsPerson(before.status, before.attempts, before.data) && before.data.reason === data.reason && before.data.error === data.error;
    if (!again) inboxListener({ agent: this.#agent, key, status, data });
  }

  #write(key: string, status: ItemStatus, attempts: number, data: Record<string, unknown>): void {
    sql()
      .prepare('INSERT INTO items (key, status, attempts, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET status = excluded.status, attempts = excluded.attempts, data = excluded.data, updated_at = excluded.updated_at')
      .run(this.#prefix + key, status, attempts, JSON.stringify(data), now());
  }
}

/** Items of every agent needing a human, for the inbox. */
export function itemsByStatus(statuses: ItemStatus[]): (Item & { agent: string; dryRun: boolean })[] {
  const rows = sql()
    .prepare(`SELECT * FROM items WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY updated_at DESC`)
    .all(...statuses) as { key: string; status: ItemStatus; attempts: number; data: string | null; updated_at: string }[];
  return rows.map((r) => {
    const dryRun = r.key.startsWith('dry:');
    const rest = dryRun ? r.key.slice(4) : r.key;
    const agent = rest.slice(0, rest.indexOf(':'));
    return { key: rest.slice(agent.length + 1), agent, dryRun, status: r.status, attempts: r.attempts, data: JSON.parse(r.data ?? '{}'), updatedAt: r.updated_at };
  });
}

// --- audit log ---

export function audit(actor: string, action: string, detail = ''): void {
  sql().prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(now(), actor, action, detail);
}

export function auditLog(limit = 200, offset = 0): { at: string; actor: string; action: string; detail: string }[] {
  return sql().prepare('SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset) as never;
}
