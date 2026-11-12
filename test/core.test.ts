import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decide } from '../src/agents/approver.ts';
import { checksState, parseBump, parseBumps, updateType } from '../src/agents/dependabot.ts';
import { reviewPasses } from '../src/agents/developer.ts';
import { pendingWork, type PrSnapshot } from '../src/agents/pr-follow-up.ts';
import { type Audit, CATEGORIES, findingKey, needsHuman, renderReport, severityCounts, verdictLabel } from '../src/agents/auditor.ts';
import { asset } from '../src/assets.ts';
import { outputLanguage, parseTestVars, projectRepos, read, validateProjects, verifyCommands, write } from '../src/config.ts';
import { decrypt, encrypt, signSession, verifySession } from '../src/crypto.ts';
import { getSecret, Items, itemsByStatus, onInbox, openDb, putSetting, setSecret } from '../src/db.ts';
import { adfToText, hasAnswer, toAdf } from '../src/integrations/jira.ts';
import { strictSchema } from '../src/providers/codex.ts';
import { mainResult } from '../src/providers/claude.ts';
import { agyLimits, claudeLimits, codexLimits, lastCodexWindows } from '../src/providers/limits.ts';
import { fallbackOrder, guardReadOnly, limitPause } from '../src/providers/index.ts';
import { jwtClaims } from '../src/providers/account.ts';
import { lastWords, parseLoginOutput, submitLoginCode, withProfileScope } from '../src/providers/login.ts';
import { liveOutput, parseTranscriptLine } from '../src/live.ts';
import { runsUsage, usageSummary } from '../src/usage.ts';
import { describeChanges, flattenSecrets, maskSecrets, sanitizeHar, testSource } from '../src/agents/sentinel.ts';
import { detectSuite, envRefs, isolate, parseCucumberJson, parseJunit, parsePlaywrightJson, testLabel } from '../src/agents/suite.ts';
import { getRun, type Run, withRun } from '../src/runs.ts';
import { runVerify } from '../src/agents/verify.ts';
import { forEachLimit, renderPrompt, run as sh, safeEnv, withLock } from '../src/sh.ts';

const KEY = 'test-secret-key-0123456789';
openDb(mkdtempSync(join(tmpdir(), 'acw-db-')), KEY);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('secrets are encrypted at rest and round-trip', () => {
  const sealed = encrypt(KEY, 'ghp_secret');
  assert.ok(!sealed.includes('ghp_secret'));
  assert.equal(decrypt(KEY, sealed), 'ghp_secret');
  assert.throws(() => decrypt('another-key-0123456789', sealed));
  setSecret('github.token', 'ghp_abc');
  assert.equal(getSecret('github.token'), 'ghp_abc');
});

test('sessions reject tampering, other keys and expiry', () => {
  const token = signSession(KEY, 'admin', 1_000);
  assert.equal(verifySession(KEY, token, 2_000), 'admin');
  assert.equal(verifySession('another-key-0123456789', token, 2_000), undefined);
  assert.equal(verifySession(KEY, token.replace(/^./, 'x'), 2_000), undefined);
  assert.equal(verifySession(KEY, token, 1_000 + 13 * 3_600_000), undefined);
  assert.equal(verifySession(KEY, undefined), undefined);
});

test('settings are validated before they are stored', () => {
  assert.throws(() => write('general', { language: 'English', dryRun: true, pollSeconds: 300 }), /language/);
  assert.throws(() => write('jira', { url: 'http://evil', email: '' }), /jira.url/);
  assert.throws(() => write('agents.dependabot', { ...read('agents.dependabot'), cooldownDays: 999 }), /cooldownDays/);
  write('general', { language: 'pt-BR', dryRun: false, pollSeconds: 60 });
  assert.equal(read('general').pollSeconds, 60);
  assert.equal(outputLanguage(), 'Brazilian Portuguese (pt-BR)');
  putSetting('general', { language: 'xx', dryRun: true, pollSeconds: 300 }); // an unknown stored value falls back to English
  assert.equal(outputLanguage(), 'English (en-US)');
  assert.equal(read('agents.developer').limits.diffReview, 3); // defaults fill unset sections
  assert.equal(read('agents.approver').dryRun, true); // every agent starts in dry run, each with its own switch
  const { dryRun: _, ...noSwitch } = read('agents.approver');
  assert.throws(() => write('agents.approver', noSwitch), /dryRun/);
  // A failing PR's card for the Developer carries the label its default trigger looks for.
  const dep = read('agents.dependabot');
  assert.deepEqual([dep.failingCiCard, dep.cardLabels], [true, ['agent-ready']]);
  assert.throws(() => write('agents.dependabot', { ...dep, cardLabels: ['two words'] }), /cardLabels/);
});

test('projects validation rejects unsafe roles and bad repos', () => {
  const [p] = validateProjects([{ name: 'Web', repos: { frontend: { repo: 'acme/Web_App', stack: 'react', verify: ['pnpm test'] } } }]);
  assert.deepEqual(Object.keys(p.repos), ['Web_App']); // the folder is the repository name, not the client's key
  assert.throws(() => validateProjects([{ name: 'X', repos: { a: { repo: 'acme/..' } } }]), /owner\/name/);
  assert.throws(() => validateProjects([{ name: 'X', repos: { a: { repo: 'acme/web', stack: 'node' }, b: { repo: 'other/web', stack: 'node' } } }]), /collide/);
  assert.throws(() => validateProjects([{ name: 'X', repos: { web: { repo: 'nope' } } }]), /owner\/name/);
  assert.throws(() => validateProjects([{ name: 'X', repos: {} }]), /at least one/);
  assert.throws(() => validateProjects([{ name: 'X', repos: { a: { repo: 'acme/web', stack: 'cobol' } } }]), /stack/);
  assert.throws(() => validateProjects([{ name: 'X', boardId: '12; drop', repos: { a: { repo: 'acme/web' } } }]), /boardId/);
  const web = { a: { repo: 'acme/web', stack: 'react' } };
  assert.throws(() => validateProjects([{ name: 'Shop', repos: web }, { name: ' shop ', repos: web }]), /must be unique/); // secrets and schedules are keyed by name
});

test('verify commands: a repository runs its own list, or its stack defaults', () => {
  const api = { repo: 'acme/api', stack: 'dotnet' as const };
  const web = { repo: 'acme/web', stack: 'node' as const, verify: ['pnpm install --frozen-lockfile', 'pnpm exec jest'] };
  assert.deepEqual(verifyCommands(web), ['pnpm install --frozen-lockfile', 'pnpm exec jest']);
  assert.deepEqual(verifyCommands(api), read('stacks').dotnet);
  putSetting('projects', { items: [
    { name: 'A', repos: { web: { repo: 'acme/web', stack: 'react' } } },
    { name: 'B', repos: { web: { repo: 'acme/web', stack: 'react' }, api: { repo: 'acme/api', stack: 'dotnet' } } },
  ] });
  assert.deepEqual(projectRepos().map((r) => r.repo), ['acme/web', 'acme/api']); // Dependabot watches each repository once
});

