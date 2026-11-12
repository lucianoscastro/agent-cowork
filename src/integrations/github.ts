import { read, SECRETS } from '../config.ts';
import { getSecret } from '../db.ts';
import { run, type RunOptions } from '../sh.ts';

/**
 * Puts the GitHub token and git identity in this process's environment, where only `gh` and `git`
 * (run with the default environment) see them. Runtimes and verify commands get safeEnv() instead.
 */
export function applyGithubEnv(): boolean {
  const token = getSecret(SECRETS.githubToken);
  const { gitName, gitEmail } = read('github');
  if (token) process.env.GH_TOKEN = token;
  else delete process.env.GH_TOKEN;
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = gitName;
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = gitEmail || `${gitName.replace(/\W+/g, '-')}@users.noreply.github.com`;
  return Boolean(token);
}

export function gh(args: string[], opts: RunOptions = {}): Promise<string> {
  return run('gh', args, opts);
}

export async function ghJson<T>(args: string[], opts: RunOptions = {}): Promise<T> {
  return JSON.parse(await gh(args, opts)) as T;
}

/** Connection test for the UI: who the token acts as, and a warning when it can't push workflow changes. */
export async function testGithub(): Promise<string> {
  if (!applyGithubEnv()) throw new Error('No GitHub token set');
  const res = await gh(['api', '-i', 'user']);
  const login = /"login":\s*"([^"]+)"/.exec(res)?.[1] ?? 'unknown';
  // Classic and OAuth tokens list their scopes; fine-grained tokens don't (their Workflows permission can't be read here).
  const scopes = /^x-oauth-scopes:(.*)$/im.exec(res)?.[1];
  return scopes !== undefined && !scopes.split(',').map((x) => x.trim()).includes('workflow')
    ? `${login} · missing the "workflow" scope: pull requests that change .github/workflows can't be pushed`
    : login;
}

export type ActionsLink = { repo: string; run: string; job?: string };

/**
 * GitHub Actions run and job links in a text (card descriptions, comments, check URLs) of the given repositories
 * only, without repeats. The host must be github.com itself: "https://evil.example/github.com/…" doesn't count.
 */
export function actionsLinks(text: string, repos: string[]): ActionsLink[] {
  const allowed = new Set(repos.map((r) => r.toLowerCase()));
  const links = [...text.matchAll(/(?<![\w.\/-])(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/g)]
    .map(([, repo, run, job]) => ({ repo, run, job }))
    .filter((l) => allowed.has(l.repo.toLowerCase()));
  return links.filter((l, i) => links.findIndex((x) => x.run === l.run && x.job === l.job) === i);
}

/**
 * The end of the failed steps' log of an Actions run (or one job). Agents read code without network
 * access or a GitHub token, so the platform fetches it for them. Empty when it can't be fetched.
 */
export async function failedLogTail({ repo, run, job }: ActionsLink): Promise<string> {
  const log = await gh(['run', 'view', ...(job ? ['--job', job] : [run]), '--repo', repo, '--log-failed']).catch(() => '');
  // ponytail: the last lines only (where test runners print failures); a failure scrolled further up needs the full log.
  return log.split('\n').slice(-120).map((l) => l.replace(/\t\d{4}-\d\d-\d\dT[\d:.]+Z /, '\t')).join('\n').slice(-6000).trim();
}
