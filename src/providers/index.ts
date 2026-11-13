import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { asset } from '../assets.ts';
import { type AuthMethod, PROVIDERS, type ProviderId, read, SECRETS } from '../config.ts';
import { getSecret, LIMIT_ERROR } from '../db.ts';
import { env } from '../env.ts';
import type { ToolServer } from '../databases.ts';
import type { Run } from '../runs.ts';
import { run as sh } from '../sh.ts';
import { refreshUsage, runAgy } from './agy.ts';
import { runClaude } from './claude.ts';
import { refreshCodexLimits, runCodex } from './codex.ts';
import { blockedUntil, fullWindowReset, recordLimits } from './limits.ts';

export type Subagent = { description: string; prompt: string; model?: string };

export type ProviderRequest = {
  run: Run;
  /** Transcript name for this call, e.g. "plan-1". */
  label: string;
  prompt: string;
  schema: object;
  cwd: string;
  mode: 'read-only' | 'write';
  model?: string;
  subagents?: Record<string, Subagent>;
  /** An MCP config file giving the model browser tools (Playwright MCP); Claude only. */
  browser?: string;
  /** The platform's own tools (the project's databases) for this call; runtimes that cannot reach them work without. */
  tools?: ToolServer;
  /** Providers to fall back to only after the others, e.g. the other reviewer's, to keep reviews independent. */
  avoid?: ProviderId[];
};

/**
 * Tokens of one call, comparable across runtimes: `inputTokens` are fresh input (cache reads excluded),
 * cache reads and writes are apart. Only Claude reports a cost, its estimate at API prices.
 */
export type Usage = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number };
export type ProviderResult<T> = { output: T; usage: Usage };

export const homes = {
  codex: join(env.paths.auth, 'codex'),
  agy: join(env.paths.auth, 'agy'),
  agyAccountMarker: join(env.paths.auth, 'agy', '.agentcowork-account'),
};

/**
 * Keeps the usage page current between runs, and while an account is blocked (its runs then report nothing):
 * Codex and agy answer a usage query without a model call. Claude has no such query, so its runs report it.
 */
export function startLimitRefresh(): void {
  const once = () => void Promise.all([refreshCodexLimits(), refreshUsage(env.paths.work)]);
  once();
  setInterval(once, 10 * 60_000).unref();
}

/**
 * Prepares each runtime's home on the persistent auth volume and links the resolved instructions and
 * skills where each runtime looks for them. HOME itself is a tmpfs, so links are recreated at startup.
 */
export function prepareRuntimeHomes(): void {
  const link = (target: string, at: string) => {
    rmSync(at, { force: true });
    symlinkSync(target, at);
  };
  const claudeHome = join(homedir(), '.claude');
  mkdirSync(claudeHome, { recursive: true });
  if (!existsSync(join(claudeHome, 'CLAUDE.md'))) link(asset('AGENTS.md').path, join(claudeHome, 'CLAUDE.md'));
  if (!existsSync(join(claudeHome, 'skills'))) link(asset('skills').path, join(claudeHome, 'skills'));

  mkdirSync(homes.codex, { recursive: true, mode: 0o700 });
  link(asset('AGENTS.md').path, join(homes.codex, 'AGENTS.md'));
  link(asset('skills').path, join(homes.codex, 'skills'));

  mkdirSync(join(homes.agy, 'antigravity-cli'), { recursive: true, mode: 0o700 });
  link(asset('AGENTS.md').path, join(homes.agy, 'GEMINI.md'));
  const gemini = join(homedir(), '.gemini');
  if (!existsSync(gemini)) symlinkSync(homes.agy, gemini);
}

export function authMethod(id: ProviderId): AuthMethod {
  return read(`providers.${id}`).authMethod;
}

const LIMIT_PAUSE_MS = 60 * 60_000;

/**
 * When a provider error is a usage or spend limit, until when to pause it: the reset time the message
 * names ("resets 1:30am (UTC)", or an epoch after "|"), else an hour. Exported for tests.
 */
