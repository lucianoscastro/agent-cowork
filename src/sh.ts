import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
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

/**
 * What the platform's own git runs with in a checkout an agent wrote to: that checkout's hooks, fsmonitor, credential
 * helpers, `ext::` remotes and signing program never run. Exported for tests.
 */
export const GIT_HARDENING = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'credential.helper=',
  '-c', 'credential.helper=!gh auth git-credential',
  '-c', 'protocol.ext.allow=never',
  '-c', 'commit.gpgSign=false',
];
const GIT_NETWORK = new Set(['clone', 'fetch', 'push', 'ls-remote']);
/** What gh and network git need from this process's environment besides safeEnv(): a proxy and its certificates. */
const NETWORK_ENV = /^(https?_proxy|no_proxy|all_proxy|ssl_cert_file|ssl_cert_dir|git_ssl_cainfo)$/i;
let githubToken: string | undefined;
/** The GitHub token, held here and never in the process environment, which every child would inherit. */
export const setGithubToken = (token: string | undefined) => void (githubToken = token);

/**
 * The arguments and environment of the platform's own `gh` and `git`: only gh and the git commands that talk to GitHub
 * get the token, git ignores the global config (on the agents' writable HOME) and the hardening above. A caller's own
 * environment is kept. Exported for tests.
 */
// ponytail: agents run as the platform's own Linux user, so filters, textconv and merge drivers an agent writes into a
// checkout's config still run on local git commands (without the token). Running agents as another user ends that.
export function platformCommand(cmd: string, args: string[], env?: NodeJS.ProcessEnv): { args: string[]; env?: NodeJS.ProcessEnv } {
  if (cmd !== 'git' && cmd !== 'gh') return { args, env };
  const network = cmd === 'gh' || GIT_NETWORK.has(gitSubcommand(args) ?? '');
  return {
    args: cmd === 'git' ? [...GIT_HARDENING, ...args] : args,
    env: env ?? gitEnv(network),
  };
}

/** The environment of the platform's own git and gh; with `network`, a proxy's settings and the GitHub token. */
const gitEnv = (network: boolean) =>
  safeEnv({
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    ...(network ? Object.fromEntries(Object.entries(process.env).filter(([k]) => NETWORK_ENV.test(k))) : {}),
    ...(network && githubToken ? { GH_TOKEN: githubToken } : {}),
  });

/** A git command line's subcommand, past `-C <dir>`, `-c <key=value>` and options written `--name=value`. */
function gitSubcommand(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-C' || args[i] === '-c') i++;
    else if (!args[i].startsWith('-')) return args[i];
  }
  return undefined;
}

/** A repository's GitHub URL: the platform fetches from and pushes to it itself, whatever a checkout's remotes say. */
const githubUrl = (repo: string) => `https://github.com/${repo}.git`;

/**
 * Runs `fn` with a bare repository only the platform wrote, which borrows the objects of the repository at `cache`
 * (alternates): a command holding the GitHub token never reads a checkout's config, which an agent can write (a proxy
 * that turns TLS checks off, a credential helper, an askpass program, a pushurl).
 */
async function cleanRepo<T>(cache: string, fn: (gitDir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'agentcowork-git-'));
  try {
    await run('git', ['init', '--bare', '--quiet', dir]);
    await writeFile(join(dir, 'objects', 'info', 'alternates'), `${resolve(cache, 'objects')}\n`);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Fetches refspecs (`+src:dst`) from `url` into the bare repository at `cache`: downloaded with the token into a clean
 * repository (only what `cache` lacks: its refs count as had), then copied in from there without it. Exported for tests.
 */
export function fetchInto(cache: string, url: string, refspecs: string[]): Promise<void> {
  return cleanRepo(cache, async (clean) => {
    await run('git', [`--git-dir=${clean}`, 'fetch', '--no-tags', '--quiet', url, ...refspecs]);
    const fetched = refspecs.map((r) => r.slice(r.indexOf(':') + 1)).map((ref) => `+${ref}:${ref}`);
    await run('git', ['-C', cache, 'fetch', '--no-tags', '--quiet', clean, ...fetched], { env: gitEnv(false) });
  });
}

/** Pushes `sha` from the bare repository at `cache` to a branch at `url`, from a clean repository. Exported for tests. */
export function pushFrom(cache: string, url: string, sha: string, branch: string, { force = false } = {}): Promise<string> {
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error(`Not a commit to push: ${sha.slice(0, 80)}`);
  return cleanRepo(cache, (clean) => run('git', [`--git-dir=${clean}`, 'push', '--quiet', ...(force ? ['--force'] : []), url, `${sha}:refs/heads/${branch}`]));
}

/** Pushes a checkout's HEAD to a branch of its repository on GitHub. */
export async function pushBranch(work: Checkout, repo: string, branch: string, opts: { force?: boolean } = {}): Promise<void> {
  await pushFrom(work.cache, githubUrl(repo), await run('git', ['rev-parse', 'HEAD'], { cwd: work.dir }), branch, opts);
}

/** Fetches branches straight from GitHub into a checkout's `origin/` refs, so a check reads them as GitHub has them. */
export function fetchBranches(work: Checkout, repo: string, branches: string[]): Promise<void> {
  return withLock(work.cache, () => fetchInto(work.cache, githubUrl(repo), branches.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`)));
}

export async function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const platform = platformCommand(cmd, args, opts.env);
  const pending = execFileAsync(cmd, platform.args, {
    cwd: opts.cwd,
    env: platform.env,
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

export const REDACTED = '[REDACTED]';

/** Masks every secret value that appears in a text (logs, a serialized HAR, a database error). */
export function maskSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const v of secrets.filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(v).join(REDACTED);
  return out;
}

// Untrusted code (repo scripts, agent runtimes) gets an allow-listed environment: never the GitHub,
// Jira or provider credentials the orchestrator holds.
const SAFE_ENV = /^(PATH|HOME|LANG|LC_\w+|TZ|TMPDIR|TERM|DOTNET_\w+|NUGET_PACKAGES|npm_config_\w+|PLAYWRIGHT_BROWSERS_PATH|GIT_(AUTHOR|COMMITTER)_\w+)$/;

export function safeEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (SAFE_ENV.test(k)) out[k] = v;
  return { ...out, ...extra };
}

/** Text people wrote, for a prompt: it cannot close the tags prompts wrap untrusted text in and pass the rest off as instructions. */
export const untrusted = (text: string) => text.replace(/<\/?\s*(replies|signals|outcome|pr_description|brain-note|issue|comments)\b[^>]*>/gi, '');

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
        githubUrl(repo), cache,
      ]);
    }
    await fetchInto(cache, githubUrl(repo), refspecs);
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