test('items: done is skipped, a failure is not retried on its own, dry runs are separate', () => {
  const live = new Items('approver', false);
  const dry = new Items('approver', true);
  live.done('pr-1');
  assert.equal(live.skip('pr-1'), true);
  assert.equal(dry.skip('pr-1'), false);
  live.fail('pr-2', 'boom');
  assert.equal(live.skip('pr-2'), true);
  // A provider's usage limit is not the item's fault: it never uses up an attempt.
  for (let i = 0; i < 5; i++) live.fail('pr-3', 'claude: usage limit reached, paused until 01:30 UTC');
  live.fail('pr-3', "claude: You've hit your individual spend limit");
  assert.equal(live.get('pr-3')?.attempts, 0);
  assert.equal(live.skip('pr-3'), false);
  new Items('developer', false).wait('ABC-1', { waitingSince: '2026-01-01T00:00:00Z' });
  assert.ok(itemsByStatus(['waiting']).some((i) => i.agent === 'developer' && i.key === 'ABC-1'));
});

test('approver approves only a clean approve verdict', () => {
  const finding = { path: 'a.ts', line: 1, body: 'x' };
  assert.equal(decide({ verdict: 'approve', summary: '', findings: [] }), 'APPROVE');
  assert.equal(decide({ verdict: 'approve', summary: '', findings: [finding] }), 'COMMENT');
  assert.equal(decide({ verdict: 'comment', summary: '', findings: [] }), 'COMMENT');
});

test('dependabot policy helpers', () => {
  assert.deepEqual(parseBump('chore(deps): bump sass from 1.107.1 to 1.108.0'), { pkg: 'sass', from: '1.107.1', to: '1.108.0' });
  assert.deepEqual(parseBump('Bump @types/node from 24.1.0 to 24.2.0 in /web'), { pkg: '@types/node', from: '24.1.0', to: '24.2.0' });
  assert.equal(parseBump('Bump the npm group across 1 directory with 3 updates'), undefined);
  // Grouped PRs: each package from the body; quoted release notes don't count; a count that doesn't match is unreadable.
  const npmGroup = [
    'Bumps the npm_and_yarn group with 2 updates in the / directory: [ag-grid-community](https://x) and [ag-grid-react](https://y).',
    '',
    'Updates `ag-grid-community` from 36.2.0 to 36.3.0',
    '<details><summary>Release notes</summary>',
    '> Bumps lodash from 4.17.20 to 5.0.0 in the docs site',
    '</details>',
    'Updates `ag-grid-react` from 36.2.0 to 36.3.0',
  ].join('\n');
  assert.deepEqual(parseBumps('Bump the npm_and_yarn group with 2 updates', npmGroup).map((b) => `${b.pkg} ${b.from}>${b.to}`), [
    'ag-grid-community 36.2.0>36.3.0',
    'ag-grid-react 36.2.0>36.3.0',
  ]);
  assert.deepEqual(parseBumps('Bump the npm_and_yarn group with 3 updates', npmGroup), []);
  const nuget = 'Updated [NLog.Extensions.Logging](https://a) from 6.0.5 to 6.0.6.\n\nUpdated [NLog.Web.AspNetCore](https://b) from 6.0.5 to 6.1.0.';
  assert.deepEqual(parseBumps('Bump NLog.Extensions.Logging and NLog.Web.AspNetCore', nuget).map((b) => `${b.pkg} ${b.from}>${b.to}`), [
    'NLog.Extensions.Logging 6.0.5>6.0.6',
    'NLog.Web.AspNetCore 6.0.5>6.1.0',
  ]);
  assert.deepEqual(parseBumps('chore(deps): bump sass from 1.107.1 to 1.108.0', 'Updates `other` from 1.0.0 to 2.0.0'), [{ pkg: 'sass', from: '1.107.1', to: '1.108.0' }]);
  assert.deepEqual(parseBumps('Bump the group', 'no versions here'), []);
  assert.equal(updateType('1.2.3', '1.2.4'), 'patch');
  assert.equal(updateType('1.2.3', '1.3.0'), 'minor');
  assert.equal(updateType('1.2.3', '2.0.0'), 'major');
  assert.equal(updateType('0.4.1', '0.5.0'), 'major');
  assert.equal(updateType('1.0.0', 'latest'), 'major');
  assert.equal(checksState([]), 'pass');
  assert.equal(checksState([{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'pass');
  assert.equal(checksState([{ __typename: 'CheckRun', status: 'IN_PROGRESS' }]), 'pending');
  assert.equal(checksState([{ __typename: 'StatusContext', state: 'FAILURE' }]), 'fail');
});

test('developer review gate passes only without blocker or major findings', () => {
  assert.equal(reviewPasses({ verdict: 'changes', summary: '', findings: [{ severity: 'minor', where: 'a', body: 'b' }] }), true);
  assert.equal(reviewPasses({ verdict: 'changes', summary: '', findings: [{ severity: 'major', where: 'a', body: 'b' }] }), false);
  assert.equal(reviewPasses({ verdict: 'approve', summary: '', findings: [] }), true);
});

test('login parsers find the URL, device code and token', () => {
  const claude = '\x1b]8;id=1;https://claude.com/cai/oauth/authorize?code=true&state=abc\x07link\x1b]8;;\x07 Paste code here >';
  assert.equal(parseLoginOutput('claude', claude).url, 'https://claude.com/cai/oauth/authorize?code=true&state=abc');
  // Built by concatenation so secret scanners don't flag this fake token.
  const fakeToken = ['sk', 'ant', 'oat01', 'x'.repeat(30)].join('-');
  assert.equal(parseLoginOutput('claude', `token: ${fakeToken}\r\n`).token, fakeToken);
  // Half a token (the rest still on its way) is never taken, and the next line is never glued to it.
  assert.equal(parseLoginOutput('claude', `token: ${fakeToken.slice(0, 25)}`).token, undefined);
  assert.equal(parseLoginOutput('claude', `token: ${fakeToken}\r\nStore this token securely.\r\n`).token, fakeToken);
  // The link also asks to read the profile, so the account's email can be shown; nothing else changes.
  const link = new URL(withProfileScope('https://claude.com/cai/oauth/authorize?code=true&client_id=c&scope=user%3Ainference&state=s'));
  assert.equal(link.searchParams.get('scope'), 'user:inference user:profile');
  assert.equal(link.searchParams.get('state'), 's');
  const codex = parseLoginOutput('codex', 'navigate to this URL:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x\n');
  assert.equal(codex.url, 'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x');
});

test('untrusted processes get no credentials from the environment', () => {
  process.env.GH_TOKEN = 'ghp_leak';
  process.env.JIRA_API_TOKEN = 'leak';
  const e = safeEnv({ CODEX_HOME: '/x' });
  assert.equal(e.GH_TOKEN, undefined);
  assert.equal(e.JIRA_API_TOKEN, undefined);
  assert.equal(e.CODEX_HOME, '/x');
  assert.ok(e.PATH);
});

test('jira helpers flatten rich text and detect answers', () => {
  const doc = { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'Bug' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] };
  assert.equal(adfToText(doc), 'Bug\na\nb\n');
  const c = (created: string, text: string) => ({ created, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
  const since = '2026-10-22T10:00:00.000+0000';
  assert.equal(hasAnswer([c('2026-10-22T09:00:00.000+0000', 'old')], since), false);
  assert.equal(hasAnswer([c('2026-10-22T11:00:00.000+0000', '🤖 bot')], since), false);
  assert.equal(hasAnswer([c('2026-10-22T11:00:00.000+0000', 'use v2')], since), true);
});

test('forEachLimit bounds parallelism; withLock serializes and survives failures', async () => {
  let running = 0;
  let peak = 0;
  await forEachLimit([1, 2, 3, 4, 5], 2, async () => {
    peak = Math.max(peak, ++running);
    await tick();
    running--;
  });
  assert.equal(peak, 2);
  const order: string[] = [];
  const failing = withLock('k', async () => {
    await tick();
    order.push('a');
    throw new Error('boom');
  });
  const next = withLock('k', async () => order.push('b'));
  await assert.rejects(failing);
  await next;
  assert.deepEqual(order, ['a', 'b']);
});

test('prompts render variables once and prefer mounted overrides', async () => {
  const text = await renderPrompt('approver/review', { url: 'URL', title: '{{base}}', body: '', base: 'main', language: 'English' });
  assert.ok(text.includes('pull request URL ("{{base}}")'));
  const overrides = mkdtempSync(join(tmpdir(), 'overrides-'));
  process.env.OVERRIDES_DIR = overrides;
  try {
    assert.equal(asset('skills').source, 'default');
    mkdirSync(join(overrides, 'prompts', 'approver'), { recursive: true });
    writeFileSync(join(overrides, 'prompts', 'approver', 'review.md'), 'custom review for {{url}}');
    assert.equal(asset('prompts/approver/review.md').source, 'custom');
    assert.equal(await renderPrompt('approver/review', { url: 'PR-1' }), 'custom review for PR-1');
  } finally {
    delete process.env.OVERRIDES_DIR;
  }
});

test('read-only calls cannot leave changes behind, whatever the runtime does', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ws-'));
  const repo = join(workspace, 'frontend');
  mkdirSync(repo);
  const git = (...args: string[]) => sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo });
  await git('init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'original');
  await git('add', '.');
  await git('commit', '-qm', 'init');
  let runId = 0;
  await withRun({ agent: 'developer', item: 'TEST-1', dryRun: true }, async (run) => {
    runId = run.id;
    const out = await guardReadOnly(run, 'review', workspace, async () => {
      writeFileSync(join(repo, 'a.txt'), 'tampered');
      writeFileSync(join(repo, 'new.txt'), 'x');
      await git('commit', '-qam', 'sneaky');
      return 'verdict';
    });
    assert.equal(out, 'verdict');
    return { status: 'done' };
  });
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'original');
  assert.equal(existsSync(join(repo, 'new.txt')), false);
  assert.equal(await git('log', '--oneline'), (await git('log', '--oneline', '-1')));
  const events = getRun(runId)!.events as { kind: string; message: string }[];
  assert.ok(events.some((e) => e.kind === 'warn' && e.message.includes('reverted')));
});

test('pasted login codes: Google-style codes pass the format check, control characters never do', async () => {
  // Format is checked first: well-formed input fails only because no login is waiting.
  await assert.rejects(submitLoginCode('agy', '4/0AVMBsJh-example_code'), /No login is waiting/);
  await assert.rejects(submitLoginCode('agy', 'code\rmore'), /does not look like a login code/);
  await assert.rejects(submitLoginCode('claude', 'two words'), /does not look like a login code/);
  await assert.rejects(submitLoginCode('codex', 'https://evil.example/auth/callback?code=x'), /127\.0\.0\.1:1455/);
  await assert.rejects(submitLoginCode('codex', 'http://127.0.0.1:1455/auth/callback?code=abc&state=xyz'), /No login is waiting/);
});

test('codex schemas are made strict: closed objects with every property required', () => {
  const out = strictSchema({
    type: 'object',
    properties: { verdict: { type: 'string' }, findings: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } } },
    required: ['verdict'],
  }) as { additionalProperties: boolean; required: string[]; properties: { findings: { items: { additionalProperties: boolean; required: string[] } } } };
  assert.equal(out.additionalProperties, false);
  assert.deepEqual(out.required, ['verdict', 'findings']);
  assert.equal(out.properties.findings.items.additionalProperties, false);
  assert.deepEqual(out.properties.findings.items.required, ['a']);
});

