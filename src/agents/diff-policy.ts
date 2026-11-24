import { basename, posix } from 'node:path';
import { CREDENTIAL_HINTS, CREDENTIAL_SHAPES } from '../brain.ts';
import { run as sh } from '../sh.ts';

/**
 * The platform's own checks on what a push carries, whatever the prompts said. `blocked` stops the push: CI definitions
 * (a pushed branch runs them with the repository's secrets) and added lines shaped like a credential. `warnings` go to
 * the reviewer and the pull request: what may be a credential, deleted or skipped tests, a lockfile changed without its
 * manifest, files outside the plan, planned tests missing, a large change.
 */
export type DiffFindings = { blocked: string[]; warnings: string[] };

const CI = /^\.github\/(workflows|actions)\//;
/** Test files by their usual places and names, across stacks. */
export const TEST_FILE = /(^|\/)(tests?|__tests__|specs?)\/|\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.cs$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/i;
const SKIP = /\b(it|test|describe)\.(skip|only)\(|\bx(it|describe|test)\(|\[(Fact|Theory)\([^)]*Skip\s*=|\[Ignore\b|@Disabled\b|pytest\.mark\.skip|\bt\.Skip(Now)?\(/;
/** Each lockfile and the manifest that changes with it, in the same folder. */
const LOCKS: Record<string, RegExp> = {
  'package-lock.json': /^package\.json$/,
  'yarn.lock': /^package\.json$/,
  'pnpm-lock.yaml': /^package\.json$/,
  'packages.lock.json': /\.(cs|fs|vb)proj$|^Directory\.Packages\.props$/,
  'poetry.lock': /^pyproject\.toml$/,
  'uv.lock': /^pyproject\.toml$/,
  'Cargo.lock': /^Cargo\.toml$/,
  'go.sum': /^go\.mod$/,
  'Gemfile.lock': /^Gemfile$/,
  'composer.lock': /^composer\.json$/,
};
/** Changed lines past which a change is worth splitting. */
const LARGE_DIFF = 2000;


/**
 * Checks the change of the checkout in `dir` from `base` (the pull request's content). With `since` (the remote
 * branch), only files this push changes count, so commits already on the pull request and a merged-in base don't come
 * up again. `folder` is the checkout's folder, which prefixes paths as the plan names them. Exported for tests.
 */
export async function checkDiff(
  dir: string,
  base: string,
  opts: { since?: string; planned?: string[]; tests?: string[]; folder?: string } = {},
): Promise<DiffFindings> {
  // git's own diff whatever the checkout's config or attributes say (an agent writes them): no external diff program
  // or textconv, every file as text, no colors, NUL-separated names (none quoted, whatever characters they hold), and
  // paths that are only paths, never pathspec magic such as `:(exclude)`.
  const git = (args: string[]) =>
    sh('git', ['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--text', '--no-color', '--no-renames', ...args], { cwd: dir });
  const range = `${base}...HEAD`;
  const nul = (text: string) => text.split('\0').filter(Boolean);
  const pushed = opts.since ? new Set(nul(await git(['-z', '--name-only', opts.since, 'HEAD']))) : undefined;
  const fields = nul(await git(['-z', '--name-status', range]));
  const changed = fields
    .flatMap((status, i) => (i % 2 ? [] : [{ status, path: fields[i + 1] }]))
    .filter((f) => !pushed || pushed.has(f.path));
  if (!changed.length) return { blocked: [], warnings: [] };
  const paths = changed.map((f) => f.path);
  const only = pushed ? ['--', ...paths] : [];
  const where = (p: string) => (opts.folder ? `${opts.folder}/${p}` : p);

  // The patch lists the files in the order of `paths`, one `diff --git` section each; a `+` line counts only inside a
  // hunk, so an added line that reads like a header (`++ x` shows as `+++ x`) is still an added line.
  const added: { path: string; line: string }[] = [];
  let section = -1;
  let inHunk = false;
  for (const l of (await git(['--unified=0', range, ...only])).split('\n')) {
    if (l.startsWith('diff --git ')) [section, inHunk] = [section + 1, false];
    else if (l.startsWith('@@')) inHunk = true;
    else if (inHunk && l.startsWith('+')) added.push({ path: paths[section] ?? '', line: l.slice(1) });
  }
  const filesWith = (res: RegExp[]) => [...new Set(added.filter((a) => res.some((re) => re.test(a.line))).map((a) => where(a.path)))];

  const blocked = [
    ...paths.filter((p) => CI.test(p)).map((p) => `\`${where(p)}\` changes CI, which a pushed branch runs with the repository's secrets`),
    ...filesWith(CREDENTIAL_SHAPES).map((p) => `\`${p}\` adds a line shaped like a credential (a token, an access key or a private key)`),
  ];

  const warnings = [
    ...filesWith(CREDENTIAL_HINTS).map((p) => `\`${p}\` adds a URL with a password or a JWT: check it is not a real credential`),
    ...changed.filter((f) => f.status === 'D' && TEST_FILE.test(f.path)).map((f) => `\`${where(f.path)}\` (a test file) is deleted`),
    ...filesWith([SKIP]).map((p) => `\`${p}\` skips or focuses tests`),
    ...paths
      .filter((p) => LOCKS[basename(p)] && !paths.some((m) => posix.dirname(m) === posix.dirname(p) && LOCKS[basename(p)].test(basename(m))))
      .map((p) => `\`${where(p)}\` changes without its manifest`),
  ];
  // A plan entry is a file, or a folder ending in `/`; with or without the checkout's folder in front.
  const covers = (entry: string, p: string) => [where(p), p].some((x) => x === entry || (entry.endsWith('/') && x.startsWith(entry)));
  const planned = opts.planned ?? [];
  const outside = planned.length ? paths.filter((p) => !planned.some((e) => covers(e, p))) : [];
  if (outside.length) warnings.push(`Changed outside the plan's files: ${outside.map((p) => `\`${where(p)}\``).join(', ')}`);
  const mine = (opts.tests ?? []).filter((t) => !opts.folder || t.startsWith(`${opts.folder}/`));
  const missing = mine.filter((t) => !paths.some((p) => covers(t, p)));
  if (missing.length) warnings.push(`The plan's tests not in the change: ${missing.map((t) => `\`${t}\``).join(', ')}`);
  const size = nul(await git(['-z', '--numstat', range, ...only]))
    .map((l) => l.split('\t'))
    .reduce((sum, [a, d]) => sum + (Number(a) || 0) + (Number(d) || 0), 0);
  if (size > LARGE_DIFF) warnings.push(`The change has ${size} changed lines: consider splitting it`);
  return { blocked, warnings };
}

/** Why the platform did not push, for the card or the pull request. */
export const refusedPush = (blocked: string[]) =>
  `The platform does not push this change:\n${blocked.map((b) => `- ${b}`).join('\n')}\n\nA person makes that part, or the card changes so it is not needed; comment here to resume.`;

/** The warnings as a section for the reviewer's prompt and the pull request; empty when there are none. */
export const checksSection = (warnings: string[]) => (warnings.length ? `## Platform checks\n\n${warnings.map((w) => `- ${w}`).join('\n')}` : '');
