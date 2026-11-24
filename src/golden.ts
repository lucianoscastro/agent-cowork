/**
 * The golden set: closed cards whose pull requests were merged, built again in dry run on the models given, to compare
 * models and prompts on work whose outcome is known. Inside the container:
 *
 *   agentcowork-entrypoint node src/golden.ts KEY-1 KEY-2 [--model <lead model>] [--plan-model <model>]
 *
 * (through the entrypoint, so it runs as the platform does: as node, its agents as their own user; `docker exec` alone
 * runs as root, whose git refuses the platform's repositories).
 *
 * Each card starts from the commit its first build started from and sees only what the card said before any build
 * (see Replay). It is scored by running the tests its merged pull requests added or changed against what the agent
 * built, with the repository's must-pass commands. Nothing reaches Jira or GitHub; the runs show up as dry runs.
 */
import { replayCard, type RepoCheckout } from './agents/developer.ts';
import { TEST_FILE } from './agents/diff-policy.ts';
import type { WatchedPr } from './agents/pr-follow-up.ts';
import { runVerify } from './agents/verify.ts';
import { read } from './config.ts';
import { Items, openDb } from './db.ts';
import { startEgress } from './egress.ts';
import { assertBootstrap, env } from './env.ts';
import { applyGithubEnv, ghJson } from './integrations/github.ts';
import { prepareIsolation } from './isolation.ts';
import { prepareRuntimeHomes } from './providers/index.ts';
import { getRun, type Run, withRun } from './runs.ts';
import { run as sh } from './sh.ts';
import { runsUsage } from './usage.ts';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
if (process.getuid?.() === 0) {
  console.error('Run it through the entrypoint: docker exec <container> agentcowork-entrypoint node src/golden.ts …');
  process.exit(2);
}
const model = option('--model');
const planModel = option('--plan-model');
if (!args.length) {
  console.error('Usage: node src/golden.ts KEY... [--model <lead model>] [--plan-model <model>]');
  process.exit(2);
}

assertBootstrap();
prepareIsolation();
openDb(env.paths.db, env.secretKey);
prepareRuntimeHomes();
applyGithubEnv();
await startEgress();

const cfg = read('agents.developer');
const settings = { ...(model ? { lead: { ...cfg.lead, model } } : {}), ...(planModel !== undefined ? { planModel } : {}) };
const items = new Items('developer', false);
const rows: string[] = [];

for (const key of args) {
  const item = items.get(key);
  const prs = (item?.data.prs ?? []) as WatchedPr[];
  const closed = (item?.data.closed ?? []) as string[];
  // `closed` lists each PR as "<url>: merged" or "<url>: closed", in the order of `prs`.
  const merged = prs.filter((pr) => closed.includes(`${pr.url}: merged`));
  const project = read('projects').items.find((p) => p.name === item?.data.project);
  if (!merged.length || !project) {
    rows.push(`| ${key} | — | skipped: ${project ? 'no merged pull request' : 'no project'} | | | | | |`);
    continue;
  }
  // Where the first build started: the parent of the pull request's first commit. The tests people merged: the test
  // files the pull request added or changed, as merged.
  const bases: Record<string, string> = {};
  const tests = new Map<string, { pr: WatchedPr; files: string[] }>();
  for (const pr of merged) {
    const [first] = await ghJson<{ parents: { sha: string }[] }[]>(['api', `repos/${pr.repo}/pulls/${pr.number}/commits?per_page=1`]);
    bases[pr.repo] = first.parents[0].sha;
    const files = await ghJson<{ filename: string; status: string }[]>(['api', `repos/${pr.repo}/pulls/${pr.number}/files?per_page=100`]);
    tests.set(pr.repo, { pr, files: files.filter((f) => f.status !== 'removed' && TEST_FILE.test(f.filename)).map((f) => f.filename) });
  }
  const scores: string[] = [];
  const evaluate = async (run: Run, repos: RepoCheckout[]) => {
    for (const r of repos) {
      const t = tests.get(r.repo);
      if (!t?.files.length) continue;
      const ref = `refs/golden/pr-${t.pr.number}`;
      await sh('git', ['fetch', '--no-tags', `https://github.com/${r.repo}.git`, `+refs/pull/${t.pr.number}/head:${ref}`], { cwd: r.work.dir });
      await sh('git', ['checkout', ref, '--', ...t.files], { cwd: r.work.dir });
      const failure = await runVerify(run, r.work.dir, r.role, r.verify);
      scores.push(`${r.role}: ${failure ? 'fail' : 'pass'} (${t.files.length} test file${t.files.length === 1 ? '' : 's'})`);
    }
  };
  let id = 0;
  const end = await withRun(
    { agent: 'developer', item: `golden:${key}`, title: `${project.name} · golden set`, dryRun: true, timeoutMs: cfg.limits.runMinutes * 60_000 },
    (run) => {
      id = run.id;
      return replayCard(run, key, project, { bases, settings, evaluate });
    },
  );
  const found = getRun(id);
  const titles = (found?.events ?? []).map((e) => (e as { message: string }).message);
  const rounds = (stage: string) => titles.filter((m) => new RegExp(`^${stage} review \\d+:`).test(m)).length;
  const minutes = found?.ended_at ? Math.round((Date.parse(found.ended_at) - Date.parse(found.started_at)) / 60_000) : 0;
  const lead = settings.lead?.model ?? cfg.lead.model;
  rows.push(
    `| ${key} | ${lead}${planModel ? ` / plan ${planModel}` : ''} | ${end.status} | ${rounds('Plan')} | ${rounds('Diff')} | ${scores.join('; ') || 'no tests to run'} | ${(runsUsage([id]).get(id) ?? 0).toLocaleString('en-US')} | ${minutes} |`,
  );
}

console.log(['| Card | Model | Status | Plan reviews | Diff reviews | Merged tests | Tokens | Minutes |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n'));
process.exit(0);