test('PR follow-up: red checks, conflicts, open threads and new human comments need the developer', () => {
  const note = (body: string, createdAt: string, type = 'User') => ({ databaseId: 1, body, createdAt, url: '', author: { login: 'dev', __typename: type } });
  const base: PrSnapshot = { state: 'OPEN', headRefOid: 'abc', mergeable: 'MERGEABLE', checks: [], threads: [], comments: [] };
  const quiet = pendingWork(base, '2026-01-01');
  assert.deepEqual([quiet.failing.length, quiet.running, quiet.conflict, quiet.threads.length, quiet.comments.length], [0, false, false, 0, 0]);

  const busy = pendingWork({
    ...base,
    mergeable: 'CONFLICTING',
    checks: [
      { __typename: 'CheckRun', databaseId: 1, name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: null },
      { __typename: 'CheckRun', databaseId: 2, name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: null },
      { __typename: 'StatusContext', context: 'sonar', state: 'ERROR', description: 'Quality gate failed', targetUrl: null },
      { __typename: 'CheckRun', databaseId: 3, name: 'e2e', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null },
    ],
    threads: [
      { id: 't1', isResolved: false, path: 'a.ts', line: 3, comments: { nodes: [note('rename this', '2026-01-02')] } },
      { id: 't2', isResolved: false, path: 'b.ts', line: 1, comments: { nodes: [note('why?', '2026-01-02'), note('🤖 **Fixed.** done', '2026-01-03')] } },
      { id: 't3', isResolved: true, path: 'c.ts', line: 1, comments: { nodes: [note('ok', '2026-01-02')] } },
    ],
    comments: [
      note('please add a test', '2026-01-05'),
      note('old remark', '2025-12-31'),
      note('🤖 agentCowork addressed the comments', '2026-01-06'),
      note('Quality gate failed', '2026-01-06', 'Bot'),
    ],
  }, '2026-01-01');
  assert.deepEqual(busy.failing.map((c) => (c.__typename === 'CheckRun' ? c.name : c.context)), ['build', 'sonar']);
  assert.equal(busy.running, true);
  assert.equal(busy.conflict, true);
  assert.deepEqual(busy.threads.map((t) => t.id), ['t1']); // t2 ends with the agent's reply, t3 is resolved
  assert.deepEqual(busy.comments.map((c) => c.body), ['please add a test']); // not old, not ours, not a bot
  // A thread the agent already handled stays quiet until someone writes in it again.
  const snap = { ...base, threads: [{ id: 't1', isResolved: false, path: 'a.ts', line: 3, comments: { nodes: [{ ...note('rename this', '2026-01-02'), databaseId: 77 }] } }] };
  assert.equal(pendingWork(snap, '2026-01-01', [77]).threads.length, 0);
  assert.equal(pendingWork(snap, '2026-01-01', [76]).threads.length, 1);
});

test('auditor: critical and high findings go to the inbox; the report carries copy-ready issues', () => {
  const audit: Audit = {
    verdict: 'fix_first', summary: 'One high finding.', stack: 'Node + React',
    checks: [{ id: 'C07', status: 'fail', note: 'IDOR in /orders/:id' }],
    findings: [
      { check: 'C07', severity: 'high', title: 'Order IDOR', where: 'src/orders.ts:42', evidence: 'findById(req.params.id)', impact: 'Read other tenants orders', fix: 'Scope by tenant', acceptance: ['Cross-tenant read returns 404'] },
      { check: 'C15', severity: 'info', title: 'Source maps', where: 'vite.config.ts:9', evidence: 'sourcemap: true', impact: 'none', fix: '-', acceptance: [] },
    ],
    strengths: [], limitations: [], manualActions: [],
  };
  assert.equal(needsHuman(audit), true);
  assert.equal(needsHuman({ ...audit, findings: [audit.findings[1]] }), false);
  assert.equal(severityCounts(audit), '1 high, 1 info');
  const report = renderReport('security', 'acme/web', 'develop', '0123456789abcdef', audit);
  assert.match(report, /--- ISSUE 1 ---\nTitle: \[Security\] Order IDOR/);
  assert.doesNotMatch(report, /ISSUE 2/); // info findings are not issues
  assert.match(report, /\| C07 \| fail \|/);
});

