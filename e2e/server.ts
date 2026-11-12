import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN, PORT } from './admin.ts';

// Starts the real server against a throwaway data dir. HOME points there too: startup links files into
// ~/.claude and ~/.gemini, which must not touch the developer's own home.
const dir = mkdtempSync(join(tmpdir(), 'agentcowork-e2e-'));
Object.assign(process.env, {
  HOME: dir,
  DATA_DIR: join(dir, 'data'),
  BACKUPS_DIR: join(dir, 'backups-not-mounted'),
  UI_PORT: String(PORT),
  ADMIN_USERNAME: ADMIN.username,
  ADMIN_PASSWORD: ADMIN.password,
  AGENTCOWORK_SECRET_KEY: 'e2e-secret-key-0123456789',
});
const cleanup = () => rmSync(dir, { recursive: true, force: true });
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(0));

await import('../src/main.ts');