export function limitPause(message: string, now = Date.now()): number | undefined {
  if (!LIMIT_ERROR.test(message)) return undefined;
  const epoch = /\|(\d{10})\b/.exec(message);
  if (epoch) return Number(epoch[1]) * 1000;
  const at = /resets? (?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(UTC\)/i.exec(message);
  if (!at) return now + LIMIT_PAUSE_MS;
  const meridiem = at[3]?.toLowerCase();
  const hour = meridiem ? (Number(at[1]) % 12) + (meridiem === 'pm' ? 12 : 0) : Number(at[1]);
  const reset = new Date(now);
  reset.setUTCHours(hour, Number(at[2] ?? 0), 0, 0);
  if (reset.getTime() <= now) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.getTime();
}

/** Whether a runtime has usable credentials, and why not. */
export function providerStatus(id: ProviderId): { ready: boolean; reason?: string; paused?: boolean; authMethod: AuthMethod } {
  const method = authMethod(id);
  const missing = (reason: string) => ({ ready: false, reason, authMethod: method });
  // Paused after a usage or spend limit, until its reset: agents using the provider stay off meanwhile.
  const until = blockedUntil(id);
  if (until) return { ...missing(`${id}: usage limit reached, paused until ${new Date(until).toISOString().slice(11, 16)} UTC`), paused: true };
  if (method === 'api-key') {
    return getSecret(SECRETS.providerApiKey(id)) ? { ready: true, authMethod: method } : missing(`${id}: no API key set`);
  }
  if (id === 'claude') {
    return getSecret(SECRETS.claudeOauthToken) ? { ready: true, authMethod: method } : missing('claude: account not logged in');
  }
  if (id === 'codex') {
    return existsSync(join(homes.codex, 'auth.json')) ? { ready: true, authMethod: method } : missing('codex: account not logged in');
  }
  return existsSync(homes.agyAccountMarker) ? { ready: true, authMethod: method } : missing('agy: account not logged in');
}

export function defaultModel(id: ProviderId): string {
  return read(`providers.${id}`).defaultModel;
}

/**
 * The providers a call may use, in order: the chosen one, then the others in the fixed order Claude, Codex,
 * agy, those to avoid last. Only the chosen one when fallback is off in General. Exported for tests.
 */
export function fallbackOrder(id: ProviderId, avoid: ProviderId[] = [], on = read('general').fallback): ProviderId[] {
  if (!on) return [id];
  const rest = PROVIDERS.filter((p) => p !== id);
  return [id, ...rest.filter((p) => !avoid.includes(p)), ...rest.filter((p) => avoid.includes(p))];
}

/** Like providerStatus, for an agent using `id`: ready when it or a provider it falls back to is ready. */
export function routeStatus(id: ProviderId): ReturnType<typeof providerStatus> {
  return fallbackOrder(id).map(providerStatus).find((s) => s.ready) ?? providerStatus(id);
}

/**
 * Runs one prompt and returns its structured answer: on the chosen provider, or, when it is paused or hits a
 * usage limit, on the next one in fallbackOrder with that provider's default model. Any other error fails
 * the call as it is (a broken prompt or test would fail on every provider). Browser calls need Claude.
 */
export async function runProvider<T>(id: ProviderId, req: ProviderRequest): Promise<ProviderResult<T>> {
  let failure: Error | undefined;
  for (const p of req.browser ? [id] : fallbackOrder(id, req.avoid)) {
    const status = providerStatus(p);
    if (!status.ready) {
      failure ??= new Error(status.reason);
      continue;
    }
    if (failure) req.run.event('info', `${req.label}: ${failure.message.slice(0, 200)}; trying ${p}`);
    try {
      return await callProvider<T>(p, { ...req, model: p === id ? req.model : '' });
    } catch (err) {
      if (!limitPause((err as Error).message)) throw err;
      failure = err as Error;
    }
  }
  throw failure!;
}

async function callProvider<T>(id: ProviderId, req: ProviderRequest): Promise<ProviderResult<T>> {
  req.run.checkpoint();
  const model = req.model || defaultModel(id) || undefined;
  req.run.event('info', `${req.label}: ${id}${model ? ` (${model})` : ''}, ${req.mode}`);
  if (req.browser && id !== 'claude') throw new Error(`${req.label}: browser tools need Claude Code`);
  const call = () =>
    id === 'claude' ? runClaude<T>({ ...req, model }) : id === 'codex' ? runCodex<T>({ ...req, model }) : runAgy<T>({ ...req, model });
  const guarded = () => (req.mode === 'read-only' ? guardReadOnly(req.run, req.label, req.cwd, call) : call());
  const result = await guarded().catch((err: Error) => {
    // The provider's own report (rate limit event, session file) names the exact reset; else a window already
    // full; else the error text (an hour when it names none). Only a limit error pauses.
    const guess = limitPause(err.message);
    const until = guess && (blockedUntil(id) ?? fullWindowReset(id) ?? guess);
    if (until) recordLimits(id, { limitedUntil: new Date(until).toISOString() });
    throw err;
  });
  req.run.event('usage', `${req.label}: usage`, { ...result.usage, provider: id, model: model ?? 'default' });
  return result;
}

/** Git checkouts at `cwd` or one level below it (a workspace holds one checkout per role). */
function checkouts(cwd: string): string[] {
  if (existsSync(join(cwd, '.git'))) return [cwd];
  return readdirSync(cwd, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(cwd, d.name, '.git')))
    .map((d) => join(cwd, d.name));
}

/**
 * Read-only enforced by the platform, whatever the runtime: snapshot HEAD and the working tree of every
 * checkout before the call, then revert anything the call changed and record it on the run.
 */
export async function guardReadOnly<T>(run: Run, label: string, cwd: string, call: () => Promise<T>): Promise<T> {
  const state = async (dir: string) => ({
    head: await sh('git', ['rev-parse', 'HEAD'], { cwd: dir }),
    status: await sh('git', ['status', '--porcelain'], { cwd: dir }),
  });
  const before = new Map<string, { head: string; status: string }>();
  for (const dir of checkouts(cwd)) before.set(dir, await state(dir));
  try {
    return await call();
  } finally {
    for (const [dir, was] of before) {
      const now = await state(dir);
      if (now.head === was.head && now.status === was.status) continue;
      run.event('warn', `${label}: a read-only call changed ${dir}; reverted`, { before: was, after: now });
      await sh('git', ['reset', '--hard', was.head], { cwd: dir });
      await sh('git', ['clean', '-fd'], { cwd: dir });
    }
  }
}
