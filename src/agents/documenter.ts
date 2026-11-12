import { outputLanguage, projectRepos, read } from '../config.ts';
import { Items, MAX_ATTEMPTS } from '../db.ts';
import { gh } from '../integrations/github.ts';
import { notify } from '../notify.ts';
import { runProvider } from '../providers/index.ts';
import { type Run, type RunEnd, withRun } from '../runs.ts';
import { checkout, forEachLimit, log, removeCheckout, renderPrompt, run as sh } from '../sh.ts';
import { foreignCommits } from './developer.ts';
import { takeForce } from './status.ts';

const DAY_MS = 86_400_000;
const BRANCH = 'ai/docs';
const FOOTER = '\n\n---\n🤖 agentCowork Documenter agent';

type Output = { status: 'updated' | 'unchanged'; files: string[]; summary: string };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['updated', 'unchanged'] },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['status', 'files', 'summary'],
};

/** Paths changed in the work tree (`git status --porcelain`, renames as their new path). Exported for tests. */
export function changedPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, ''));
}

/** The changes outside the docs folder, which the platform reverts: the agent writes documentation only. Exported for tests. */
export const outsideFolder = (paths: string[], folder: string) => paths.filter((p) => p !== folder && !p.startsWith(`${folder}/`));

/**
 * Agent F: documents each project repository's architecture, business rules and flows under a docs folder, as
 * one pull request per repository. Every N days, and only when the base branch moved since the last docs.
 */
