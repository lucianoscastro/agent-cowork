import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type AgentId, read } from './config.ts';
import { Items, sql } from './db.ts';
import { env } from './env.ts';
import { addWorklog } from './integrations/jira.ts';
import { AGENT_NAMES } from './notify.ts';
import { log } from './sh.ts';
import { runsUsage } from './usage.ts';

export type RunStatus = 'running' | 'done' | 'failed' | 'parked' | 'waiting' | 'killed';
export type RunEnd = { status: Exclude<RunStatus, 'running'>; summary?: string; data?: Record<string, unknown> };
/** card: the Jira card the run works on; with jira.worklog on, a live run's time goes on it as a work log. */
export type RunMeta = { agent: AgentId; item: string; url?: string; title?: string; dryRun: boolean; timeoutMs?: number; card?: string };

const KILLED = 'killed by the admin';
const active = new Map<number, { agent: AgentId; controller: AbortController }>();
const now = () => new Date().toISOString();

/** One execution of an agent on one item: stages, events, transcripts and a kill switch. */
export class Run {
  readonly id: number;
  readonly signal: AbortSignal;
  /** Moves the run's time limit later by `ms`, once the run knows how much work it holds (a no-op without a limit). */
  readonly extend: (ms: number) => void;

  constructor(id: number, signal: AbortSignal, extend: (ms: number) => void = () => {}) {
    this.id = id;
    this.signal = signal;
    this.extend = extend;
  }

  get logDir(): string {
    return join(env.paths.logs, 'runs', String(this.id));
  }

  /** Path for a raw transcript (JSONL) of one runtime call. */
  transcript(name: string): string {
    mkdirSync(this.logDir, { recursive: true });
    return join(this.logDir, `${name}.jsonl`);
  }

  event(kind: 'stage' | 'info' | 'warn' | 'error' | 'artifact' | 'usage', message: string, data?: unknown): void {
    sql()
      .prepare('INSERT INTO run_events (run_id, at, kind, message, data) VALUES (?, ?, ?, ?, ?)')
      .run(this.id, now(), kind, message, data === undefined ? null : JSON.stringify(data));
    log(`[run ${this.id}] ${message}`);
  }

  stage(name: string): void {
    sql().prepare('UPDATE runs SET stage = ? WHERE id = ?').run(name, this.id);
    this.event('stage', name);
  }

  /** Throws when the run was killed or timed out, so long flows stop between steps. */
  checkpoint(): void {
    if (this.signal.aborted) throw new Error(String(this.signal.reason ?? 'aborted'));
  }
}

/** Runs fn as a tracked run; failures, kills and timeouts are recorded instead of thrown. */
export async function withRun(meta: RunMeta, fn: (run: Run) => Promise<RunEnd>): Promise<RunEnd> {
  const controller = new AbortController();
  const started = now();
  const { lastInsertRowid } = sql()
    .prepare('INSERT INTO runs (agent, item, url, title, status, dry_run, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(meta.agent, meta.item, meta.url ?? null, meta.title ?? null, 'running', meta.dryRun ? 1 : 0, started);
  const id = Number(lastInsertRowid);
  active.set(id, { agent: meta.agent, controller });
  // The time limit is a timer the run can push back (Run.extend), not a fixed AbortSignal.timeout.
  const limit = new AbortController();
  let deadline = Date.now() + (meta.timeoutMs ?? 0);
  let timer: NodeJS.Timeout | undefined;
  // A timer holds at most 2^31-1 ms (about 24.8 days): a later deadline is armed again when that one fires.
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => (Date.now() < deadline ? arm() : limit.abort(new DOMException('run time limit reached', 'TimeoutError'))), Math.min(deadline - Date.now(), 2 ** 31 - 1));
  };
  if (meta.timeoutMs) arm();
  const signal = meta.timeoutMs ? AbortSignal.any([controller.signal, limit.signal]) : controller.signal;
  const run = new Run(id, signal, (ms) => {
    if (!meta.timeoutMs || limit.signal.aborted) return;
    deadline += ms;
    arm();
  });
  // Agents write reports and evidence here before any transcript would have created it.
  mkdirSync(run.logDir, { recursive: true });
  let end: RunEnd;
  let error: string | null = null;
  try {
    end = await fn(run);
  } catch (err) {
    error = (err as Error).message;
    const killed = controller.signal.aborted;
    end = { status: killed ? 'killed' : 'failed', summary: killed ? KILLED : signal.aborted ? 'run time limit reached' : error };
    run.event('error', error);
  } finally {
    clearTimeout(timer);
    active.delete(id);
  }
  const ended = now();
  sql()
    .prepare('UPDATE runs SET status = ?, summary = ?, error = ?, ended_at = ? WHERE id = ?')
    .run(end.status, end.summary ?? null, error, ended, id);
  // ponytail: a run cut by a restart logs nothing; its time is lost to the card, not to the Runs page.
  if (meta.card && !meta.dryRun && read('jira').worklog) {
    const w = worklog(id, meta.agent, started, ended, end.status);
    await addWorklog(meta.card, started, w.seconds, w.text, w.link).catch((err) => run.event('warn', 'The time was not logged on the card', (err as Error).message));
  }
  return end;
}