test('developer limits saved before follow-ups existed get the follow-up default', () => {
  const dev = read('agents.developer');
  const { followUp: _, ...older } = dev.limits;
  putSetting('agents.developer', { ...dev, limits: older });
  assert.equal(read('agents.developer').limits.followUp, 3);
});

test('live output: transcripts of every runtime become terminal lines', () => {
  const claude = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the controllers.' }, { type: 'tool_use', name: 'Bash', input: { command: 'rg -n Authorize src\nmore' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') }] }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'boom' }] } }),
    JSON.stringify({ type: 'system', subtype: 'thinking_tokens' }),
  ].flatMap(parseTranscriptLine);
  assert.deepEqual(claude.map((l) => l.kind), ['say', 'tool', 'out', 'err']);
  assert.equal(claude[1].text, 'Bash rg -n Authorize src'); // first line of the command only
  assert.match(claude[2].text, /line 11\n… 8 more lines$/);

  const codex = [
    JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'pnpm test' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'pnpm test', aggregated_output: 'FAIL a.test.ts', exit_code: 1 } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Tests fail on a.' } }),
    JSON.stringify({ type: 'turn.completed', usage: {} }),
  ].flatMap(parseTranscriptLine);
  assert.deepEqual(codex.map((l) => [l.kind, l.text]), [['tool', '$ pnpm test'], ['err', 'FAIL a.test.ts\nexit 1'], ['say', 'Tests fail on a.'], ['info', 'finished']]);

  const agy = parseTranscriptLine(JSON.stringify({ status: 'SUCCESS', response: 'OK\n', structured_output: {} }));
  assert.deepEqual(agy.map((l) => l.kind), ['say', 'info']);
});

test('a run stopped from the UI goes to the inbox instead of being retried', () => {
  const items = new Items('approver', false);
  items.stopped('pr-9', { url: 'u' });
  assert.equal(items.skip('pr-9'), true);
  assert.equal(items.get('pr-9')?.status, 'human');
  assert.match(String(items.get('pr-9')?.data.reason), /Stopped from the UI/);
});

test('verify streams each command into the live view and reports the failing one', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'acw-verify-'));
  await sh('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'x');
  await sh('git', ['add', '.'], { cwd: repo });
  await sh('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: repo });
  const logDir = mkdtempSync(join(tmpdir(), 'acw-verify-log-'));
  const run = {
    signal: new AbortController().signal,
    logDir,
    transcript: (name: string) => join(logDir, `${name}.jsonl`),
    checkpoint: () => {},
    event: () => {},
  } as unknown as Run;
  const failure = await runVerify(run, repo, 'web', ['echo building', 'echo broken test; exit 3', 'echo never']);
  assert.match(String(failure), /`web`: `echo broken test; exit 3` failed \(exit 3\):\nbroken test/);
  const { lines } = await liveOutput(logDir, 0);
  assert.deepEqual(lines.map((l) => [l.kind, l.text]), [
    ['info', '── verify-1-web ──'],
    ['tool', '$ web: echo building'],
    ['out', 'building'],
    ['info', 'passed'],
    ['tool', '$ web: echo broken test; exit 3'],
    ['out', 'broken test'],
    ['err', 'exit 3'],
  ]);
});

test('findings history: findings match across audits by category, check and file; Jira descriptions are ADF', () => {
  const f = (where: string, check = 'C07') => ({ check, severity: 'high' as const, title: 'x', where, evidence: '', impact: '', fix: '', acceptance: [] });
  assert.equal(findingKey('a/b', 'security', f('src/a.ts:42')), findingKey('a/b', 'security', f('src/a.ts:57'))); // lines move between audits
  assert.equal(findingKey('a/b', 'security', f('src/a.ts:42-50')), findingKey('a/b', 'security', f('src/a.ts')));
  assert.notEqual(findingKey('a/b', 'security', f('src/a.ts:1')), findingKey('a/b', 'security', f('src/a.ts:1', 'C08')));
  assert.notEqual(findingKey('a/b', 'security', f('src/a.ts:1')), findingKey('a/b', 'performance', f('src/a.ts:1')));
  const doc = toAdf([{ heading: 'Fix' }, { text: 'Scope by tenant' }, { code: 'findById(id)' }, { bullets: ['404 across tenants'] }]) as { content: { type: string }[] };
  assert.deepEqual(doc.content.map((c) => c.type), ['heading', 'paragraph', 'codeBlock', 'bulletList']);
});

test('provider account: claims are read from the id token for display, and junk is harmless', () => {
  const payload = Buffer.from(JSON.stringify({ email: 'dev@acme.test', 'https://api.openai.com/auth': { chatgpt_plan_type: 'team' } })).toString('base64url');
  const claims = jwtClaims(`h.${payload}.sig`);
  assert.equal(claims.email, 'dev@acme.test');
  assert.deepEqual(jwtClaims('not-a-jwt'), {});
});

test('login: the CLI output shown while finishing is short and never shows a token', () => {
  const raw = '\x1b[2K\x1b[1G╭────╮\r\nPaste code here if prompted > abc\r\n\x1b[31mOAuth error: invalid code\x1b[0m\r\nYour token: sk-ant-oat01-' + 'x'.repeat(40) + '\r\n';
  const words = lastWords(raw);
  assert.match(words, /OAuth error: invalid code/);
  assert.doesNotMatch(words, /sk-ant-/);
  assert.match(words, /\[hidden\]/);
});

test('auditor categories: each has a shipped skill and prompt; accessibility only audits React repositories', () => {
  for (const [category, c] of Object.entries(CATEGORIES)) {
    assert.ok(existsSync(asset(`skills/${c.skill}/SKILL.md`).path), `${category}: skill ${c.skill} is shipped`);
    assert.ok(existsSync(asset(`skills/${c.skill}/references/check-catalog.md`).path), `${category}: catalog`);
  }
  assert.ok(existsSync(asset('prompts/auditor/audit.md').path));
  assert.equal(CATEGORIES.accessibility.appliesTo?.({ repo: 'a/web', stack: 'react' }), true);
  assert.equal(CATEGORIES.accessibility.appliesTo?.({ repo: 'a/api', stack: 'dotnet' }), false);
  assert.equal(verdictLabel('security', 'block'), '🔴 Do not ship');
  assert.equal(verdictLabel('performance', 'block'), '🔴 Critical issues');
});

test('usage: model calls are summed per run, agent, model and day', async () => {
  await withRun({ agent: 'approver', item: 'usage-test', dryRun: true }, async (run) => {
    run.event('usage', 'review: usage', { inputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 100, outputTokens: 200, costUsd: 0.25, provider: 'claude', model: 'opus' });
    run.event('usage', 'review: usage', { inputTokens: 300, outputTokens: 50, provider: 'codex', model: 'default' });
    const usage = runsUsage([run.id]).get(run.id);
    assert.equal(usage?.tokens, 2150);
    assert.equal(usage?.cost, 0.25);
    return { status: 'done' };
  });
  const summary = usageSummary();
  assert.ok(summary.totals.today.input >= 1300);
  assert.ok(summary.byModel.some((m) => m.provider === 'claude' && m.model === 'opus' && m.cache >= 600));
  assert.ok(summary.byAgent.some((a) => a.agent === 'approver' && a.calls >= 2));
  assert.equal(summary.byDay[0].day, new Date().toISOString().slice(0, 10));
});