export async function pollDocumenter(): Promise<void> {
  const cfg = read('agents.documenter');
  const items = new Items('documenter', cfg.dryRun);
  // Run now: every repository again, whatever its interval or last commit.
  const force = takeForce('documenter');
  const due: { repo: string; base: string; sha: string; since?: string }[] = [];
  for (const { repo } of projectRepos()) {
    try {
      const project = read('projects').items.find((p) => Object.values(p.repos).some((r) => r.repo === repo));
      const base = project?.baseBranch || (await gh(['repo', 'view', repo, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name']));
      const sha = await gh(['api', `repos/${repo}/commits/${encodeURIComponent(base)}`, '-q', '.sha']);
      const last = items.get(repo);
      const since = typeof last?.data.sha === 'string' ? last.data.sha : undefined;
      const fresh = last && Date.now() - Date.parse(last.updatedAt) < cfg.intervalDays * DAY_MS;
      // A failure on a provider limit used no attempt: it is retried as soon as the provider is back.
      const limited = last?.status === 'failed' && last.attempts < MAX_ATTEMPTS;
      if (force || !last || limited || (since !== sha && !fresh) || (last.status === 'failed' && !fresh)) due.push({ repo, base, sha, since });
    } catch (err) {
      log(`documenter: checking ${repo} failed:`, (err as Error).message);
    }
  }
  log(`documenter: ${due.length} repositor${due.length === 1 ? 'y' : 'ies'} to document${force ? ' (run now)' : ''}`);
  await forEachLimit(due, cfg.concurrency, async (target) => {
    const end = await withRun(
      { agent: 'documenter', item: target.repo, url: `https://github.com/${target.repo}/tree/${target.sha}`, title: `Docs of ${target.base}`, dryRun: cfg.dryRun, timeoutMs: 180 * 60_000 },
      (run) => document(run, target, cfg.dryRun),
    );
    if (end.status === 'done') items.done(target.repo, { sha: target.sha, summary: end.summary, url: end.data?.url });
    else if (end.status === 'waiting') items.human(target.repo, { url: `https://github.com/${target.repo}`, title: `${target.repo} docs`, reason: end.summary });
    else if (end.status === 'killed') items.stopped(target.repo, { url: `https://github.com/${target.repo}`, title: `${target.repo} docs` });
    else items.fail(target.repo, end.summary ?? end.status);
  });
}

async function document(run: Run, { repo, base, sha, since }: { repo: string; base: string; sha: string; since?: string }, dryRun: boolean): Promise<RunEnd> {
  const cfg = read('agents.documenter');
  const { folder } = cfg;
  // Someone else's commits on the docs branch are never overwritten: a person decides.
  const foreign = await foreignCommits(repo, base, BRANCH);
  if (foreign) return { status: 'waiting', summary: `The branch ${BRANCH} in ${repo} has commits by ${foreign}, so it was not overwritten. Merge or close its PR (or delete the branch), then Retry.` };

  run.stage('Checkout');
  const work = await checkout(repo, [`+refs/heads/${base}:refs/remotes/origin/${base}`], sha, { branch: BRANCH });
  try {
    const cwd = work.dir;
    const exists = (await sh('git', ['ls-files', '--', folder], { cwd })).trim().length > 0;
    // The first run writes everything; later ones update what the commits since the last docs touched.
    const changes = since && exists ? await sh('git', ['diff', '--stat=200', `${since}..${sha}`], { cwd }).catch(() => '') : '';
    const mode = changes
      ? `Mode: **update**. The documentation in \`${folder}/\` was written at commit \`${since!.slice(0, 12)}\`. Since then:\n\n\`\`\`\n${changes.slice(-8000)}\n\`\`\`\n\nRead those changes (\`git diff ${since!.slice(0, 12)}..HEAD\`), update every file of the structure they affect, add what is missing from the structure, and leave the rest as it is.`
      : `Mode: **full**. Write the whole structure${exists ? `, reusing what is already in \`${folder}/\`` : ''}.`;

    run.stage('Document');
    const prompt = await renderPrompt('documenter/document', { repo, base, sha: sha.slice(0, 12), folder, mode, language: outputLanguage() });
    const { output } = await runProvider<Output>(cfg.provider, { run, label: 'document', prompt, schema: SCHEMA, cwd, mode: 'write', model: cfg.model });

    run.stage('Check');
    const outside = outsideFolder(changedPaths(await sh('git', ['status', '--porcelain', '-uall'], { cwd })), folder);
    if (outside.length) {
      run.event('warn', `Reverted ${outside.length} change(s) outside ${folder}/`, outside);
      await sh('git', ['checkout', '--', '.', `:(exclude)${folder}`], { cwd }).catch(() => '');
      await sh('git', ['clean', '-fdq', '--', '.', `:(exclude)${folder}`], { cwd });
    }
    const docs = changedPaths(await sh('git', ['status', '--porcelain', '-uall', '--', folder], { cwd }));
    if (!docs.length) return { status: 'done', summary: `Documentation already current. ${output.summary}` };
    if (dryRun) return { status: 'done', summary: `would open a docs PR with ${docs.length} file(s): ${output.summary}` };

    run.stage('Pull request');
    await sh('git', ['add', '--', folder], { cwd });
    await sh('git', ['commit', '-m', `docs: ${since && exists ? 'update' : 'add'} architecture and business-rule docs`], { cwd });
    await sh('git', ['push', '--force', 'origin', `HEAD:refs/heads/${BRANCH}`], { cwd });
    const body = `${output.summary}\n\nWritten from \`${base}@${sha.slice(0, 12)}\`. Files:\n${docs.map((f) => `- \`${f}\``).join('\n')}${FOOTER}`;
    // An open docs PR is updated (the branch was force-pushed) instead of a second one being opened.
    const existing = await gh(['pr', 'list', '--repo', repo, '--head', BRANCH, '--json', 'url', '-q', '.[0].url']);
    const url = existing || (await gh(['pr', 'create', '--repo', repo, '--base', base, '--head', BRANCH, '--title', 'docs: architecture and business-rule docs', '--body', body]));
    if (existing) await gh(['pr', 'comment', url, '--body', `Updated from \`${base}@${sha.slice(0, 12)}\`: ${output.summary}${FOOTER}`]);
    run.event('artifact', `${existing ? 'Updated' : 'Opened'} ${url}`, { url, files: docs });
    notify('pr', { title: `Documenter ${existing ? 'updated' : 'opened'} the docs PR of ${repo}`, text: output.summary, url, agent: 'documenter' });
    return { status: 'done', summary: `${existing ? 'updated' : 'opened'} ${url}: ${output.summary}`, data: { url } };
  } finally {
    await removeCheckout(work);
  }
}
