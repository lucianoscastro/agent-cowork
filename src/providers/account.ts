import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ProviderId, SECRETS } from '../config.ts';
import { getSecret, getSetting, secretUpdatedAt } from '../db.ts';
import { CLAUDE_ACCOUNT } from './login.ts';
import { authMethod, homes } from './index.ts';

/** Who a provider is connected as, for the Providers page. Never carries a token. */
export type AccountInfo = {
  email?: string;
  name?: string;
  plan?: string;
  /** Organization ID, when that is all the login reveals (Claude). */
  organization?: string;
  since?: string;
  until?: string;
  /** What `until` is: the subscription's end, or the token's. */
  untilLabel?: string;
  /** Last four characters of a stored API key. */
  keyHint?: string;
  note?: string;
};

const YEAR_MS = 365 * 86_400_000;

/** The payload of a JWT, read without verifying it: display only, never for a decision. Exported for tests. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const readJson = (path: string): Record<string, any> | undefined => { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  } catch {
    return undefined;
  }
};

export function accountInfo(id: ProviderId): AccountInfo | undefined {
  if (authMethod(id) === 'api-key') {
    const name = SECRETS.providerApiKey(id);
    const key = getSecret(name);
    return key ? { keyHint: `••••${key.slice(-4)}`, since: secretUpdatedAt(name) } : undefined;
  }
  if (id === 'claude') {
    const since = secretUpdatedAt(SECRETS.claudeOauthToken);
    if (!since) return undefined;
    const { organizationId, email, name, organizationName } = getSetting<{ organizationId?: string | null; email?: string; name?: string; organizationName?: string }>(CLAUDE_ACCOUNT, {});
    if (email) {
      return { email, name, plan: organizationName && `organization ${organizationName}`, since, until: new Date(Date.parse(since) + YEAR_MS).toISOString(), untilLabel: 'token valid until' };
    }
    return {
      since,
      until: new Date(Date.parse(since) + YEAR_MS).toISOString(),
      untilLabel: 'token valid until',
      organization: organizationId ?? undefined,
      note: organizationId
        ? 'Subscription token from claude setup-token: it does not carry the email. Compare the organization ID with claude.ai → Settings → Organization (Team and Enterprise) to confirm it is the company account.'
        : 'Subscription token from claude setup-token. It only allows using the models, so it cannot tell which account it belongs to.',
    };
  }
  if (id === 'codex') {
    const auth = readJson(join(homes.codex, 'auth.json'));
    const idToken = auth?.tokens?.id_token;
    if (typeof idToken !== 'string') return undefined;
    const claims = jwtClaims(idToken);
    // The token's organizations are API platform orgs ("Personal"), not the ChatGPT workspace: not shown.
    const openai = (claims['https://api.openai.com/auth'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      email: claims.email as string | undefined,
      name: claims.name as string | undefined,
      plan: openai.chatgpt_plan_type ? `ChatGPT ${openai.chatgpt_plan_type}` : undefined,
      since: auth?.last_refresh,
      until: openai.chatgpt_subscription_active_until,
      untilLabel: 'subscription until',
    };
  }
  if (!existsSync(homes.agyAccountMarker)) return undefined;
  const token = readJson(join(homes.agy, 'antigravity-cli', 'antigravity-oauth-token'));
  return { email: token?.id_token_email, plan: 'Google account', since: readFileSync(homes.agyAccountMarker, 'utf8').trim() };
}