test('suite detection: Playwright, Cucumber and Cypress from the repository files, nothing assumed', () => {
  const files = (map: Record<string, string>) => ({ tree: Object.keys(map), read: (p: string) => map[p] });
  const pw = detectSuite(files({
    'package.json': '{"devDependencies":{"@playwright/test":"1.50.0"}}',
    'pnpm-lock.yaml': '',
    'playwright.config.ts': 'export default { use: { baseURL: process.env.APP_URL } }',
    'tests/login.spec.ts': 'await page.fill("#u", process.env.QA_USER); await page.fill("#p", process.env["QA_PASSWORD"]);',
  }));
  assert.equal(pw.found?.framework, 'playwright');
  assert.deepEqual(pw.found?.urlVars, ['APP_URL']);
  assert.deepEqual(pw.found?.secretVars, ['QA_PASSWORD', 'QA_USER']);
  assert.equal(pw.found?.isolateArgs, '{file}:{line}');

  const cucumber = detectSuite(files({
    'web/package.json': '{"devDependencies":{"@cucumber/cucumber":"11.0.0","playwright":"1.50.0"}}',
    'web/pnpm-lock.yaml': '',
    'web/features/a.feature': 'Feature: A',
    'web/features/support/world.js': 'const url = process.env.TARGET_URL;',
  }));
  assert.equal(cucumber.found?.framework, 'cucumber');
  assert.equal(cucumber.found?.workdir, 'web');
  assert.match(cucumber.found!.reportArgs, /\{report\}/);
  assert.ok(cucumber.found?.setupCommands.some((c) => c.includes('playwright install')));

  const cypress = detectSuite(files({ 'cypress.config.js': 'module.exports = {}', 'package-lock.json': '' }));
  assert.equal(cypress.found?.framework, 'cypress');
  assert.ok(cypress.found?.urlVars.includes('CYPRESS_BASE_URL'));
  assert.ok(cypress.notes.some((n) => /npm/.test(n)));

  const none = detectSuite(files({ 'package.json': '{"dependencies":{"react":"19"}}', 'src/App.tsx': '' }));
  assert.equal(none.found, undefined);
  const dotnet = detectSuite(files({ 'E2E/E2E.csproj': '<PackageReference Include="Microsoft.Playwright" />' }));
  assert.ok(dotnet.notes.some((n) => /\.NET/.test(n)));
});

