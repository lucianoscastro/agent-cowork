import { outputLanguage, projectRepos, read } from '../config.ts';
import { Items } from '../db.ts';
import { gh, ghJson } from '../integrations/github.ts';
import { runProvider } from '../providers/index.ts';
import { withRun, type Run } from '../runs.ts';
import { checkout, forEachLimit, log, removeCheckout, renderPrompt } from '../sh.ts';
import { takeForce } from './status.ts';

type Finding = { path: string; line: number; body: string };
export type ReviewResult = { verdict: 'approve' | 'comment'; summary: string; findings: Finding[] };
type SearchHit = { url: string; number: number; repository: { nameWithOwner: string } };
type PullRequest = { headRefOid: string; baseRefName: string; title: string; body: string };

const FOOTER = '\n\n---\n🤖 Automated review by agentCowork';
export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'comment'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, line: { type: 'integer' }, body: { type: 'string' } },
        required: ['path', 'line', 'body'],
      },
    },
  },
  required: ['verdict', 'summary', 'findings'],
};

/** Approves only when the agent found nothing to suggest. */
export function decide(review: ReviewResult): 'APPROVE' | 'COMMENT' {
  return review.verdict === 'approve' && review.findings.length === 0 ? 'APPROVE' : 'COMMENT';
}

/** Agent C: reviews open PRs that request review directly from the configured GitHub user. */
export async function pollApprover(): Promise<void> {
  const cfg = read('agents.approver');
  const { dryRun } = read('agents.approver');
  const items = new Items('approver', dryRun);
  // Run now: every PR still requesting this user's review is reviewed again, even a commit already reviewed.
  const force = takeForce('approver');
  const hits = await ghJson<SearchHit[]>([
    // user-review-requested: only direct requests; review-requested would include every team the user is in.
    'search', 'prs', 'user-review-requested:@me', '--state=open', '--draft=false',
    '--json', 'url,number,repository', '--limit', '50',
  ]);
  // Only repositories of a configured project: a review request elsewhere is not this instance's business.
  const known = new Set(projectRepos().map((r) => r.repo));
  const mine = hits.filter((h) => known.has(h.repository.nameWithOwner));
  await forEachLimit(mine, cfg.concurrency, async (hit) => {
    try {
      const pr = await ghJson<PullRequest>(['pr', 'view', hit.url, '--json', 'headRefOid,baseRefName,title,body']);
      const key = `${hit.url}@${pr.headRefOid}`;
      if (!force && items.skip(key)) return;
      const end = await withRun(
        { agent: 'approver', item: `${hit.repository.nameWithOwner}#${hit.number}`, url: hit.url, title: pr.title, dryRun },
        (run) => review(run, hit, pr, dryRun),
      );
      if (end.status === 'done') items.done(key);
      else if (end.status === 'killed') items.stopped(key, { url: hit.url, title: pr.title });
      else items.fail(key, end.summary ?? end.status);
    } catch (err) {
      log(`approver: ${hit.url} failed:`, (err as Error).message);
    }
  });
}


async function review(run: Run, hit: SearchHit, pr: PullRequest, dryRun: boolean) {
  const cfg = read('agents.approver');
  const repo = hit.repository.nameWithOwner;
  run.stage('Checkout');
  const work = await checkout(
    repo,
    [`+refs/pull/${hit.number}/head:refs/remotes/pr/${hit.number}`, `+refs/heads/${pr.baseRefName}:refs/remotes/origin/${pr.baseRefName}`],
    pr.headRefOid,
  );
  try {
    run.stage('Review');
    const prompt = await renderPrompt('approver/review', {
      url: hit.url,
      title: pr.title,
      body: pr.body,
      base: pr.baseRefName,
      language: outputLanguage(),
    });
    const { output } = await runProvider<ReviewResult>(cfg.provider, {
      run,
      label: 'review',
      prompt,
      schema: REVIEW_SCHEMA,
      cwd: work.dir,
      mode: 'read-only',
      model: cfg.model,
    });
    const event = decide(output);
    const findings = output.findings.map((f) => `- ${f.path}:${f.line} — ${f.body}`).join('\n');
    run.event('artifact', `${event === 'APPROVE' ? 'Approve' : 'Comment'} (${output.findings.length} findings)`, output);
    if (!dryRun) {
      run.stage('Submit');
      await submit(repo, hit.number, pr.headRefOid, event, output);
    }
    const verb = event === 'APPROVE' ? 'approved' : 'commented';
    return { status: 'done' as const, summary: `${dryRun ? `would have ${verb}` : verb}: ${output.summary}${findings ? `\n\n${findings}` : ''}` };
  } finally {
    await removeCheckout(work);
  }
}

async function submit(repo: string, number: number, sha: string, event: string, result: ReviewResult): Promise<void> {
  const path = `repos/${repo}/pulls/${number}/reviews`;
  const comments = result.findings.map((f) => ({ path: f.path, line: f.line, side: 'RIGHT', body: f.body }));
  const post = (payload: object) => gh(['api', '-X', 'POST', path, '--input', '-'], { input: JSON.stringify(payload) });
  try {
    await post({ commit_id: sha, event, body: result.summary + FOOTER, comments });
  } catch {
    // GitHub rejects the whole review (422) when a finding points outside the diff; keep the findings in the body.
    const list = result.findings.map((f) => `- \`${f.path}:${f.line}\` — ${f.body}`).join('\n');
    await post({ commit_id: sha, event, body: `${result.summary}\n\n${list}${FOOTER}` });
  }
}
