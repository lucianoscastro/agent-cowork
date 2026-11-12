import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { read, verifyCommands } from '../config.ts';
import type { Run } from '../runs.ts';
import { run as sh, safeEnv } from '../sh.ts';

const VERIFY_TIMEOUT_MS = 30 * 60_000;
const FAILURE_TAIL = 2000;

/**
 * Runs one command, appending its output to the run's verify transcript as it comes, so the live view
 * shows it. Resolves with the exit code and the output tail.
 */
export function streamCommand(
  run: Run,
  transcript: string,
  role: string,
  command: string,
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ code: number; tail: string }> {
  const write = (e: object) => appendFileSync(transcript, `${JSON.stringify(e)}\n`);
  write({ type: 'verify.start', role, command });
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', `(${command}) 2>&1`], { cwd, env: safeEnv(opts.env), signal: run.signal, stdio: ['ignore', 'pipe', 'pipe'] });
    const timeoutMs = opts.timeoutMs ?? VERIFY_TIMEOUT_MS;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    let tail = '';
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      tail = (tail + text).slice(-FAILURE_TAIL);
      write({ type: 'verify.out', text });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const exit = code ?? (signal ? 128 : 1);
      write({ type: 'verify.end', code: exit, timedOut: signal === 'SIGKILL' });
      resolve({ code: exit, tail: signal === 'SIGKILL' && !run.signal.aborted ? `${tail}\n(timed out after ${timeoutMs / 60_000} min)` : tail });
    });
  });
}

/** The verify commands for a repository in the projects registry (its own, or its stack's defaults). */
export function verifyCommandsFor(repo: string): string[] | undefined {
  for (const project of read('projects').items) {
    for (const r of Object.values(project.repos)) if (r.repo === repo) return verifyCommands(r);
  }
  return undefined;
}

/**
 * Runs a repository's verify commands in order, with no credentials in the environment (the code under
 * test is untrusted). Returns the first failure (command and output tail), or undefined when all pass.
 * Build and test artifacts that are not git-ignored are dropped afterwards so they never get committed.
 */
export async function runVerify(run: Run, dir: string, role: string, commands: string[]): Promise<string | undefined> {
  // One transcript per verify round: files are written one after another, which keeps the live view in order.
  const earlier = existsSync(run.logDir) ? readdirSync(run.logDir).filter((f) => f.startsWith('verify-')).length : 0;
  const round = earlier + 1;
  const transcript = run.transcript(`verify-${round}-${role.replace(/[^\w.-]/g, '_')}`);
  try {
    for (const command of commands) {
      run.checkpoint();
      run.event('info', `${role}: ${command}`);
      const { code, tail } = await streamCommand(run, transcript, role, command, dir);
      run.checkpoint();
      if (code !== 0) return `\`${role}\`: \`${command}\` failed (exit ${code}):\n${tail.trim()}`;
    }
    return undefined;
  } finally {
    await sh('git', ['checkout', '--', '.'], { cwd: dir });
    await sh('git', ['clean', '-fd'], { cwd: dir });
  }
}
