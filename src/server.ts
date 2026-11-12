import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { AGENTS, agentStatus, forceAgent } from './agents/status.ts';
import { asset, type AssetSource, DEFAULTS_DIR } from './assets.ts';
import { type AgentId, DEFAULTS, envSecretName, PROVIDERS, type Project, type ProviderId, read, SECRETS, type SectionKey, parseTestVars, write } from './config.ts';
import { brainDir, brainSlug, listNotes } from './brain.ts';
import { safeEqual, signSession, verifySession } from './crypto.ts';
import { audit, auditLog, deleteSecret, getSecret, Items, itemsByStatus, needsPerson, secretNames, setSecret } from './db.ts';
import { env } from './env.ts';
import { applyGithubEnv, testGithub } from './integrations/github.ts';
import { checkBoard, jiraStatus, testJira } from './integrations/jira.ts';
import { providerStatus } from './providers/index.ts';
import { auditDetail, createFindingCard, findingsOverview } from './agents/auditor.ts';
import { createExplorationCard } from './agents/sentinel.ts';
import { resolveSuite } from './agents/suite.ts';
import { liveOutput } from './live.ts';
import { sendTest } from './notify.ts';
import { runsUsage, usageSummary } from './usage.ts';
import { accountInfo } from './providers/account.ts';
import { cancelLogin, disconnectAccount, loginState, startLogin, submitLoginCode } from './providers/login.ts';
import { readLimits, recordLimits } from './providers/limits.ts';
import { listModels } from './providers/models.ts';
import { deleteRuns, getRun, killAgent, killRun, listRuns, runFiles } from './runs.ts';
import { isPolling, lastError, lastPoll, wake } from './scheduler.ts';
import { log, recentLogs } from './sh.ts';

const UI_DIR = join(import.meta.dirname, '..', 'ui', 'dist');
const COOKIE = 'acw_session';
const MAX_BODY = 1_000_000;
// Mutating requests must carry this header: a cross-site form or image cannot set it (CSRF).
const CSRF_HEADER = 'x-agentcowork';
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

const ALLOWED_SECRETS = new Set<string>([
  SECRETS.githubToken,
  SECRETS.jiraToken,
  SECRETS.claudeOauthToken,
  SECRETS.webhookUrl,
  ...PROVIDERS.map((p) => SECRETS.providerApiKey(p)),
]);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; user: string; body: () => Promise<unknown> };
type Handler = (ctx: Ctx, params: string[]) => unknown | Promise<unknown>;
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
const route = (method: string, path: string, handler: Handler) =>
  routes.push({ method, pattern: new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`), handler });

const loginAttempts = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const recent = (loginAttempts.get(ip) ?? []).filter((t) => Date.now() - t < LOGIN_WINDOW_MS);
  recent.push(Date.now());
  loginAttempts.set(ip, recent);
  return recent.length > LOGIN_MAX_ATTEMPTS;
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function sessionCookie(req: IncomingMessage, value: string, maxAge: number): string {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${name} is required`);
  return v.trim();
};
const agentParam = (v: string): AgentId => {
  if (!AGENTS.includes(v as AgentId)) throw new HttpError(404, 'Unknown agent');
  return v as AgentId;
};
const providerParam = (v: string): ProviderId => {
  if (!PROVIDERS.includes(v as ProviderId)) throw new HttpError(404, 'Unknown provider');
  return v as ProviderId;
};

type AssetFile = { name: string; group: 'instructions' | 'prompts' | 'skills'; source: AssetSource; path: string };

/** Every viewable asset file. Names are the only thing the file route accepts, so nothing else is readable. */
function assetFiles(): AssetFile[] {
  const instructions = asset('AGENTS.md');
  const skills = asset('skills');
  const markdown = (dir: string) =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.md'))
      .sort();
  return [
    { name: 'AGENTS.md', group: 'instructions', ...instructions },
    ...markdown(join(DEFAULTS_DIR, 'prompts')).map((f) => ({ name: `prompts/${f}`, group: 'prompts' as const, ...asset(`prompts/${f}`) })),
    // The skills folder is replaced as a whole, so its files are listed from wherever it resolves.
    ...markdown(skills.path).map((f) => ({ name: `skills/${f}`, group: 'skills' as const, source: skills.source, path: join(skills.path, f) })),
  ];
}

