import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SECRETS } from '../config.ts';
import { getSecret } from '../db.ts';
import { env } from '../env.ts';
import { log, safeEnv } from '../sh.ts';
import type { ProviderRequest, ProviderResult } from './index.ts';
import { authMethod, homes } from './index.ts';
import { codexLimits, codexSessionLimits, recordLimits } from './limits.ts';
import { jsonLines, spawnStream } from './process.ts';

function credentials(): NodeJS.ProcessEnv {
  const base = { CODEX_HOME: homes.codex };
  if (authMethod('codex') !== 'api-key') return base;
  const key = getSecret(SECRETS.providerApiKey('codex'));
  return { ...base, OPENAI_API_KEY: key, CODEX_API_KEY: key };
}

type AppWindow = { usedPercent?: number; windowDurationMins?: number; resetsAt?: number } | null;
type AppLimits = { primary?: AppWindow; secondary?: AppWindow; planType?: string; rateLimitReachedType?: string | null };

/** The app server's rate limits in the shape Codex writes to its session files. Exported for tests. */
export const fromAppServer = (r: AppLimits) => {
  const w = (x: AppWindow | undefined) => x && { used_percent: x.usedPercent, window_minutes: x.windowDurationMins, resets_at: x.resetsAt };
  return codexLimits({ primary: w(r.primary), secondary: w(r.secondary), plan_type: r.planType, rate_limit_reached_type: r.rateLimitReachedType });
};

/**
 * Reads the account's usage windows from `codex app-server` (`account/rateLimits/read`): no model call, so it
 * also works while the account is blocked, when runs report no windows. Never throws.
 */
export async function refreshCodexLimits(): Promise<void> {
  if (authMethod('codex') === 'api-key' || !existsSync(join(homes.codex, 'auth.json'))) return;
  const child = spawn('codex', ['app-server'], { cwd: env.paths.work, env: safeEnv(credentials()), stdio: ['pipe', 'pipe', 'ignore'] });
  try {
    const result = await new Promise<{ rateLimits?: AppLimits }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer in 20 s')), 20_000);
      let buffer = '';
      child.on('error', reject);
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        for (const line of buffer.split('\n').slice(0, -1)) {
          let msg: { id?: number; result?: { rateLimits?: AppLimits }; error?: { message?: string } };
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // not a protocol message: thrown here, it would crash the process
          }
          if (msg.id !== 2) continue;
          clearTimeout(timer);
          if (msg.error) reject(new Error(msg.error.message ?? 'error'));
          else resolve(msg.result ?? {});
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
      });
      child.stdin.write(
        [
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'agentcowork', version: '1' } } },
          { jsonrpc: '2.0', method: 'initialized' },
          { jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read' },
        ].map((m) => JSON.stringify(m)).join('\n') + '\n',
      );
    });
    if (result.rateLimits) recordLimits('codex', fromAppServer(result.rateLimits));
  } catch (err) {
    log('codex: reading the account limits failed:', (err as Error).message);
  } finally {
    child.kill();
  }
}

/**
 * OpenAI structured outputs only accept strict schemas: every object closes with
 * `additionalProperties: false` and lists all its properties as required.
 */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = strictSchema(v);
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}

export async function runCodex<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
  const schemaFile = join(req.run.logDir, `${req.label}.schema.json`);
  const outFile = join(req.run.logDir, `${req.label}.out.json`);
  const transcript = req.run.transcript(req.label);
  await writeFile(schemaFile, JSON.stringify(strictSchema(req.schema)));
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--cd', req.cwd,
    // Codex's bubblewrap sandbox cannot create namespaces inside the hardened container (no capabilities,
    // no-new-privileges), so the container is the sandbox and the platform enforces read-only by reverting
    // any change a read-only call makes (see guardReadOnly).
    '--sandbox', 'danger-full-access',
    '--output-schema', schemaFile,
    '--output-last-message', outFile,
    ...(req.model ? ['--model', req.model] : []),
    '-',
  ];
  const out = await spawnStream('codex', args, {
    cwd: req.cwd,
    env: safeEnv(credentials()),
    input: req.prompt,
    signal: req.run.signal,
    transcript,
  });
  const events = jsonLines(out.stdout);
  const thread = events.find((e) => e.type === 'thread.started')?.thread_id;
  const limits = typeof thread === 'string' ? codexSessionLimits(homes.codex, thread) : undefined;
  // A blocked account reports only a windowless bucket: keep the windows read earlier.
  if (limits?.windows.length) recordLimits('codex', limits);
  const usage = events.findLast((e) => e.type === 'turn.completed')?.usage as Record<string, number> | undefined;
  let text: string;
  try {
    text = await readFile(outFile, 'utf8');
  } catch {
    const failure = events.findLast((e) => e.type === 'turn.failed' || e.type === 'error');
    throw new Error(`codex exited ${out.code} without an answer: ${JSON.stringify(failure ?? out.stderr.slice(-500))}`.slice(0, 1000));
  }
  try {
    // OpenAI counts cached input inside input_tokens.
    const cached = usage?.cached_input_tokens ?? 0;
    return {
      output: JSON.parse(text) as T,
      usage: { inputTokens: usage?.input_tokens === undefined ? undefined : usage.input_tokens - cached, cacheReadTokens: cached, outputTokens: usage?.output_tokens },
    };
  } catch {
    throw new Error(`codex answer is not JSON: ${text.slice(0, 300)}`);
  }
}
