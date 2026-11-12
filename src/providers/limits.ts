import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderId } from '../config.ts';
import { sql } from '../db.ts';
import { notify } from '../notify.ts';

/** One usage window of an account plan, e.g. the 5-hour or the 7-day window. */
export type LimitWindow = { name: string; usedPercent: number; resetsAt: string | null };
/** What a provider last reported about its account's limits. `limitedUntil` set: the account is blocked. */
export type ProviderLimits = { windows: LimitWindow[]; limitedUntil: string | null; plan?: string; at: string };

const iso = (epochSeconds: unknown) => (typeof epochSeconds === 'number' ? new Date(epochSeconds * 1000).toISOString() : null);
const windowName = (minutes: number) => (minutes % 1440 === 0 ? `${minutes / 1440} days` : `${Math.round(minutes / 60)} hours`);

/** The last `rate_limit_event` of a Claude Code stream. Exported for tests. */
export function claudeLimits(events: Record<string, unknown>[]): Omit<ProviderLimits, 'at'> | undefined {
  const info = events.findLast((e) => e.type === 'rate_limit_event')?.rate_limit_info as
    | { status?: string; resetsAt?: number; unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }> }
    | undefined;
  if (!info) return undefined;
  const names: Record<string, string> = { five_hour: '5 hours', seven_day: '7 days' };
  const windows = Object.entries(info.unifiedWindows ?? {}).map(([k, w]) => ({
    name: names[k] ?? k.replace(/_/g, ' '),
    usedPercent: Math.round((w.utilization ?? 0) * 100),
    resetsAt: iso(w.resetsAt),
  }));
  return { windows, limitedUntil: info.status === 'rejected' ? iso(info.resetsAt) : null };
}

type CodexWindow = { used_percent?: number; window_minutes?: number; resets_at?: number } | null;
type CodexRateLimits = { primary?: CodexWindow; secondary?: CodexWindow; plan_type?: string; rate_limit_reached_type?: string | null };

/** The `rate_limits` Codex records in its session file. Exported for tests. */
export function codexLimits(r: CodexRateLimits): Omit<ProviderLimits, 'at'> {
  const windows = [r.primary, r.secondary]
    .filter((w): w is NonNullable<CodexWindow> => Boolean(w))
    .map((w) => ({ name: windowName(w.window_minutes ?? 0), usedPercent: Math.round(w.used_percent ?? 0), resetsAt: iso(w.resets_at) }));
  const full = windows.filter((w) => w.usedPercent >= 100 && w.resetsAt).map((w) => w.resetsAt!);
  return { windows, limitedUntil: r.rate_limit_reached_type ? (full.sort().at(-1) ?? null) : null, plan: r.plan_type };
}

/**
 * The last rate limits with usage windows in a Codex session. Codex also records other buckets (e.g.
 * `limit_id: "premium"`) without windows, which would hide the plan's 5-hour and 7-day usage. Exported for tests.
 */
export function lastCodexWindows(session: string): Omit<ProviderLimits, 'at'> | undefined {
  const all = session
    .split('\n')
    .filter((l) => l.includes('"rate_limits"'))
    .map((l) => (JSON.parse(l) as { payload?: { rate_limits?: CodexRateLimits } }).payload?.rate_limits)
    .filter((r): r is CodexRateLimits => Boolean(r));
  const found = all.findLast((r) => r.primary || r.secondary) ?? all.at(-1);
  return found ? codexLimits(found) : undefined;
}

type AgyUsage = { groups?: { name: string; buckets?: { window?: string; remaining_fraction?: number; reset_time?: string }[] }[] };

/**
 * The `/usage` command of agy (`agy -p /usage --output-format json`, no model call): one window per model
 * group and bucket. No `limitedUntil`: a spent group blocks only its models, and the pause a failed run
 * records must survive this refresh. Exported for tests.
 */
export function agyLimits(data: AgyUsage): Pick<ProviderLimits, 'windows'> {
  const names: Record<string, string> = { '5h': '5 hours', weekly: '7 days' };
  const windows = (data.groups ?? []).flatMap((g) =>
    (g.buckets ?? []).map((b) => ({
      name: `${g.name}: ${names[b.window ?? ''] ?? b.window}`,
      usedPercent: Math.round((1 - (b.remaining_fraction ?? 1)) * 100),
      resetsAt: b.reset_time ?? null,
    })),
  );
  return { windows };
}

/** Codex writes each session to <home>/sessions/YYYY/MM/DD/rollout-…-<thread id>.jsonl: today's or yesterday's folder. */
export function codexSessionLimits(home: string, threadId: string): Omit<ProviderLimits, 'at'> | undefined {
  for (const day of [0, 1]) {
    const d = new Date(Date.now() - day * 86_400_000);
    const dir = join(home, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((f) => f.endsWith(`${threadId}.jsonl`));
    if (!file) continue;
    return lastCodexWindows(readFileSync(join(dir, file), 'utf8'));
  }
  return undefined;
}

export function recordLimits(provider: ProviderId, limits: Partial<Omit<ProviderLimits, 'at'>>): void {
  const wasBlocked = blockedUntil(provider) !== undefined;
  const merged = { ...readLimits(provider), ...limits, at: new Date().toISOString() };
  sql()
    .prepare('INSERT INTO limits (provider, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(provider, JSON.stringify(merged), merged.at);
  const until = Date.parse(merged.limitedUntil ?? '');
  if (!wasBlocked && until > Date.now()) {
    notify('limit', { title: `${provider} paused: usage limit reached`, text: `Agents using ${provider} wait until ${new Date(until).toISOString().slice(0, 16).replace('T', ' ')} UTC, then carry on.` });
  }
}

export function readLimits(provider: ProviderId): ProviderLimits | undefined {
  const row = sql().prepare('SELECT data FROM limits WHERE provider = ?').get(provider) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as ProviderLimits) : undefined;
}

/** Until when the provider's account is blocked (epoch ms), if it still is. */
/** The latest reset of a usage window already full (100% or more), if any: the account cannot run before it. */
export function fullWindowReset(provider: ProviderId, now = Date.now()): number | undefined {
  const resets = (readLimits(provider)?.windows ?? []).filter((w) => w.usedPercent >= 100).map((w) => Date.parse(w.resetsAt ?? '')).filter((t) => t > now);
  return resets.length ? Math.max(...resets) : undefined;
}

export function blockedUntil(provider: ProviderId): number | undefined {
  const until = Date.parse(readLimits(provider)?.limitedUntil ?? '');
  return until > Date.now() ? until : undefined;
}
