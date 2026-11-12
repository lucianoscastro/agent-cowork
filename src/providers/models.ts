import { type ProviderId, SECRETS } from '../config.ts';
import { getSecret } from '../db.ts';
import { run, safeEnv } from '../sh.ts';
import { authMethod, homes, providerStatus } from './index.ts';

export type ModelOption = { id: string; label: string };

const CACHE_MS = 10 * 60_000;
const cache = new Map<ProviderId, { at: number; models: ModelOption[] }>();

// Claude Code resolves these aliases to the newest model of each family.
const CLAUDE_ALIASES: ModelOption[] = [
  { id: 'opus', label: 'opus · newest Opus' },
  { id: 'sonnet', label: 'sonnet · newest Sonnet' },
  { id: 'haiku', label: 'haiku · newest Haiku' },
];

async function claudeModels(): Promise<ModelOption[]> {
  const apiKey = authMethod('claude') === 'api-key';
  const headers: Record<string, string> = apiKey
    ? { 'x-api-key': getSecret(SECRETS.providerApiKey('claude')) ?? '' }
    : { Authorization: `Bearer ${getSecret(SECRETS.claudeOauthToken) ?? ''}`, 'anthropic-beta': 'oauth-2025-04-20' };
  const res = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { ...headers, 'anthropic-version': '2023-06-01' } });
  if (!res.ok) throw new Error(`Anthropic models: ${res.status}`);
  const { data } = (await res.json()) as { data: { id: string; display_name?: string }[] };
  return [...CLAUDE_ALIASES, ...data.map((m) => ({ id: m.id, label: m.display_name ? `${m.id} · ${m.display_name}` : m.id }))];
}

async function codexModels(): Promise<ModelOption[]> {
  const key = authMethod('codex') === 'api-key' ? getSecret(SECRETS.providerApiKey('codex')) : undefined;
  const out = await run('codex', ['debug', 'models'], {
    env: safeEnv({ CODEX_HOME: homes.codex, ...(key ? { OPENAI_API_KEY: key, CODEX_API_KEY: key } : {}) }),
    timeoutMs: 30_000,
  });
  const { models } = JSON.parse(out) as { models: { slug: string; display_name?: string; description?: string; visibility?: string }[] };
  // Hidden entries are internal (auto-review, reserves), not models an agent should pick.
  return models
    .filter((m) => m.visibility !== 'hide')
    .map((m) => ({ id: m.slug, label: [m.slug, m.description].filter(Boolean).join(' · ') }));
}

async function agyModels(): Promise<ModelOption[]> {
  const key = authMethod('agy') === 'api-key' ? getSecret(SECRETS.providerApiKey('agy')) : undefined;
  const out = await run('agy', ['models'], { env: safeEnv(key ? { GEMINI_API_KEY: key } : {}), timeoutMs: 30_000 });
  // ponytail: parses the first slug-like token of each line; switch to a JSON flag if agy adds one.
  return out
    .split('\n')
    .map((line) => line.trim().match(/^([a-z0-9][\w.-]*\d[\w.-]*)\b\s*(.*)$/i))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ id: m[1], label: m[2] ? `${m[1]} · ${m[2]}` : m[1] }));
}

/** Models the configured account can use, for suggestions in the UI. Cached for 10 minutes. */
export async function listModels(id: ProviderId, refresh = false): Promise<ModelOption[]> {
  const cached = cache.get(id);
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.models;
  const status = providerStatus(id);
  if (!status.ready) throw new Error(status.reason);
  const models = await (id === 'claude' ? claudeModels() : id === 'codex' ? codexModels() : agyModels());
  cache.set(id, { at: Date.now(), models });
  return models;
}
