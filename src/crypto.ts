import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60_000;

function derive(secret: string, purpose: string): Buffer {
  return scryptSync(secret, `agentcowork:${purpose}`, 32);
}

/** AES-256-GCM with a key derived from AGENTCOWORK_SECRET_KEY. Output: base64(iv | tag | ciphertext). */
export function encrypt(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(secret, 'secrets'), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decrypt(secret: string, encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', derive(secret, 'secrets'), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/** Constant-time comparison that does not leak the length of the expected value. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/** Stateless signed session: base64url(json) + '.' + HMAC. Restarting with a new key logs everyone out. */
export function signSession(secret: string, username: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: now + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${createHmac('sha256', derive(secret, 'session')).update(payload).digest('base64url')}`;
}

export function verifySession(secret: string, token: string | undefined, now = Date.now()): string | undefined {
  if (!token) return undefined;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return undefined;
  const expected = createHmac('sha256', derive(secret, 'session')).update(payload).digest('base64url');
  if (!safeEqual(mac, expected)) return undefined;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: string; exp: number };
    return exp > now ? u : undefined;
  } catch {
    return undefined;
  }
}
