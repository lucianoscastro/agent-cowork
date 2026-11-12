import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ProviderId, SECRETS } from '../config.ts';
import { audit, deleteSecret, putSetting, setSecret } from '../db.ts';
import { safeEnv } from '../sh.ts';
import { homes } from './index.ts';

export type LoginState = {
  provider: ProviderId;
  status: 'starting' | 'paste-code' | 'finishing' | 'done' | 'failed';
  /** URL the admin opens in a browser. */
  url?: string;
  /** What the admin pastes back: the code the browser shows, or the callback address (Codex). */
  paste?: 'code' | 'callback-url';
  message?: string;
};

const LOGIN_TIMEOUT_MS = 15 * 60_000;
/** After the code is sent, the CLI finishes in seconds; past this it is stuck (a rejected code, a new prompt). */
const FINISH_TIMEOUT_MS = 2 * 60_000;
// eslint-disable-next-line no-control-regex
const SECRETISH = /(sk-ant-[\w-]+|ya29\.[\w.-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)/g;

/** The CLI's last words, for the admin: printable, short, and with anything token-like masked. Exported for tests. */
export function lastWords(raw: string): string {
  const lines = stripAnsi(raw)
    .split('\n')
    .map((l) => l.replace(/[^\x20-\x7e\u00a0-\uffff]/g, '').trim())
    .filter((l) => l.length > 2 && !/^[─━═╭╮╰╯│┃\s]+$/.test(l));
  return lines.slice(-3).join(' · ').replace(SECRETISH, '[hidden]').slice(-300);
}
type Session = { state: LoginState; child: ChildProcessWithoutNullStreams; output: string; sentAt: number; checking?: boolean };

/**
 * claude setup-token asks only for `user:inference`, which cannot read who the account is. Asking for
 * `user:profile` too lets the token read the account's email and organization. Exported for tests.
 */
export function withProfileScope(url: string): string {
  const u = new URL(url);
  const scopes = new Set((u.searchParams.get('scope') ?? '').split(/\s+/).filter(Boolean));
  if (scopes.has('user:profile')) return url;
  scopes.add('user:profile');
  u.searchParams.set('scope', [...scopes].join(' '));
  return u.toString();
}

/** The account a Claude token belongs to, when the token may read its profile. */
async function claudeProfile(token: string): Promise<{ email?: string; name?: string; organizationName?: string } | undefined> {
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/profile', { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' } });
    if (!res.ok) return undefined;
    const p = (await res.json()) as { account?: { email?: string; full_name?: string; display_name?: string }; organization?: { name?: string } };
    return { email: p.account?.email, name: p.account?.full_name ?? p.account?.display_name, organizationName: p.organization?.name };
  } catch {
    return undefined;
  }
}

/** Where what the API told about the connected Claude account is kept (not secret). */
export const CLAUDE_ACCOUNT = 'providers.claude.account';

/**
 * Proves a Claude token works before it is saved, with the free model list. The response names the
 * token's organization, the only account detail an inference-only token can reveal.
 */
export async function checkClaudeToken(token: string): Promise<{ ok: boolean; organizationId?: string; error?: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, organizationId: res.headers.get('anthropic-organization-id') ?? undefined };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
const sessions = new Map<ProviderId, Session>();

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '').replace(/\r/g, '');

/** Pulls what the admin needs from a CLI's login output. Exported for tests. */
export function parseLoginOutput(provider: ProviderId, raw: string): { url?: string; token?: string } {
  if (provider === 'claude') {
    // The URL is printed as an OSC-8 hyperlink; take it before stripping escape codes.
    const url = raw.match(/https:\/\/claude\.com\/cai\/oauth\/authorize\?[^\x07\x1b\s]+/)?.[0];
    // The terminal is wide enough for the token to fit on one line (see command()); it counts only once
    // something follows it, since output arrives in chunks and half a token must never be saved.
    const token = stripAnsi(raw).match(/sk-ant-oat01-[\w-]{20,}(?=\s)/)?.[0];
    return { url, token };
  }
  const text = stripAnsi(raw);
  if (provider === 'codex') return { url: text.match(/https:\/\/auth\.openai\.com\/oauth\/authorize\?\S+/)?.[0] };
  return { url: text.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?\S+/)?.[0] };
}

