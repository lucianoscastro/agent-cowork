import { existsSync } from 'node:fs';
import { cp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { sql } from './db.ts';
import { env } from './env.ts';
import { log } from './sh.ts';

const KEEP = 7;
const DAY_MS = 86_400_000;

/** Daily online backup of the database, the CLI logins and the project brains into BACKUPS_DIR, keeping the last 7 days. */
export function startBackups(): void {
  if (!existsSync(env.backupsDir)) {
    log(`backups: ${env.backupsDir} is not mounted, skipping`);
    return;
  }
  const once = async () => {
    try {
      const day = new Date().toISOString().slice(0, 10);
      await backup(sql(), join(env.backupsDir, `db-${day}.sqlite`));
      // Replace today's copy whole: cp refuses to overwrite a link (codex/skills) left by an earlier start the same day.
      const authCopy = join(env.backupsDir, `auth-${day}`);
      await rm(authCopy, { recursive: true, force: true });
      await cp(env.paths.auth, authCopy, { recursive: true, verbatimSymlinks: true });
      if (existsSync(env.paths.brain)) {
        const brainCopy = join(env.backupsDir, `brain-${day}`);
        await rm(brainCopy, { recursive: true, force: true });
        await cp(env.paths.brain, brainCopy, { recursive: true });
      }
      const old = (await readdir(env.backupsDir)).filter((f) => /^(db|auth|brain)-\d{4}-\d{2}-\d{2}/.test(f)).sort();
      for (const prefix of ['db-', 'auth-', 'brain-']) {
        const mine = old.filter((f) => f.startsWith(prefix));
        for (const f of mine.slice(0, Math.max(0, mine.length - KEEP))) await rm(join(env.backupsDir, f), { recursive: true, force: true });
      }
      log(`backups: saved ${day}`);
    } catch (err) {
      log('backups failed:', (err as Error).message);
    }
  };
  void once();
  setInterval(once, DAY_MS).unref();
}
