import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULTS_DIR = join(import.meta.dirname, '..', 'defaults');
// Operators replace shipped defaults by mounting files or folders here (read-only); the UI only reports it.
const overridesDir = () => process.env.OVERRIDES_DIR ?? '/overrides';

export type AssetSource = 'default' | 'custom';

/** Resolves a shipped asset (`AGENTS.md`, `skills`, `prompts/review.md`…), preferring an override. */
export function asset(relPath: string): { path: string; source: AssetSource } {
  const custom = join(overridesDir(), relPath);
  return existsSync(custom) ? { path: custom, source: 'custom' } : { path: join(DEFAULTS_DIR, relPath), source: 'default' };
}
