import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { asset } from './assets.ts';
import { env } from './env.ts';

const execFileAsync = promisify(execFile);

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const RECENT_LOG_LINES = 300;
/** Tail of the log for the UI. */
export const recentLogs: string[] = [];

export function log(...args: unknown[]): void {
  const parts = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)));
  const line = [new Date().toISOString(), `[${env.instanceName}]`, ...parts].join(' ');
  console.log(line);
  recentLogs.push(line);
  if (recentLogs.length > RECENT_LOG_LINES) recentLogs.shift();
}

export async function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const pending = execFileAsync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    signal: opts.signal,
    maxBuffer: 64 * 1024 * 1024,
  });
  // A child that exits before reading its input (git often does) makes this write fail with EPIPE: unhandled,
  // that error would crash the whole process. The exit code and output still report what happened.
  pending.child.stdin?.on('error', () => {});
  pending.child.stdin?.end(opts.input ?? '');
  try {
    return (await pending).stdout.trim();
  } catch (err) {
    if (opts.signal?.aborted) throw new Error(`${cmd} stopped: ${String(opts.signal.reason ?? 'aborted')}`);
    const { stdout, stderr, code } = err as { stdout?: string; stderr?: string; code?: unknown };
    const output = (stderr?.trim() || stdout?.trim() || (err as Error).message).slice(-2000);
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed (${code}): ${output}`);
  }
}

// Untrusted code (repo scripts, agent runtimes) gets an allow-listed environment: never the GitHub,
// Jira or provider credentials the orchestrator holds.
const SAFE_ENV = /^(PATH|HOME|LANG|LC_\w+|TZ|TMPDIR|TERM|DOTNET_\w+|NUGET_PACKAGES|npm_config_\w+|PLAYWRIGHT_BROWSERS_PATH|GIT_(AUTHOR|COMMITTER)_\w+)$/;

export function safeEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (SAFE_ENV.test(k)) out[k] = v;
  return { ...out, ...extra };
}

export async function renderPrompt(name: string, vars: Record<string, string>): Promise<string> {
  const template = await readFile(asset(`prompts/${name}.md`).path, 'utf8');
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

/** Runs fn over items with at most `limit` in flight. fn must handle its own errors. */
export async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const locks = new Map<string, Promise<unknown>>();

/** Serializes calls sharing a key; calls with different keys run in parallel. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const result = (locks.get(key) ?? Promise.resolve()).then(fn);
  locks.set(key, result.catch(() => {}));
  return result;
}

export type Checkout = { cache: string; dir: string };

/**
 * Fetches refspecs into the repo's cached bare clone and adds a private worktree for one job.
 * Git operations on the shared clone are serialized per repo; the agent work itself runs in parallel.
 */
export function checkout(
  repo: string,
  refspecs: string[],
  commitish: string,
  opts: { branch?: string; dir?: string } = {},
): Promise<Checkout> {
  const cache = join(env.paths.work, 'repos', repo.replace('/', '__'));
  return withLock(cache, async () => {
    if (!existsSync(cache)) {
      // HTTPS + gh as the only credential helper: always this instance's GitHub token, never a host SSH key.
      await run('git', [
        'clone', '--bare',
        '--config', 'credential.helper=',
        '--config', 'credential.helper=!gh auth git-credential',
        `https://github.com/${repo}.git`, cache,
      ]);
    }
    await run('git', ['-C', cache, 'fetch', 'origin', ...refspecs]);
    const dir = opts.dir ?? join(env.paths.work, 'worktrees', `${basename(cache)}-${randomUUID().slice(0, 8)}`);
    const target = opts.branch ? ['-B', opts.branch] : ['--detach'];
    if (opts.branch) await freeBranch(cache, opts.branch);
    await run('git', ['-C', cache, 'worktree', 'add', '--force', ...target, dir, commitish]);
    return { cache, dir };
  });
}

/**
 * A branch still checked out in another worktree was left by a run a restart killed (one run per card):
 * git refuses to reuse it, so that worktree goes. Exported for tests.
 */
export async function freeBranch(cache: string, branch: string): Promise<void> {
  const list = await run('git', ['-C', cache, 'worktree', 'list', '--porcelain']);
  for (const block of list.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    // The exact line: ai/ABC-1 must not match ai/ABC-10, another card's live checkout.
    if (path && block.split('\n').includes(`branch refs/heads/${branch}`)) await run('git', ['-C', cache, 'worktree', 'remove', '--force', path]);
  }
}

export function removeCheckout({ cache, dir }: Checkout): Promise<void> {
  return withLock(cache, async () => {
    await run('git', ['-C', cache, 'worktree', 'remove', '--force', dir]);
  });
}
