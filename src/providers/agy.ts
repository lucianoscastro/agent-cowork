import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SECRETS } from '../config.ts';
import { getSecret } from '../db.ts';
import { log, run as sh, safeEnv } from '../sh.ts';
import type { ProviderRequest, ProviderResult } from './index.ts';
import { authMethod, homes } from './index.ts';
import { agyLimits, recordLimits } from './limits.ts';
import { spawnStream } from './process.ts';

/** The API-key mode needs `modelProvider: gemini` in the CLI settings; account mode must not have it. */
async function configure(): Promise<NodeJS.ProcessEnv> {
  const apiKey = authMethod('agy') === 'api-key';
  const dir = join(homes.agy, 'antigravity-cli');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'settings.json'), JSON.stringify(apiKey ? { modelProvider: 'gemini' } : {}));
  return apiKey ? { GEMINI_API_KEY: getSecret(SECRETS.providerApiKey('agy')) } : {};
}

/** Records the account's quota after a run, for the usage page. Never throws: the quota is informative. */
export async function refreshUsage(cwd: string): Promise<void> {
  // The quota belongs to the Google account; with an API key there is none to read.
  if (authMethod('agy') === 'api-key' || !existsSync(homes.agyAccountMarker)) return;
  try {
    const out = await sh('agy', ['-p', '/usage', '--output-format', 'json', '--print-timeout', '30s'], { cwd, env: safeEnv(await configure()), timeoutMs: 45_000 });
    const data = (JSON.parse(out) as { command?: { name?: string; data?: Parameters<typeof agyLimits>[0] } }).command;
    if (data?.name === 'usage' && data.data) recordLimits('agy', agyLimits(data.data));
  } catch (err) {
    log('agy: reading /usage failed:', (err as Error).message);
  }
}

// Headless agy denies every command it was not approved for, and a review that cannot run `git diff`
// or `ls` answers nothing. As with Codex, the container is the sandbox: approvals are skipped in both
// modes and read-only calls are reverted afterwards by guardReadOnly (see providers/index.ts).
export async function runAgy<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
  const args = [
    '-p', req.prompt,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(req.schema),
    ...(req.model ? ['--model', req.model] : []),
    '--dangerously-skip-permissions',
  ];
  const out = await spawnStream('agy', args, {
    cwd: req.cwd,
    env: safeEnv(await configure()),
    signal: req.run.signal,
    transcript: req.run.transcript(req.label),
  });
  void refreshUsage(req.cwd);
  let envelope: {
    status?: string;
    error?: string;
    structured_output?: T;
    usage?: Record<string, number>;
    denied_actions?: { display_name?: string }[];
  };
  try {
    envelope = JSON.parse(out.stdout);
  } catch {
    throw new Error(`agy exited ${out.code} without JSON: ${(out.stderr || out.stdout).slice(-500)}`);
  }
  if (envelope.status !== 'SUCCESS' || envelope.structured_output === undefined) {
    const denied = envelope.denied_actions?.map((a) => a.display_name).join(', ');
    const reason = envelope.error ?? (envelope.status === 'SUCCESS' ? 'no structured output' : envelope.status);
    throw new Error(`agy: ${reason}${denied ? ` (denied: ${denied})` : ''}`.slice(0, 1000));
  }
  return {
    output: envelope.structured_output,
    // Gemini counts cached input inside the input tokens.
    usage: {
      inputTokens: envelope.usage?.input_tokens === undefined ? undefined : envelope.usage.input_tokens - (envelope.usage.cache_read_tokens ?? 0),
      cacheReadTokens: envelope.usage?.cache_read_tokens,
      outputTokens: envelope.usage?.output_tokens,
    },
  };
}