function assetsInfo() {
  const instructions = asset('AGENTS.md');
  const skills = asset('skills');
  return {
    instructions: { source: instructions.source, path: instructions.path },
    skills: { source: skills.source, path: skills.path },
    files: assetFiles().map(({ name, group, source }) => ({ name, group, source })),
  };
}

/** What needs a person: questions, parked runs, items handed over, PR follow-ups that gave up, and items out of retries. */
const inboxItems = () => itemsByStatus(['waiting', 'human', 'watching', 'failed']).filter((i) => needsPerson(i.status, i.attempts, i.data));

// --- routes ---

route('GET', '/api/me', ({ user }) => ({ user, instance: env.instanceName }));

route('GET', '/api/overview', () => {
  const inbox = inboxItems();
  return {
    instance: env.instanceName,
    live: AGENTS.filter((id) => read(`agents.${id}`).dryRun === false),
    agents: AGENTS.map((id) => ({ id, ...agentStatus(id), polling: isPolling(id), lastPoll: lastPoll[id] ?? null, lastError: lastError[id] ?? null })),
    running: listRuns({ status: 'running', limit: 50 }),
    recent: listRuns({ limit: 10 }),
    inbox: inbox.length,
    following: itemsByStatus(['watching']).filter((i) => !i.data.parked).length,
  };
});

route('GET', '/api/settings', () => ({
  sections: Object.fromEntries((Object.keys(DEFAULTS) as SectionKey[]).map((k) => [k, read(k)])),
  secrets: Object.fromEntries([...ALLOWED_SECRETS].map((name) => [name, secretNames().includes(name)])),
  testVars: Object.fromEntries(read('projects').items.map((p) => [p.name, Object.fromEntries(Object.values(p.repos).map((r) => [r.repo, testVarNames(p.name, r.repo)]))])),
  providers: Object.fromEntries(PROVIDERS.map((p) => [p, { ...providerStatus(p), account: accountInfo(p) }])),
  agents: Object.fromEntries(AGENTS.map((a) => [a, agentStatus(a)])),
  assets: assetsInfo(),
}));