function command(provider: ProviderId): [string, string[], NodeJS.ProcessEnv] {
  if (provider === 'claude') {
    // setup-token draws its UI with Ink and prints nothing without a TTY; `script` provides one.
    // A wide terminal keeps the printed token on one line: a wrapped one cannot be told apart from the
    // text printed after it.
    return ['script', ['-qfec', 'stty cols 500 rows 50 2>/dev/null; claude setup-token', '/dev/null'], safeEnv({ TERM: 'xterm-256color' })];
  }
  // Browser flow, not --device-auth (workspaces can disable device codes). Codex waits for the OAuth
  // redirect on 127.0.0.1:1455 inside the container; the admin pastes that redirect address back.
  if (provider === 'codex') return ['codex', ['login'], safeEnv({ CODEX_HOME: homes.codex })];
  // agy prints a Google sign-in URL and waits (60 s) for the pasted code, but only on a TTY.
  return ['script', ['-qfec', "agy -p 'Reply with OK.' --output-format json", '/dev/null'], safeEnv({ TERM: 'xterm-256color' })];
}

export function loginState(provider: ProviderId): LoginState | undefined {
  return sessions.get(provider)?.state;
}

/** Starts an account login; the UI polls loginState() for the URL and the next step. */
export function startLogin(provider: ProviderId, actor: string): LoginState {
  cancelLogin(provider);
  const [cmd, args, env] = command(provider);
  const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const session: Session = { state: { provider, status: 'starting' } as LoginState, child, output: '', sentAt: 0 };
  sessions.set(provider, session);
  const timer = setTimeout(() => {
    session.state = { ...session.state, status: 'failed', message: 'Login timed out' };
    child.kill();
  }, LOGIN_TIMEOUT_MS);

  const onOutput = (chunk: Buffer) => {
    session.output = (session.output + chunk.toString('utf8')).slice(-100_000);
    const found = parseLoginOutput(provider, session.output);
    if (found.token && provider === 'claude' && !session.checking && session.state.status !== 'done') {
      session.checking = true;
      session.state = { ...session.state, status: 'finishing', message: 'Checking the token…' };
      void checkClaudeToken(found.token).then((check) => {
        if (!check.ok) {
          session.state = { provider, status: 'failed', message: `The token the CLI printed does not work (${check.error}). Start again.` };
        } else {
          setSecret(SECRETS.claudeOauthToken, found.token!);
          return claudeProfile(found.token!).then((profile) => {
            putSetting(CLAUDE_ACCOUNT, { ...profile, organizationId: check.organizationId ?? null, checkedAt: new Date().toISOString() });
            const who = profile?.email ?? (check.organizationId ? `organization ${check.organizationId}` : '');
            audit(actor, 'provider.login', `claude account connected${who ? ` (${who})` : ''}`);
            session.state = { provider, status: 'done', message: `Claude account connected${profile?.email ? ` as ${profile.email}` : ''}` };
          });
        }
      }).finally(() => child.kill());
      return;
    }
    if (found.url && session.state.status === 'starting') {
      const url = provider === 'claude' ? withProfileScope(found.url) : found.url;
      session.state = { provider, status: 'paste-code', url, paste: provider === 'codex' ? 'callback-url' : 'code' };
    }
    // While finishing, show what the CLI says (an error, a new prompt) instead of a silent spinner.
    if (session.state.status === 'finishing') {
      const words = lastWords(session.output.slice(session.sentAt));
      if (words) session.state = { ...session.state, message: words };
    }
  };
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);
  child.on('error', (err) => (session.state = { provider, status: 'failed', message: err.message }));
  child.on('close', (code) => {
    clearTimeout(timer);
    if (session.state.status === 'done' || session.state.status === 'failed') return;
    if (code === 0 && provider !== 'claude') {
      if (provider === 'agy') writeFileSync(homes.agyAccountMarker, new Date().toISOString());
      audit(actor, 'provider.login', `${provider} account connected`);
      session.state = { provider, status: 'done', message: `${provider} account connected` };
    } else {
      session.state = { provider, status: 'failed', message: stripAnsi(session.output).trim().slice(-400) || `exit ${code}` };
    }
  });
  return session.state;
}

