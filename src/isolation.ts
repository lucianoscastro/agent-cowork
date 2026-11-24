import { type ChildProcess, execFileSync, spawn, type StdioOptions } from 'node:child_process';
import { chmodSync, chownSync, constants, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proxyEnv } from './egress.ts';
import { env } from './env.ts';
import { log, safeEnv } from './sh.ts';

/**
 * Agents run as a second Linux user, `agent`: their runtimes and every command from a repository. That user cannot
 * read the platform's process (its environment holds the secret key), database, logs, brains or backups, and it holds
 * no capability. The platform switches to it with setpriv; it may when the container starts as the compose example
 * says (see entrypoint.sh). Otherwise agents run as the platform's own user, and the admin UI says so.
 */
export type AgentUser = { uid: number; gid: number };

/** The platform's capabilities this needs: KILL stops agent processes, DAC_OVERRIDE reads and removes what they wrote. */
const NEEDED = { CAP_DAC_OVERRIDE: 1, CAP_KILL: 5, CAP_SETGID: 6, CAP_SETUID: 7 };

function findAgentUser(): { user?: AgentUser; reason?: string } {
  try {
    const entry = readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.startsWith('agent:'))?.split(':');
    if (!entry) return { reason: 'the image has no agent user' };
    const user = { uid: Number(entry[2]), gid: Number(entry[3]) };
    if (process.getuid?.() === user.uid) return { reason: 'the platform itself runs as the agent user' };
    const effective = BigInt(`0x${/^CapEff:\s*([0-9a-f]+)/m.exec(readFileSync('/proc/self/status', 'utf8'))?.[1] ?? '0'}`);
    const missing = Object.entries(NEEDED).filter(([, bit]) => !(effective & (1n << BigInt(bit)))).map(([name]) => name);
    if (missing.length) return { reason: `the container does not give the platform ${missing.join(', ')} (see compose.example.yaml)` };
    return { user };
  } catch (err) {
    return { reason: (err as Error).message };
  }
}

const found = findAgentUser();
/** The agents' own user, when the platform can run them as it; undefined runs them as the platform's user. */
export const AGENT: AgentUser | undefined = found.user;
/** Why agents run as the platform's user, for the admin UI. */
export const isolationOff = found.reason;

/** A command line that runs `cmd` as `user` with no capabilities, or as it is without a user. Exported for tests. */
export function agentCommand(cmd: string, args: string[], user = AGENT): [string, string[]] {
  if (!user) return [cmd, args];
  return ['setpriv', [`--reuid=${user.uid}`, `--regid=${user.gid}`, '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '--', cmd, ...args]];
}

/** Opens a folder of the platform's to the agents' group: what is created in it later keeps that group. */
function share(dir: string, user = AGENT): void {
  if (!user) return;
  chownSync(dir, -1, user.gid);
  chmodSync(dir, 0o2770);
}

/**
 * Reads a file an agent could have written, or replaced with a link: as the agents' user, so a link to the platform's
 * data or process reads nothing, and within a time and a size, so a pipe or a device cannot hold the platform.
 */
export function readAgentFile(path: string, maxBytes = 64 * 1024 * 1024): Buffer {
  const [cmd, args] = agentCommand('cat', ['--', path]);
  return execFileSync(cmd, args, { env: safeEnv(), stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, maxBuffer: maxBytes });
}

/** The flags of a write where an agent can write too: never through a link it left in the file's place. */
export const NO_FOLLOW = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;

/** A new folder the agents' user can write, for one call or command; the caller removes it. */
export function agentDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentcowork-${name}-`));
  share(dir);
  return dir;
}

/**
 * The environment of an agent process: safeEnv, its own HOME, the platform's proxy (egress.ts) and git's ownership
 * check off, as the platform owns the checkouts. Exported for tests.
 */
export function agentEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return safeEnv({ HOME: home, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*', ...proxyEnv(), ...extra });
}

let running = 0;
let sweeping = false;
/**
 * From now on, when the last agent process exits, what agents left running is killed: a server or watcher that left
 * its process group, now an orphan (its parent is process 1). Only the platform turns it on.
 */
export const killLeftoversWhenIdle = () => void (sweeping = true);

/** Starts an agent process: as the agents' user, with agentEnv and `home` as HOME, or a fresh HOME removed when it exits. */
// ponytail: one user for all runs, so a process an agent leaves lives on while another run's agent works; a user per
// run would end it at its own run's end.
export function spawnAgent(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; home?: string; stdio?: StdioOptions; detached?: boolean; signal?: AbortSignal },
): ChildProcess {
  const home = opts.home ?? agentDir('home');
  const [command, argv] = agentCommand(cmd, args);
  const child = spawn(command, argv, { cwd: opts.cwd, env: agentEnv(home, opts.env), stdio: opts.stdio, detached: opts.detached, signal: opts.signal });
  running++;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    if (!opts.home) rmSync(home, { recursive: true, force: true });
    if (--running === 0 && sweeping) killLeftovers();
  };
  child.once('exit', end);
  child.once('error', end);
  return child;
}

/** Runs an agent process to its end: its standard output, or an error with the end of what it printed. */
export function runAgent(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; home?: string; timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])]);
    const child = spawnAgent(cmd, args, { cwd: opts.cwd, env: opts.env, home: opts.home, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let out = '';
    let err = '';
    child.stdout?.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (err = (err + c.toString('utf8')).slice(-2000)));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed (${code}): ${(err.trim() || out.trim()).slice(-2000)}`))));
  });
}

