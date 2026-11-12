import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export type StreamResult = { stdout: string; stderr: string; code: number | null };

/**
 * Runs a runtime CLI, teeing stdout to a transcript file as it streams. Unlike execFile it keeps no
 * output-size ceiling on the transcript, and it kills the process when the run's signal aborts.
 */
export function spawnStream(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; input?: string; signal: AbortSignal; transcript: string },
): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, signal: opts.signal, stdio: ['pipe', 'pipe', 'pipe'] });
    const file = createWriteStream(opts.transcript, { flags: 'a' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      file.write(chunk);
      // ponytail: keeps the whole stdout in memory for parsing; runtimes print a few MB at most per call.
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-20_000);
    });
    child.on('error', (err) => {
      file.end();
      reject(opts.signal.aborted ? new Error(`${cmd} stopped: ${String(opts.signal.reason ?? 'aborted')}`) : err);
    });
    child.on('close', (code) => {
      file.end();
      resolve({ stdout, stderr, code });
    });
    // A runtime that exits before reading its prompt (bad flag, no credentials) fails this write with EPIPE;
    // unhandled it would crash the process, while the exit code and stderr already report the failure.
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input ?? '');
  });
}

/** Parses JSONL output, skipping lines that are not JSON objects (banners, progress). */
export function jsonLines(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .map((line) => {
      try {
        const v = JSON.parse(line);
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    })
    .filter((v): v is Record<string, unknown> => Boolean(v));
}