test('reports: Playwright JSON, Cucumber JSON and JUnit become the same results', () => {
  const pw = parsePlaywrightJson({
    suites: [{
      title: 'login.spec.ts', file: 'login.spec.ts',
      suites: [{ title: 'Login', specs: [
        { title: 'works', file: 'login.spec.ts', line: 5, tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
        { title: 'shows an error', file: 'login.spec.ts', line: 12, tests: [{ status: 'unexpected', results: [{ status: 'failed', error: { message: 'expected 1' }, attachments: [{ contentType: 'image/png', body: 'iVBOR' }] }] }] },
      ] }],
    }],
  });
  assert.deepEqual(pw.map((t) => [t.title, t.status, t.line]), [['Login › works', 'passed', 5], ['Login › shows an error', 'failed', 12]]);
  assert.equal(pw[1].screenshots.length, 1);

  const cu = parseCucumberJson([{ uri: 'features/a.feature', elements: [
    { type: 'background', steps: [{ keyword: 'Given ', name: 'logged in', result: { status: 'failed', error_message: 'timeout' } }] },
    { type: 'scenario', name: 'Submit', line: 8, steps: [{ name: 'submit', result: { status: 'skipped' } }] },
  ] }]);
  assert.deepEqual(cu.map((t) => [t.id, t.status, t.failedStep]), [['features/a.feature › Submit', 'failed', 'Given logged in']]);

  const ju = parseJunit('<testsuites><testsuite name="Root" file="cypress/e2e/cart.cy.js"><testcase name="adds &amp; removes" classname="Cart"><failure message="expected 2">AssertionError</failure></testcase><testcase name="empty" classname="Cart"/></testsuite></testsuites>');
  assert.deepEqual(ju.map((t) => [t.title, t.status, t.file]), [['adds & removes', 'failed', 'cypress/e2e/cart.cy.js'], ['empty', 'passed', 'cypress/e2e/cart.cy.js']]);
  assert.match(ju[0].error!, /expected 2/);

  assert.equal(isolate('{file}:{line}', pw[1]), 'login.spec.ts:12');
  assert.equal(isolate('--spec {file}', ju[0]), '--spec cypress/e2e/cart.cy.js');
  assert.match(testLabel(pw[1].id), /^sentinel-[0-9a-f]{10}$/);
  assert.notEqual(testLabel(pw[0].id), testLabel(pw[1].id));
});

test('sentinel: test source, flattened secrets and environment validation', () => {
  const feature = 'Feature: Requests\n\n  @smoke\n  Scenario: Submit\n    When I submit\n    Then it is saved\n\n  Scenario: List\n    Then rows\n';
  assert.equal(testSource(feature, 4, 'cucumber'), '  @smoke\n  Scenario: Submit\n    When I submit\n    Then it is saved');
  assert.equal(testSource('a\nb\nc', 2, 'playwright'), 'b\nc');
  assert.deepEqual(flattenSecrets({ QA_USERS: '{"admin":{"email":"a@b.c","password":"p"}}', TOKEN: 'z' }), {
    QA_USERS_ADMIN_EMAIL: 'a@b.c', QA_USERS_ADMIN_PASSWORD: 'p', TOKEN: 'z',
  });
  const repos = { a: { repo: 'acme/web', stack: 'react' }, b: { repo: 'acme/api', stack: 'node' } };
  const project = (envRepos: object) => [{ name: 'W', repos, environment: { repos: envRepos } }];
  const web = { baseUrl: 'https://staging.acme.test/', e2e: true, explore: false };
  assert.deepEqual(validateProjects(project({ 'acme/web': web, 'acme/api': { baseUrl: '', e2e: false, explore: false } }))[0].environment, {
    repos: { 'acme/web': { baseUrl: 'https://staging.acme.test', e2e: true, explore: false } }, // unchecked repositories are dropped
  });
  assert.deepEqual(validateProjects(project({ 'acme/api': { baseUrl: 'https://api.acme.test', branch: 'develop', e2e: false, explore: true } }))[0].environment?.repos['acme/api'], {
    baseUrl: 'https://api.acme.test', branch: 'develop', e2e: false, explore: true,
  });
  assert.equal(validateProjects(project({}))[0].environment, undefined); // nothing checked: no test environment
  assert.throws(() => validateProjects(project({ 'other/x': web })), /not one of the project's repositories/);
  assert.throws(() => validateProjects(project({ 'acme/web': { ...web, baseUrl: 'ftp://x' } })), /http\(s\) URL/);

  assert.deepEqual(parseTestVars('{"QA_USERS":{"admin":{"email":"a@b.c"}},"PORT":3000}'), { QA_USERS: '{"admin":{"email":"a@b.c"}}', PORT: '3000' });
  assert.throws(() => parseTestVars('{"GH_TOKEN":"x"}'), /does not set/);
  assert.throws(() => parseTestVars('{"qa users":"x"}'), /does not set/);
  assert.throws(() => parseTestVars('[1]'), /JSON object/);
  assert.throws(() => parseTestVars('{oops'), /valid JSON/);
});

test('sentinel: exploration sees the changes newest first, with the cards they name', () => {
  const text = describeChanges(
    {
      commits: [
        { sha: 'aaaaaaa1111', message: 'feat: coupons at checkout (ABC-12)\n\nlong body' },
        { sha: 'bbbbbbb2222', message: 'fix: rounding (#40)' },
      ],
      files: [{ filename: 'src/checkout/Coupon.tsx', status: 'added' }],
    },
    { 'ABC-12': 'Apply a coupon at checkout' },
  );
  assert.equal(
    text,
    [
      'Commits (2, newest first):',
      '- bbbbbbb fix: rounding (#40)',
      '- aaaaaaa feat: coupons at checkout (ABC-12)',
      '',
      'Cards they name:',
      '- ABC-12: Apply a coupon at checkout',
      '',
      'Changed files (1):',
      '- added src/checkout/Coupon.tsx',
    ].join('\n'),
  );
});

test('sentinel: evidence is cleaned of credentials before it is kept or attached', () => {
  const har = JSON.stringify({
    log: {
      entries: [{
        request: {
          url: 'https://dev.acme.test/authenticate?session=abc&page=2',
          headers: [{ name: 'Cookie', value: 'rack.session=xyz' }, { name: 'Accept', value: 'text/html' }],
          cookies: [{ name: 'rack.session', value: 'xyz' }],
          queryString: [{ name: 'session', value: 'abc' }, { name: 'page', value: '2' }],
          postData: { mimeType: 'application/x-www-form-urlencoded', text: 'username=tom&password=S3cretPass', params: [{ name: 'password', value: 'S3cretPass' }] },
        },
        response: { headers: [{ name: 'Set-Cookie', value: 'rack.session=new' }], content: { text: 'Welcome tom, your password S3cretPass' } },
      }],
    },
  });
  const clean = sanitizeHar(har, ['S3cretPass', 'tom']);
  assert.doesNotMatch(clean, /S3cretPass|rack\.session=xyz|rack\.session=new/);
  assert.match(clean, /"name":"Accept","value":"text\/html"/);
  assert.match(clean, /"name":"page","value":"2"/);
  assert.equal(maskSecrets('login as tom@acme.test with Pa55word', ['Pa55word', 'tom@acme.test']), 'login as [REDACTED] with [REDACTED]');
});

test('suite detection: only the base URL variable gets the environment URL; e2e code wins over unit tests', () => {
  const map: Record<string, string> = {
    'package.json': '{"devDependencies":{"@cucumber/cucumber":"11.0.0"}}',
    'pnpm-lock.yaml': '',
    'features/a.feature': 'Feature: A',
    'e2e/support/env.js': 'const app = process.env.APP_BASE_URL; const api = process.env.APP_API_URL; const users = JSON.parse(process.env.QA_USERS);',
  };
  const found = detectSuite({ tree: [...Object.keys(map), ...Array.from({ length: 300 }, (_, i) => `src/c${i}.test.js`)], read: (p) => map[p] });
  assert.deepEqual(found.found?.urlVars, ['APP_BASE_URL']);
  assert.deepEqual(found.found?.secretVars, ['QA_USERS']);
  assert.deepEqual(envRefs(['const { REPORT_TOKEN, LABEL = "x", PROJECT_KEY: key } = process.env;']), ['LABEL', 'PROJECT_KEY', 'REPORT_TOKEN']);
  assert.ok(found.notes.some((n) => n.includes('APP_API_URL')));
});

test('a usage or spend limit pauses the provider until the reset the message names', () => {
  const now = Date.parse('2026-11-10T21:01:00Z');
  const spend = "claude: You've hit your individual spend limit · ask your admin to raise it · your session limit resets 1:30am (UTC)";
  assert.equal(new Date(limitPause(spend, now)!).toISOString(), '2026-11-11T01:30:00.000Z'); // next occurrence, tomorrow
  assert.equal(new Date(limitPause('usage limit, resets 11pm (UTC)', now)!).toISOString(), '2026-11-10T23:00:00.000Z');
  assert.equal(limitPause('Claude AI usage limit reached|1794370000', now), 1794370000_000);
  assert.equal(limitPause('rate limit (HTTP 429)', now), now + 60 * 60_000); // no reset named: an hour
  assert.equal(limitPause('claude: no structured output', now), undefined);
  assert.ok(limitPause('Your workspace is out of credits. Ask your workspace owner to refill', now));
});

test('account limits: Claude rate limit events and Codex session rate limits', () => {
  const claude = claudeLimits([
    { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1794360600, unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 1794360600 } } } },
    { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1794360600, unifiedWindows: { five_hour: { utilization: 1.06, resetsAt: 1794360600 }, seven_day: { utilization: 0.32, resetsAt: 1794834000 } } } },
  ]);
  assert.deepEqual(claude?.windows.map((w) => [w.name, w.usedPercent]), [['5 hours', 106], ['7 days', 32]]); // the last event wins
  assert.equal(claude?.limitedUntil, '2026-11-11T01:30:00.000Z');
  assert.equal(claudeLimits([{ type: 'result' }]), undefined);
  const codex = codexLimits({ primary: { used_percent: 100, window_minutes: 300, resets_at: 1794365275 }, secondary: { used_percent: 3, window_minutes: 10080, resets_at: 1794846757 }, plan_type: 'team', rate_limit_reached_type: 'primary' });
  assert.deepEqual(codex.windows.map((w) => [w.name, w.usedPercent]), [['5 hours', 100], ['7 days', 3]]);
  assert.equal(codex.limitedUntil, new Date(1794365275_000).toISOString());
  assert.equal(codexLimits({ primary: { used_percent: 40, window_minutes: 300, resets_at: 1 }, rate_limit_reached_type: null }).limitedUntil, null);
  const line = (r: object) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: r } });
  const session = [line({ limit_id: 'codex', primary: { used_percent: 61, window_minutes: 300, resets_at: 1 }, secondary: null }), line({ limit_id: 'premium', primary: null, secondary: null })].join('\n');
  assert.deepEqual(lastCodexWindows(session)?.windows.map((w) => [w.name, w.usedPercent]), [['5 hours', 61]]); // the premium bucket has no windows
  const agy = agyLimits({ groups: [{ name: 'Gemini Models', buckets: [{ window: '5h', remaining_fraction: 0.25, reset_time: '2026-11-12T17:05:46Z' }, { window: 'weekly', remaining_fraction: 1 }] }] });
  assert.deepEqual(agy.windows.map((w) => [w.name, w.usedPercent]), [['Gemini Models: 5 hours', 75], ['Gemini Models: 7 days', 0]]);
  assert.equal('limitedUntil' in agy, false); // never lifts or sets a pause
});

test('actionsLinks finds run and job links once', async () => {
  const { actionsLinks } = await import('../src/integrations/github.ts');
  const text = [
    'see https://github.com/acme/shop/actions/runs/42/job/7 and https://github.com/acme/shop/actions/runs/42/job/7?pr=1',
    'and github.com/Acme/API/actions/runs/9, not https://evil.example/github.com/acme/shop/actions/runs/5',
    'nor https://github.com/other/private/actions/runs/6',
  ].join(' ');
  assert.deepEqual(actionsLinks(text, ['acme/shop', 'acme/api']), [
    { repo: 'acme/shop', run: '42', job: '7' },
    { repo: 'Acme/API', run: '9', job: undefined },
  ]);
});