/**
 * Kills the orphaned processes of the agents' user. A process whose parent still runs is spared, such as one of a
 * script run beside the platform (the golden set).
 */
function killLeftovers(): void {
  if (!AGENT) return;
  for (const pid of readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      if (/^Uid:\s+(\d+)/m.exec(status)?.[1] === String(AGENT.uid) && /^PPid:\s+1$/m.test(status)) process.kill(Number(pid), 'SIGKILL');
    } catch {
      // gone meanwhile
    }
  }
}

/**
 * Opens a tree of the platform's to the agents' group: folders get the group, its write and setgid, files its read and
 * write. Skipped when the top folder already has them: done last, it marks a tree done. Exported for tests.
 */
export function shareTree(dir: string, gid: number): void {
  mkdirSync(dir, { recursive: true });
  const top = lstatSync(dir);
  if (top.gid === gid && top.mode & 0o2000) return;
  const walk = (path: string) => {
    const st = lstatSync(path);
    // Links keep their target's mode; what another user wrote is theirs to keep.
    if (st.isSymbolicLink() || st.uid !== process.getuid?.()) return;
    if (st.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
    chownSync(path, -1, gid);
    chmodSync(path, st.isDirectory() ? (st.mode & 0o7777) | 0o2070 : (st.mode & 0o7777) | 0o060);
  };
  walk(dir);
}

/**
 * Readies the data folders at start: the platform's own closed to other users, the checkouts and the package caches
 * open to the agents' group. New files are group-writable (umask), so both users can change them. The runtimes' logins
 * belong to the agents' user (entrypoint.sh). The repository caches stay the platform's: agents read them through their
 * checkouts but cannot write their config.
 */
export function prepareIsolation(): void {
  if (!AGENT) {
    log(`Agents run as the platform's own user: ${isolationOff}`);
    return;
  }
  process.umask(0o002);
  const attempt = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      log(`isolation: ${what}: ${(err as Error).message}`);
    }
  };
  for (const dir of [env.paths.db, env.paths.logs, env.paths.brain, env.backupsDir]) {
    attempt(`closing ${dir}`, () => {
      const mode = lstatSync(dir).mode & 0o7777;
      if (mode & 0o007) chmodSync(dir, mode & 0o7770);
    });
  }
  attempt(`opening ${env.paths.auth}`, () => (chownSync(env.paths.auth, -1, AGENT.gid), chmodSync(env.paths.auth, 0o750)));
  for (const dir of ['worktrees', 'cache', 'brain-runs'].map((d) => join(env.paths.work, d))) {
    attempt(`sharing ${dir}`, () => shareTree(dir, AGENT.gid));
  }
  log(`Agents run as their own user (uid ${AGENT.uid})`);
}