/** Codex's OAuth redirect: only its own local callback, so a pasted URL can never reach anywhere else. */
const CODEX_CALLBACK = /^http:\/\/(127\.0\.0\.1|localhost):1455(\/auth\/callback\?[\w%&=.~+-]+)$/;

/**
 * Hands what the browser produced back to the waiting CLI: the code (Claude, agy), or for Codex the
 * redirect address, which is replayed against Codex's login server inside the container.
 */
export async function submitLoginCode(provider: ProviderId, code: string): Promise<LoginState> {
  const pasted = code.trim();
  // Validate before anything reaches the CLI. Codex: only its own local callback. Others: any visible
  // ASCII (Google codes look like 4/0AV…), so no spaces or control characters can reach the terminal.
  const callback = provider === 'codex' ? pasted.match(CODEX_CALLBACK) : null;
  if (provider === 'codex' && !callback) {
    throw new Error('Paste the whole address the browser opened, starting with http://127.0.0.1:1455/auth/callback?');
  }
  if (provider !== 'codex' && !/^[\x21-\x7e]{4,4096}$/.test(pasted)) throw new Error('That does not look like a login code');
  const session = sessions.get(provider);
  if (!session || session.state.status !== 'paste-code') throw new Error('No login is waiting for a code');
  if (callback) {
    session.state = { ...session.state, status: 'finishing', message: 'Finishing login…' };
    const res = await fetch(`http://127.0.0.1:1455${callback[2]}`).catch((err: Error) => ({ ok: false, status: err.message }));
    if (!res.ok) session.state = { ...session.state, status: 'failed', message: `Codex rejected the callback (${res.status}). Start again.` };
    return session.state;
  }
  // Both code prompts run on a pseudo-terminal, where Enter is a carriage return. Enter goes on its own:
  // terminal UIs read one chunk with text and Enter as a paste, and keep waiting for the real Enter.
  session.sentAt = session.output.length;
  session.child.stdin.write(pasted);
  setTimeout(() => session.child.stdin.write('\r'), 400);
  session.state = { ...session.state, status: 'finishing', message: 'Code sent, finishing login…' };
  setTimeout(() => {
    if (sessions.get(provider) !== session || session.state.status !== 'finishing') return;
    session.state = { provider, status: 'failed', message: `The CLI did not finish: ${lastWords(session.output.slice(session.sentAt)) || 'no answer'}. Start again.` };
    session.child.kill();
  }, FINISH_TIMEOUT_MS);
  return session.state;
}

export function cancelLogin(provider: ProviderId): void {
  sessions.get(provider)?.child.kill();
  sessions.delete(provider);
}

/** Forgets an account login: the stored token (Claude) or the CLI's credential files (Codex, agy). */
export function disconnectAccount(provider: ProviderId): void {
  cancelLogin(provider);
  if (provider === 'claude') {
    putSetting(CLAUDE_ACCOUNT, {});
    return deleteSecret(SECRETS.claudeOauthToken);
  }
  if (provider === 'codex') return rmSync(join(homes.codex, 'auth.json'), { force: true });
  rmSync(join(homes.agy, 'antigravity-cli', 'antigravity-oauth-token'), { force: true });
  rmSync(homes.agyAccountMarker, { force: true });
}