test('approvers counts people, not agentCowork approvals', async () => {
  const { approvers } = await import('../src/agents/dependabot.ts');
  const review = (login: string, state: string, body = '', submittedAt = '2026-01-02T00:00:00Z', authorAssociation = 'MEMBER') => ({ author: { login }, authorAssociation, state, body, submittedAt });
  const commits = [{ committedDate: '2026-01-01T00:00:00Z' }];
  assert.deepEqual(
    approvers({ commits, latestReviews: [review('dev', 'APPROVED'), review('copilot', 'COMMENTED'), review('ops', 'APPROVED', 'ok\n\n---\n🤖 agentCowork Dependabot agent')] }),
    ['dev'],
  );
  // Approved before Dependabot's last commit (a new version, a rebase): stale.
  assert.deepEqual(approvers({ commits: [{ committedDate: '2026-01-03T00:00:00Z' }], latestReviews: [review('dev', 'APPROVED')] }), []);
  // Bots and people without a say on the repository don't count.
  assert.deepEqual(approvers({ commits, latestReviews: [review('auto[bot]', 'APPROVED'), review('stranger', 'APPROVED', '', undefined, 'NONE')] }), []);
  assert.deepEqual(approvers({}), []);
});

test('a restart closes running runs and puts an interrupted Developer card back in the queue', async () => {
  const { closeOrphanRuns } = await import('../src/runs.ts');
  const { sql } = await import('../src/db.ts');
  const add = sql().prepare("INSERT INTO runs (agent, item, title, status, dry_run, started_at) VALUES (?, ?, ?, 'running', 0, '2026-01-01T00:00:00Z')");
  add.run('developer', 'ABC-9', 'Shop');
  add.run('approver', 'acme/shop#1', 'PR');
  // A PR follow-up interrupted by the restart: its card keeps watching the PR.
  new Items('developer', false).watch('ABC-8', { project: 'Shop', prs: [] });
  add.run('developer', 'ABC-8', 'Shop · PR follow-up');
  closeOrphanRuns();
  assert.equal((sql().prepare("SELECT count(*) n FROM runs WHERE status = 'running'").get() as { n: number }).n, 0);
  const item = new Items('developer', false).get('ABC-9');
  assert.equal(item?.status, 'waiting');
  assert.equal(item?.data.resume, true);
  assert.equal(new Items('approver', false).get('acme/shop#1'), undefined);
  assert.equal(new Items('developer', false).get('ABC-8')?.status, 'watching');
});

test('freeBranch releases a card branch held by an abandoned worktree', async () => {
  const { freeBranch, run } = await import('../src/sh.ts');
  const base = mkdtempSync(join(tmpdir(), 'wt-'));
  const git = (...args: string[]) => run('git', args);
  await git('init', '-q', join(base, 'src'));
  await git('-C', join(base, 'src'), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const cache = join(base, 'cache');
  await git('clone', '-q', '--bare', join(base, 'src'), cache);
  await git('-C', cache, 'worktree', 'add', '-q', '-B', 'ai/X-1', join(base, 'old'), 'HEAD');
  // Another card's live checkout: a branch that only starts with the same name.
  await git('-C', cache, 'worktree', 'add', '-q', '-B', 'ai/X-10', join(base, 'other'), 'HEAD');
  await assert.rejects(git('-C', cache, 'worktree', 'add', '--force', '-B', 'ai/X-1', join(base, 'new'), 'HEAD'));
  await freeBranch(cache, 'ai/X-1');
  await git('-C', cache, 'worktree', 'add', '--force', '-B', 'ai/X-1', join(base, 'new'), 'HEAD');
  assert.equal(existsSync(join(base, 'old')), false);
  assert.equal(existsSync(join(base, 'other')), true);
});

test('fixBranch reads the Dependabot branch from the record of the card, by card key', async () => {
  const { fixBranch } = await import('../src/agents/dependabot.ts');
  new Items('dependabot', false).done('card:https://github.com/acme/shop/pull/7', { key: 'ABC-7', url: 'x', repo: 'acme/shop', branch: 'dependabot/npm_and_yarn/antd-6.7.0' });
  assert.deepEqual(fixBranch('ABC-7'), { repo: 'acme/shop', branch: 'dependabot/npm_and_yarn/antd-6.7.0' });
  assert.equal(fixBranch('ABC-6'), undefined);
});

test('ui translations: a missing text falls back to English, placeholders are filled', async () => {
  const { translate } = await import('../ui/src/translate.ts');
  const { default: shell } = await import('../ui/src/locales/shell.ts');
  assert.equal(translate(shell['pt-BR'], 'Inbox'), 'Caixa de entrada');
  assert.equal(translate(shell['es-ES'], 'Log out {user}', { user: 'admin' }), 'Cerrar sesión (admin)');
  assert.equal(translate(shell['pt-BR'], 'Some text nobody translated'), 'Some text nobody translated');
  assert.equal(translate({}, 'Page {n}', { n: 2 }), 'Page 2');
});

test('inbox events: once when an item starts needing a person, again only for a new reason', () => {
  const seen: string[] = [];
  onInbox((e) => seen.push(`${e.agent}:${e.key}:${e.status}`));
  const live = new Items('dependabot', false);
  live.human('pr-9', { reason: 'major update' });
  live.human('pr-9', { reason: 'major update' }); // same reason: no second message
  live.human('pr-9', { reason: 'CI failing' }); // new reason
  new Items('dependabot', true).human('pr-9', { reason: 'dry run' }); // dry runs never notify
  new Items('developer', false).wait('ABC-3', { project: 'Shop', resume: true }); // put back in the queue
  new Items('developer', false).done('ABC-4');
  new Items('developer', false).fail('ABC-5', 'boom');
  new Items('developer', false).fail('ABC-6', 'claude: usage limit reached'); // a limit is not a failure
  assert.deepEqual(seen, ['dependabot:pr-9:human', 'dependabot:pr-9:human', 'developer:ABC-5:failed']);
  onInbox(() => {});
});

test('notify posts a generic JSON to the stored webhook, only for enabled events', async () => {
  const { createServer } = await import('node:http');
  const { notify, sendTest, webhookBody } = await import('../src/notify.ts');
  const received: Record<string, unknown>[] = [];
  let status = 200;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c)).on('end', () => (received.push(JSON.parse(body)), res.writeHead(status).end()));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    setSecret('notifications.webhookUrl', `http://127.0.0.1:${port}/hook`);
    write('notifications', { uiUrl: 'https://agents.example.com', events: { inbox: true, pr: true, limit: false, merged: false } });
    notify('limit', { title: 'off', text: 'not sent' });
    notify('pr', { title: 'Developer opened a pull request for ABC-1', text: 'Fix it', url: 'https://github.com/acme/shop/pull/1' });
    for (let i = 0; i < 50 && received.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(received.length, 1);
    assert.equal(received[0].event, 'pr');
    assert.match(String(received[0].text), /Developer opened a pull request for ABC-1\nFix it\nhttps:\/\/github.com\/acme\/shop\/pull\/1/);
    assert.equal(received[0].content, received[0].text);
    status = 500;
    const test = await sendTest();
    assert.equal(test.ok, false);
    assert.match(test.message, /webhook: webhook answered 500/);
    // Without a URL of its own, a message links to the UI's inbox.
    assert.equal(webhookBody('inbox', { title: 't', text: 'x' }, 'https://agents.example.com').url, 'https://agents.example.com/#/inbox');
  } finally {
    server.close();
  }
});