/** A run's work log on its card: how long it took, the runtimes it called, its tokens and cost, and a link to it. Exported for tests. */
export function worklog(id: number, agent: AgentId, started: string, ended: string, status: RunStatus): { seconds: number; text: string; link?: string } {
  const models = sql()
    .prepare("SELECT DISTINCT json_extract(data, '$.provider') AS provider, json_extract(data, '$.model') AS model FROM run_events WHERE run_id = ? AND kind = 'usage' ORDER BY id")
    .all(id) as { provider: string | null; model: string | null }[];
  const { tokens, cost } = runsUsage([id]).get(id) ?? { tokens: 0, cost: 0 };
  const count = tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M` : tokens >= 1e3 ? `${Math.round(tokens / 1e3)}k` : String(tokens);
  const text = [
    `agentCowork · ${AGENT_NAMES[agent] ?? agent} · run #${id} (${status})`,
    models.map((m) => [m.provider, m.model !== 'default' && m.model].filter(Boolean).join(' ')).join(', '),
    tokens > 0 && `${count} tokens`,
    cost > 0 && `US$${cost.toFixed(2)}`,
  ].filter(Boolean);
  const { uiUrl } = read('notifications');
  return { seconds: (Date.parse(ended) - Date.parse(started)) / 1000, text: text.join(' · '), link: uiUrl ? `${uiUrl.replace(/\/$/, '')}/#/runs/${id}` : undefined };
}

export function killRun(id: number): boolean {
  const entry = active.get(id);
  entry?.controller.abort(KILLED);
  return Boolean(entry);
}

export function killAgent(agent: AgentId): number {
  let n = 0;
  for (const [id, entry] of active) if (entry.agent === agent && killRun(id)) n++;
  return n;
}


/**
 * Runs left "running" by a crash or restart can never finish: close them at startup. A Developer card goes
 * back in the queue: its Jira status already moved on (In Progress), so the trigger would never pick it again.
 */
export function closeOrphanRuns(): void {
  const orphans = sql().prepare("SELECT agent, item, title, dry_run FROM runs WHERE status = 'running'").all() as { agent: AgentId; item: string; title: string | null; dry_run: number }[];
  sql().prepare("UPDATE runs SET status = 'failed', error = 'interrupted by a restart', ended_at = ? WHERE status = 'running'").run(now());
  for (const r of orphans.filter((o) => o.agent === 'developer' && o.title)) {
    const items = new Items('developer', r.dry_run === 1);
    // A PR follow-up's card stays "watching": its next poll attends the PR again on its own.
    if (items.get(r.item)?.status === 'watching') continue;
    items.wait(r.item, { project: r.title, reason: 'interrupted by a restart', waitingSince: now(), resume: true });
  }
}

export type RunRow = {
  id: number;
  agent: AgentId;
  item: string;
  url: string | null;
  title: string | null;
  status: RunStatus;
  stage: string | null;
  dry_run: number;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  error: string | null;
};

export function listRuns(filter: { agent?: string; status?: string; limit?: number; offset?: number; before?: number } = {}): RunRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.agent) (where.push('agent = ?'), args.push(filter.agent));
  if (filter.status) (where.push('status = ?'), args.push(filter.status));
  if (filter.before) (where.push('id < ?'), args.push(filter.before));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return sql()
    .prepare(`SELECT * FROM runs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, Math.min(filter.limit ?? 50, 500), Math.max(filter.offset ?? 0, 0)) as RunRow[];
}

export function getRun(id: number): (RunRow & { events: unknown[] }) | undefined {
  const row = sql().prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  if (!row) return undefined;
  const events = sql().prepare('SELECT at, kind, message, data FROM run_events WHERE run_id = ? ORDER BY id').all(id) as {
    data: string | null;
  }[];
  return { ...row, events: events.map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null })) };
}

/** Deletes finished runs, with their events and logs (or only counts them with `preview`). Running runs are never deleted. */
export function deleteRuns(filter: { ids?: number[]; before?: string; agent?: string; preview?: boolean }): number {
  const where = ["status != 'running'"];
  const args: (string | number)[] = [];
  if (filter.ids?.length) (where.push(`id IN (${filter.ids.map(() => '?').join(',')})`), args.push(...filter.ids));
  if (filter.before) (where.push('started_at < ?'), args.push(filter.before));
  if (filter.agent) (where.push('agent = ?'), args.push(filter.agent));
  if (!filter.ids?.length && !filter.before && !filter.agent) throw new Error('refusing to delete without a filter');
  const ids = (sql().prepare(`SELECT id FROM runs WHERE ${where.join(' AND ')}`).all(...args) as { id: number }[]).map((r) => r.id);
  if (filter.preview) return ids.length;
  for (const id of ids) {
    sql().prepare('DELETE FROM runs WHERE id = ?').run(id);
    rmSync(join(env.paths.logs, 'runs', String(id)), { recursive: true, force: true });
  }
  return ids.length;
}

export function runFiles(id: number): string[] {
  const dir = join(env.paths.logs, 'runs', String(id));
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}
