import { join } from 'node:path';

/**
 * Bootstrap settings: the only configuration read from the environment. Everything else lives in the
 * database and is edited in the admin UI.
 */
const dataDir = process.env.DATA_DIR ?? './data';

export const env = {
  instanceName: process.env.INSTANCE_NAME ?? 'agentcowork',
  port: Number(process.env.UI_PORT ?? 8080),
  adminUsername: process.env.ADMIN_USERNAME ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  secretKey: process.env.AGENTCOWORK_SECRET_KEY ?? '',
  backupsDir: process.env.BACKUPS_DIR ?? '/backups',
  paths: {
    db: join(dataDir, 'db'),
    work: join(dataDir, 'work'),
    auth: join(dataDir, 'auth'),
    logs: join(dataDir, 'logs'),
    // Project brains (Markdown vaults); bind-mount it to open them in Obsidian.
    brain: process.env.BRAIN_DIR ?? join(dataDir, 'brain'),
  },
};

/** Refuses to start without the bootstrap secrets: there would be no way to log in or decrypt secrets. */
export function assertBootstrap(): void {
  const missing = [
    !env.adminUsername && 'ADMIN_USERNAME',
    !env.adminPassword && 'ADMIN_PASSWORD',
    env.secretKey.length < 16 && 'AGENTCOWORK_SECRET_KEY (at least 16 characters)',
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing bootstrap environment: ${missing.join(', ')}`);
}