test('documenter: only the docs folder survives, and the folder must stay inside the repository', async () => {
  const { changedPaths, outsideFolder } = await import('../src/agents/documenter.ts');
  const porcelain = [' M .agents/00-INDEX.md', '?? .agents/domains/domain-billing.md', ' M src/app.ts', 'R  old.md -> .agents-old/x.md', '?? .agentsX/y.md'].join('\n');
  const paths = changedPaths(porcelain);
  assert.deepEqual(paths, ['.agents/00-INDEX.md', '.agents/domains/domain-billing.md', 'src/app.ts', '.agents-old/x.md', '.agentsX/y.md']);
  assert.deepEqual(outsideFolder(paths, '.agents'), ['src/app.ts', '.agents-old/x.md', '.agentsX/y.md']);
  const base = { enabled: false, dryRun: true, provider: 'claude', model: '', intervalDays: 7, concurrency: 1 };
  assert.equal(read('agents.documenter').folder, '.agents');
  assert.equal(write('agents.documenter', { ...base, folder: './docs/architecture/' }).folder, 'docs/architecture');
  for (const folder of ['', '.', '../outside', 'docs/../..', '/etc']) assert.throws(() => write('agents.documenter', { ...base, folder }), /folder/);
  write('agents.documenter', { ...base, folder: '.agents' });
});

test('claude: the run\'s own result wins over background-subagent notifications that come after it', () => {
  const main = { type: 'result', is_error: true, result: "You've hit your spend limit · resets 3:50pm (UTC)" };
  const late = { type: 'result', is_error: false, result: '', origin: { kind: 'task-notification' } };
  assert.equal(mainResult([{ type: 'system' }, main, late, late]), main);
});

test('brain: search, secrets refused, and a note changed meanwhile is appended to, not overwritten', async () => {
  const { mkdtemp, readFile, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { listNotes, looksSecret, parseNote, saveNotes, searchNotes, validNotePath } = await import('../src/brain.ts');
  const note = parseNote('database/rls.md', '---\ntags: [database, rls]\nrepos: [api]\n---\n# Dev enforces RLS\n\nQueries must set the tenant in the session context first.\n');
  assert.deepEqual([note.title, note.tags, note.repos], ['Dev enforces RLS', ['database', 'rls'], ['api']]);
  const other = parseNote('toolchain/frontend-tests.md', '# Frontend tests\n\nRun jest with the unit config.\n');
  assert.deepEqual(searchNotes([other, note], 'Conexão ao banco com RLS falha').map((n) => n.path), ['database/rls.md']);

  for (const secret of ['Password=hunter22;', 'token: ghp_abcdefghijklmnop1234', 'postgres://app:s3cret@db:5432/x', 'api_key = "abcd1234efgh"']) assert.ok(looksSecret(secret), secret);
  assert.ok(!looksSecret('Set the password in DB_PASSWORD; commit 93d93b06e4f1a2b3c4d5e6f708192a3b4c5d6e7f.'));
  assert.ok(validNotePath('database/rls.md') && !validNotePath('../x.md') && !validNotePath('Database/RLS.md') && !validNotePath('a/b/c/d.md'));

  const dir = await mkdtemp(join(tmpdir(), 'brain-'));
  const first = await saveNotes(dir, [{ path: 'database/rls.md', title: 'Dev enforces RLS', tags: ['rls'], repos: ['api'], body: 'Set the tenant first.' }, { path: 'x/leak.md', title: 'Leak', tags: [], repos: [], body: 'Password=hunter22;' }], new Map(), 'run 1');
  assert.deepEqual(first.saved, ['database/rls.md']);
  assert.equal(first.refused.length, 1);
  const seen = new Map((await listNotes(dir)).map((n) => [n.path, n.hash]));
  // A person edits the note in Obsidian after the run read it: the run's text is appended, the edit kept.
  await writeFile(join(dir, 'database/rls.md'), '# Dev enforces RLS\n\nEdited by a person.\n');
  await saveNotes(dir, [{ path: 'database/rls.md', title: 'Dev enforces RLS', tags: ['rls'], repos: [], body: 'Also on reports.' }], seen, 'run 2');
  const text = await readFile(join(dir, 'database/rls.md'), 'utf8');
  assert.ok(text.includes('Edited by a person.') && text.includes('## Update (run 2') && text.includes('Also on reports.'));
  assert.ok((await readFile(join(dir, 'INDEX.md'), 'utf8')).includes('[[database/rls]]'));
});

test('developer: two reviewers pass only when each passes, every finding kept; a missing one means the defaults', async () => {
  const { mergeReviews } = await import('../src/agents/developer.ts');
  const ok = { verdict: 'approve' as const, findings: [{ severity: 'minor' as const, where: 'a', body: 'nit' }], summary: 'Fine.' };
  const no = { verdict: 'changes' as const, findings: [{ severity: 'major' as const, where: 'b', body: '[second reviewer] bug' }], summary: 'Bug.' };
  assert.deepEqual(mergeReviews([ok]), ok);
  assert.equal(mergeReviews([ok, ok]).verdict, 'approve');
  const both = mergeReviews([ok, no]);
  assert.equal(both.verdict, 'changes');
  assert.equal(both.findings.length, 2);
  // Settings saved before the flags: the first reviewer stays on, the second off.
  const dev = read('agents.developer');
  assert.equal(dev.reviewer.enabled, true);
  assert.equal(dev.secondReviewer.enabled, false);
  assert.throws(() => write('agents.developer', { ...dev, secondReviewer: { provider: 'agy', model: '' } }), /enabled/);
  write('agents.developer', { ...dev, reviewer: { ...dev.reviewer, enabled: false } });
  assert.equal(read('agents.developer').reviewer.enabled, false);
  write('agents.developer', dev);
});

test('codex app server limits: the plan windows, and a pause until the full window resets', async () => {
  const { fromAppServer } = await import('../src/providers/codex.ts');
  const limits = fromAppServer({
    primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1794499493 },
    secondary: { usedPercent: 24, windowDurationMins: 10080, resetsAt: 1794846757 },
    planType: 'team',
    rateLimitReachedType: 'workspace_member_credits_depleted',
  });
  assert.deepEqual(limits.windows.map((w) => [w.name, w.usedPercent]), [['5 hours', 100], ['7 days', 24]]);
  assert.equal(limits.limitedUntil, new Date(1794499493_000).toISOString());
  assert.equal(fromAppServer({ primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1 }, rateLimitReachedType: null }).limitedUntil, null);
});

test('a limit error pauses until a usage window already full resets, not just an hour', async () => {
  const { fullWindowReset, recordLimits } = await import('../src/providers/limits.ts');
  const now = Date.now();
  const reset = new Date(now + 2 * 3_600_000).toISOString();
  recordLimits('agy', { windows: [{ name: '5 hours', usedPercent: 100, resetsAt: reset }, { name: '7 days', usedPercent: 20, resetsAt: new Date(now + 9e8).toISOString() }], limitedUntil: null });
  assert.equal(fullWindowReset('agy', now), Date.parse(reset));
  recordLimits('agy', { windows: [{ name: '5 hours', usedPercent: 40, resetsAt: reset }] });
  assert.equal(fullWindowReset('agy', now), undefined);
});

test('fallbackOrder: chosen provider first, then Claude, Codex, agy, avoided last, alone when off', () => {
  assert.deepEqual(fallbackOrder('claude', [], true), ['claude', 'codex', 'agy']);
  assert.deepEqual(fallbackOrder('codex', [], true), ['codex', 'claude', 'agy']);
  assert.deepEqual(fallbackOrder('agy', [], true), ['agy', 'claude', 'codex']);
  assert.deepEqual(fallbackOrder('agy', ['claude', 'agy'], true), ['agy', 'codex', 'claude']);
  assert.deepEqual(fallbackOrder('codex', [], false), ['codex']);
});