route('PUT', '/api/settings/:section', async ({ body, user }, [section]) => {
  if (!(section in DEFAULTS)) throw new HttpError(404, 'Unknown section');
  try {
    const saved = write(section as SectionKey, await body());
    audit(user, 'settings.update', section);
    if (section === 'github') applyGithubEnv();
    return saved;
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
});

route('PUT', '/api/secrets/:name', async ({ body, user }, [name]) => {
  if (!ALLOWED_SECRETS.has(name)) throw new HttpError(404, 'Unknown secret');
  const value = str((await body() as { value?: unknown }).value, 'value');
  if (value.length > 10_000) throw new HttpError(400, 'Value too long');
  if (name === SECRETS.webhookUrl && !/^https?:\/\/[^\s/]+\/?\S*$/.test(value)) throw new HttpError(400, 'The webhook must be an http(s) URL');
  setSecret(name, value);
  audit(user, 'secret.set', name);
  if (name === SECRETS.githubToken) applyGithubEnv();
  return { ok: true };
});

/** A saved project, for its test environment routes. */
const savedProject = (name: unknown) => {
  const project = read('projects').items.find((pr) => pr.name === name);
  if (!project) throw new HttpError(400, 'Save the project first');
  return project;
};
/** The names of a repository's stored test variables (never their values). */
const testVarNames = (project: string, repo: string) => {
  try {
    return Object.keys(parseTestVars(getSecret(envSecretName(project, repo)) ?? '{}'));
  } catch {
    return []; // stored before a rule changed: shown as nothing stored, replaced on the next save
  }
};
/** A repository of a saved project: only the project's own repositories are read or get variables. */
const projectRepo = (project: Project, repo: unknown) => {
  const found = Object.values(project.repos).find((r) => r.repo === repo);
  if (!found) throw new HttpError(400, 'Save the project with this repository first');
  return found.repo;
};

/** The suite a repository of a saved project would run now (read-only, through the GitHub API): the same resolution every run does. */
route('POST', '/api/projects/detect-suite', async ({ body }) => {
  const b = (await body()) as { project?: unknown; repo?: unknown; branch?: unknown };
  const project = savedProject(b.project);
  const repo = projectRepo(project, b.repo);
  applyGithubEnv();
  return resolveSuite(project, repo, typeof b.branch === 'string' ? b.branch.slice(0, 200) : undefined);
});

/** A repository's test variables: one JSON object, stored encrypted, never returned; its test commands get them. */
route('PUT', '/api/env-secrets', async ({ body, user }) => {
  const b = (await body()) as { project?: unknown; repo?: unknown; value?: unknown };
  const project = savedProject(b.project);
  const name = envSecretName(project.name, projectRepo(project, b.repo));
  const value = str(b.value, 'value');
  if (value.length > 20_000) throw new HttpError(400, 'Value too long');
  let names: string[];
  try {
    names = Object.keys(parseTestVars(value));
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  setSecret(name, value);
  audit(user, 'secret.set', name);
  return { names };
});
route('POST', '/api/env-secrets/delete', async ({ body, user }) => {
  const b = (await body()) as { project?: unknown; repo?: unknown };
  const project = savedProject(b.project);
  const name = envSecretName(project.name, projectRepo(project, b.repo));
  deleteSecret(name);
  audit(user, 'secret.delete', name);
  return { ok: true };
});

route('DELETE', '/api/secrets/:name', ({ user }, [name]) => {
  if (!ALLOWED_SECRETS.has(name)) throw new HttpError(404, 'Unknown secret');
  deleteSecret(name);
  audit(user, 'secret.delete', name);
  return { ok: true };
});

route('POST', '/api/test/github', async () => {
  try {
    return { ok: true, message: `Connected as ${await testGithub()}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message.slice(0, 300) };
  }
});

route('POST', '/api/test/jira', async () => {
  try {
    return { ok: true, message: `Connected as ${await testJira()}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message.slice(0, 300) };
  }
});

route('POST', '/api/test/jira/board', async ({ body }) => {
  const b = (await body()) as { boardId?: unknown };
  const boardId = str(b.boardId, 'boardId');
  if (!/^\d{1,10}$/.test(boardId)) throw new HttpError(400, 'boardId must be a number');
  const status = jiraStatus();
  if (!status.ready) return { checks: [{ label: 'Jira', ok: false, detail: status.reason }] };
  try {
    return { checks: await checkBoard(boardId) };
  } catch (err) {
    return { checks: [{ label: 'Board', ok: false, detail: (err as Error).message.slice(0, 300) }] };
  }
});

route('POST', '/api/notifications/test', async ({ user }) => {
  audit(user, 'notifications.test', '');
  return sendTest();
});

route('GET', '/api/providers/:id/models', async ({ url }, [id]) => {
  try {
    return { models: await listModels(providerParam(id), url.searchParams.get('refresh') === '1') };
  } catch (err) {
    return { models: [], error: (err as Error).message.slice(0, 300) };
  }
});
route('GET', '/api/providers/:id/login', (_c, [id]) => loginState(providerParam(id)) ?? null);
route('POST', '/api/providers/:id/login', ({ user }, [id]) => {
  audit(user, 'provider.login.start', id);
  return startLogin(providerParam(id), user);
});
route('POST', '/api/providers/:id/login/code', async ({ body }, [id]) => {
  try {
    return await submitLoginCode(providerParam(id), str((await body() as { code?: unknown }).code, 'code'));
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
});
route('DELETE', '/api/providers/:id/login', (_c, [id]) => {
  cancelLogin(providerParam(id));
  return { ok: true };
});

route('DELETE', '/api/providers/:id/account', ({ user }, [id]) => {
  disconnectAccount(providerParam(id));
  audit(user, 'provider.disconnect', id);
  return { ok: true };
});

route('POST', '/api/agents/:id/run-now', ({ user }, [id]) => {
  const agent = agentParam(id);
  // Run now redoes the agent's work, including what it already handled. Not the Developer: redoing a card
  // would open a second branch and PR for it, so Run now only makes it look for cards now.
  if (agent !== 'developer') forceAgent(agent);
  wake(agent);
  audit(user, 'agent.run-now', id);
  return { ok: true };
});
route('POST', '/api/agents/:id/stop', ({ user }, [id]) => {
  const killed = killAgent(agentParam(id));
  audit(user, 'agent.stop', `${id}: ${killed} run(s)`);
  return { killed };
});

route('GET', '/api/runs', ({ url }) => {
  const runs = listRuns({
    agent: url.searchParams.get('agent') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    before: Number(url.searchParams.get('before')) || undefined,
    limit: Number(url.searchParams.get('limit')) || 50,
    offset: Number(url.searchParams.get('offset')) || 0,
  });
  const usage = runsUsage(runs.map((r) => r.id));
  return runs.map((r) => ({ ...r, tokens: usage.get(r.id)?.tokens ?? 0, cost: usage.get(r.id)?.cost ?? 0 }));
});
route('GET', '/api/runs/:id', (_c, [id]) => {
  const found = getRun(Number(id));
  if (!found) throw new HttpError(404, 'Run not found');
  const usage = runsUsage([found.id]).get(found.id);
  return { ...found, tokens: usage?.tokens ?? 0, cost: usage?.cost ?? 0 };
});
route('GET', '/api/usage', () => ({
  ...usageSummary(),
  limits: Object.fromEntries(PROVIDERS.map((id) => [id, readLimits(id) ?? null])),
  accounts: Object.fromEntries(PROVIDERS.map((id) => [id, accountInfo(id) ?? null])),
}));
/** Lift a usage-limit pause before its reset (e.g. the plan's limit was raised): the next poll tries again. */
route('POST', '/api/providers/:id/limits/clear', ({ user }, [id]) => {
  recordLimits(providerParam(id), { limitedUntil: null });
  audit(user, 'provider.limit.clear', id);
  for (const agent of AGENTS) wake(agent);
  return { ok: true };
});
route('GET', '/api/runs/:id/files', (_c, [id]) => runFiles(Number(id)));
route('GET', '/api/runs/:id/files/:name', async ({ res }, [id, name]) => {
  if (!/^\d+$/.test(id) || !/^[\w.-]+$/.test(name)) throw new HttpError(400, 'Bad file');
  const file = join(env.paths.logs, 'runs', id, name);
  if (!existsSync(file)) throw new HttpError(404, 'File not found');
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(await readFile(file));
  return undefined;
});
route('GET', '/api/runs/:id/live', ({ url }, [id]) => {
  if (!/^\d+$/.test(id)) throw new HttpError(400, 'Bad run');
  return liveOutput(join(env.paths.logs, 'runs', id), Math.max(Number(url.searchParams.get('after')) || 0, 0));
});
route('POST', '/api/runs/:id/kill', ({ user }, [id]) => {
  const killed = killRun(Number(id));
  audit(user, 'run.kill', id);
  return { killed };
});
route('POST', '/api/runs/delete', async ({ body, user }) => {
  const f = (await body()) as { ids?: unknown; before?: unknown; agent?: unknown; preview?: unknown };
  const ids = Array.isArray(f.ids) ? f.ids.map(Number).filter(Number.isInteger) : undefined;
  const before = typeof f.before === 'string' && !Number.isNaN(Date.parse(f.before)) ? new Date(f.before).toISOString() : undefined;
  const agent = typeof f.agent === 'string' ? agentParam(f.agent) : undefined;
  try {
    if (f.preview === true) return { count: deleteRuns({ ids, before, agent, preview: true }) };
    const deleted = deleteRuns({ ids, before, agent });
    audit(user, 'runs.delete', JSON.stringify({ ids: ids?.length, before, agent, deleted }));
    return { deleted };
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
});

route('GET', '/api/inbox', () => inboxItems());
route('POST', '/api/inbox/retry', async ({ body, user }) => {
  const b = (await body()) as { agent?: unknown; key?: unknown; dryRun?: unknown };
  const agent = agentParam(str(b.agent, 'agent'));
  const items = new Items(agent, b.dryRun === true);
  const key = str(b.key, 'key');
  const item = items.get(key);
  // A parked PR follow-up resumes with a fresh round count; a Developer card (waiting for an answer, or failed)
  // runs again on the next poll: forgetting it would drop it, as its Jira status (Blocked, In Progress) no longer
  // matches the trigger. Anything else is picked up from scratch.
  if (item?.status === 'watching') items.watch(key, { ...item.data, parked: false, rounds: 0, lastHead: undefined });
  else if (item?.status === 'waiting' || (agent === 'developer' && item?.data.project)) items.wait(key, { ...item!.data, resume: true });
  else items.forget(key);
  audit(user, 'inbox.retry', `${agent}: ${String(b.key)}`);
  wake(agent);
  return { ok: true };
});

/** An exploration finding in the inbox becomes a Jira card on its project's board (a person's call, so also in dry run). */
route('POST', '/api/inbox/card', async ({ body, user }) => {
  const b = (await body()) as { key?: unknown; dryRun?: unknown };
  try {
    const card = await createExplorationCard(str(b.key, 'key'), b.dryRun === true);
    if (card.created) audit(user, 'inbox.card', `${card.key} from ${String(b.key)}`);
    return card;
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
});

// Removing marks the item handled, so its agent does not pick it up again; deleting the row would.
route('POST', '/api/inbox/dismiss', async ({ body, user }) => {
  const list = (await body() as { items?: unknown }).items;
  if (!Array.isArray(list) || list.length === 0 || list.length > 200) throw new HttpError(400, 'items must be a list of 1 to 200');
  let removed = 0;
  for (const raw of list) {
    const it = raw as { agent?: unknown; key?: unknown; dryRun?: unknown };
    const items = new Items(agentParam(str(it.agent, 'agent')), it.dryRun === true);
    const key = str(it.key, 'key');
    const item = items.get(key);
    if (!item || !['waiting', 'human', 'watching', 'failed'].includes(item.status)) continue;
    items.done(key, { ...item.data, dismissed: true, dismissedBy: user });
    removed++;
  }
  audit(user, 'inbox.dismiss', `${removed} item(s)`);
  return { removed };
});

route('GET', '/api/findings', () => findingsOverview());
route('GET', '/api/findings/audits/:id', (_c, [id]) => {
  const detail = auditDetail(Number(id));
  if (!detail) throw new HttpError(404, 'Audit not found');
  return detail;
});
route('POST', '/api/findings/audits/:id/findings/:index/card', async ({ user }, [id, index]) => {
  if (!/^\d+$/.test(id) || !/^\d+$/.test(index)) throw new HttpError(400, 'Bad finding');
  try {
    const card = await createFindingCard(Number(id), Number(index));
    if (card.created) audit(user, 'findings.card', `${card.key} from run ${id} finding ${index}`);
    return card;
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
});

route('GET', '/api/activity', ({ url }) =>
  auditLog(Math.min(Number(url.searchParams.get('limit')) || 300, 500), Math.max(Number(url.searchParams.get('offset')) || 0, 0)),
);
route('GET', '/api/logs', () => recentLogs.slice(-300));
route('GET', '/api/assets/file', async ({ url }) => {
  const file = assetFiles().find((f) => f.name === url.searchParams.get('name'));
  if (!file) throw new HttpError(404, 'Unknown asset');
  return { name: file.name, source: file.source, path: file.path, text: await readFile(file.path, 'utf8') };
});

/** A registered project by its brain folder name: the only way to reach a vault, so no path comes from the URL. */
function brainProject(slug: string): string {
  const name = read('projects').items.map((p) => p.name).find((n) => brainSlug(n) === slug);
  if (!name) throw new HttpError(404, 'Unknown project');
  return name;
}
route('GET', '/api/brain', async () =>
  Promise.all(read('projects').items.map(async (p) => ({ project: p.name, slug: brainSlug(p.name), dir: brainDir(p.name), notes: (await listNotes(brainDir(p.name))).length }))),
);
// links: the notes each one points to with [[path]] (Obsidian wikilinks), for the graph.
route('GET', '/api/brain/:slug', async (_c, [slug]) =>
  (await listNotes(brainDir(brainProject(slug)))).map(({ body, hash: _h, ...n }) => ({ ...n, links: [...body.matchAll(/\[\[([^\]|#]+)/g)].map((m) => `${m[1].trim()}.md`) })),
);
route('GET', '/api/brain/:slug/note', async ({ url }, [slug]) => {
  const dir = brainDir(brainProject(slug));
  const path = url.searchParams.get('path');
  if (!(await listNotes(dir)).some((n) => n.path === path)) throw new HttpError(404, 'Unknown note');
  return { path, text: await readFile(join(dir, path!), 'utf8') };
});
/** The whole vault as a .tar.gz, to open in Obsidian where the folder is not mounted. */
route('GET', '/api/brain/:slug/download', ({ res }, [slug]) => {
  const dir = brainDir(brainProject(slug));
  if (!existsSync(dir)) throw new HttpError(404, 'This project has no brain yet');
  res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${slug}-brain.tar.gz"` });
  const tar = spawn('tar', ['-czf', '-', '-C', env.paths.brain, slug], { stdio: ['ignore', 'pipe', 'ignore'] });
  tar.stdout.pipe(res);
  return undefined;
});

// --- server ---

function securityHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function json(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data ?? null));
}

function serveStatic(url: URL, res: ServerResponse): void {
  const root = resolve(UI_DIR);
  let file = resolve(join(root, normalize(decodeURIComponent(url.pathname))));
  if (!file.startsWith(root)) return json(res, 404, { error: 'Not found' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA routes
  if (!existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('UI not built. Run `npm run build:ui`.');
    return;
  }
  const immutable = file.includes(`${join(root, 'assets')}`);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  securityHeaders(res);
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') return void res.end('ok');
  if (!url.pathname.startsWith('/api/')) return serveStatic(url, res);

  const mutating = req.method !== 'GET' && req.method !== 'HEAD';
  if (mutating && req.headers[CSRF_HEADER] !== '1') return json(res, 403, { error: 'Missing CSRF header' });

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress ?? '?';
    if (rateLimited(ip)) return json(res, 429, { error: 'Too many attempts, wait a minute' });
    const { username, password } = (await readBody(req)) as { username?: unknown; password?: unknown };
    const ok =
      typeof username === 'string' && typeof password === 'string' &&
      safeEqual(username, env.adminUsername) && safeEqual(password, env.adminPassword);
    if (!ok) {
      audit(String(username ?? '?').slice(0, 60), 'login.failed', ip);
      return json(res, 401, { error: 'Invalid username or password' });
    }
    audit(env.adminUsername, 'login', ip);
    res.setHeader('Set-Cookie', sessionCookie(req, signSession(env.secretKey, env.adminUsername), 12 * 3600));
    return json(res, 200, { user: env.adminUsername });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return json(res, 200, { ok: true });
  }

  const user = verifySession(env.secretKey, cookie(req, COOKIE));
  if (!user || user !== env.adminUsername) return json(res, 401, { error: 'Not logged in' });

  for (const r of routes) {
    const m = r.method === req.method ? url.pathname.match(r.pattern) : null;
    if (!m) continue;
    try {
      const out = await r.handler({ req, res, url, user, body: () => readBody(req) }, m.slice(1).map(decodeURIComponent));
      if (out !== undefined) json(res, 200, out);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log('api error:', (err as Error).stack ?? String(err));
      json(res, status, { error: status === 500 ? 'Internal error' : (err as Error).message });
    }
    return;
  }
  json(res, 404, { error: 'Not found' });
}

export function startServer(): void {
  createServer((req, res) => {
    handle(req, res).catch((err) => {
      log('server error:', (err as Error).message);
      json(res, err instanceof HttpError ? err.status : 500, { error: err instanceof HttpError ? err.message : 'Internal error' });
    });
  }).listen(env.port, () => log(`admin UI on port ${env.port}`));
}
