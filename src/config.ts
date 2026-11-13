import { getSetting, putSetting } from './db.ts';

export const PROVIDERS = ['claude', 'codex', 'agy'] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export type AuthMethod = 'api-key' | 'account';
export type AgentId = 'approver' | 'dependabot' | 'developer' | 'auditor' | 'sentinel' | 'documenter';
/** Each agent goes live on its own: in dry run (shadow mode) it reads and decides but writes nothing to GitHub or Jira. */
type Shadow = { dryRun: boolean };

/** What the auditor reviews; each category has its own skill, model and interval (agents/auditor.ts). */
export const AUDIT_CATEGORIES = ['security', 'privacy', 'performance', 'reliability', 'tests', 'code-health', 'dependencies', 'accessibility'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export type AuditCategorySettings = ModelChoice & { enabled: boolean; intervalDays: number };
export type ModelChoice = { provider: ProviderId; model: string };
/** An optional role: off, nothing runs for it. */
export type Reviewer = ModelChoice & { enabled: boolean };

/** A repository of a project and the commands that must pass before a PR is opened (run from its root). */
/** Stacks with default verify commands (Settings → General); each repository names its own. */
export const STACKS = ['node', 'react', 'dotnet'] as const;
export type Stack = (typeof STACKS)[number];

/** `verify` is a per-repository override; empty runs the stack's defaults. */
export type ProjectRepo = { repo: string; stack: Stack; verify?: string[] };

/** A system on the board: which cards belong to it and the repositories (by role) a card may change. */
/**
 * A project's test environment, for the Sentinel agent: per repository, the URL it is deployed at, its
 * branch, and whether to run its end-to-end suite and to explore it. The suite is detected on every run
 * (agents/suite.ts), so it follows the code. The variables the tests need (users, tokens) are one JSON
 * object per repository stored encrypted under `env.<project>.<owner/name>`: the test commands get them, the browser gets them masked,
 * a model never sees a value.
 */
export type RepoEnvironment = {
  baseUrl: string;
  branch?: string;
  e2e: boolean;
  /** Explore what changed on the branch, every few hours. */
  explore: boolean;
};
export type TestEnvironment = {
  /** By repository (owner/name); only repositories with a URL and a check on are kept. */
  repos: Record<string, RepoEnvironment>;
};

/** A URL's short name ("staging.acme.com"). */
export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * A database the agents may use through the platform's tools (databases.ts). Its connection URL is a secret
 * under `db.<project>.<name>` that no model ever sees. `write` lets the steps that change code validate
 * scripts against it, always rolled back.
 */
export type ProjectDatabase = { name: string; access: 'read' | 'write'; description: string };

export type Project = {
  name: string;
  environment?: TestEnvironment;
  databases?: ProjectDatabase[];
  // The Jira board whose cards this project works on (the number in the board URL).
  boardId?: string;
  baseBranch?: string;
  repos: Record<string, ProjectRepo>;
};

/** Languages agent output can be written in; the value is what the prompts receive as {{language}}. */
export const LANGUAGES = { 'en-US': 'English (en-US)', 'pt-BR': 'Brazilian Portuguese (pt-BR)', 'es-ES': 'Spanish (es-ES)' } as const;
export type Language = keyof typeof LANGUAGES;
const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[];

/** The language name agents are told to write in. */
export const outputLanguage = (): string => LANGUAGES[read('general').language] ?? LANGUAGES['en-US'];

export type Settings = {
  // fallback: a call that hits a usage limit moves on to the next provider (see fallbackOrder).
  general: { language: Language; pollSeconds: number; fallback: boolean };
  github: { gitName: string; gitEmail: string };
  jira: { url: string; email: string };
  // What the webhook (a secret) is told about, and the UI's address for links in the messages (optional).
  notifications: { uiUrl: string; events: Record<NotifyEvent, boolean> };
  'providers.claude': { authMethod: AuthMethod; defaultModel: string };
  'providers.codex': { authMethod: AuthMethod; defaultModel: string };
  'providers.agy': { authMethod: AuthMethod; defaultModel: string };
  'agents.approver': ModelChoice & Shadow & { enabled: boolean; concurrency: number };
  'agents.dependabot': ModelChoice & Shadow & {
    enabled: boolean;
    mergeMethod: 'squash' | 'merge' | 'rebase';
    cooldownDays: number;
    allowedUpdates: ('patch' | 'minor')[];
    concurrency: number;
    /** CI failing on an up-to-date PR: a Jira card for the Developer agent (type, labels, status to move it to). */
    failingCiCard: boolean;
    cardIssueType: string;
    cardLabels: string[];
    cardTransition: string;
  };
  // jiraIssueType: the type of the cards created from findings (Findings page).
  // Architecture and business-rule docs per repository, as a PR: every N days when the base branch moved.
  'agents.documenter': Shadow & ModelChoice & { enabled: boolean; intervalDays: number; concurrency: number; folder: string };
  'agents.auditor': Shadow & { enabled: boolean; concurrency: number; jiraIssueType: string; categories: Record<AuditCategory, AuditCategorySettings> };
  // Runs at `nightlyAt` (UTC, HH:MM) once a day per project with a test environment.
  'agents.sentinel': ModelChoice & Shadow & {
    enabled: boolean;
    nightlyAt: string;
    retries: number;
    maxInvestigations: number;
    /** Minutes for one exploration session. */
    exploreMinutes: number;
    /** Hours between explorations of a repository (only when its branch moved). */
    exploreEveryHours: number;
    bugIssueType: string;
  };
  'agents.developer': Shadow & {
    enabled: boolean;
    triggerJql: string;
    startTransition: string;
    blockedTransition: string;
    doneTransition: string;
    // Where the card goes when its PRs are merged (the agent stops following them then).
    mergedTransition: string;
    draft: boolean;
    baseBranch: string;
    lead: ModelChoice;
    coderModel: string;
    testerModel: string;
    // Independent reviewers of the plan and the diff: none, one or both; with both, each must approve.
    reviewer: Reviewer;
    secondReviewer: Reviewer;
    // followUp: rounds on an open PR (red pipeline or new comments) without getting it green before a human is asked.
    limits: { planReview: number; verify: number; diffReview: number; runMinutes: number; followUp: number };
    concurrency: number;
  };
  projects: { items: Project[] };
  stacks: Record<Stack, string[]>;
};

export type SectionKey = keyof Settings;

/** inbox: something needs a person; pr: the Developer opened PRs; limit: a provider paused at its usage limit; merged: Dependabot merged a PR. */
export const NOTIFY_EVENTS = ['inbox', 'pr', 'limit', 'merged'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export const DEFAULTS: Settings = {
  general: { language: 'en-US', pollSeconds: 300, fallback: true },
  github: { gitName: 'agentCowork', gitEmail: '' },
  jira: { url: '', email: '' },
  notifications: { uiUrl: '', events: { inbox: true, pr: true, limit: true, merged: false } },
  'providers.claude': { authMethod: 'account', defaultModel: 'sonnet' },
  'providers.codex': { authMethod: 'account', defaultModel: '' },
  'providers.agy': { authMethod: 'account', defaultModel: '' },
  'agents.approver': { enabled: false, dryRun: true, provider: 'claude', model: '', concurrency: 2 },
  'agents.dependabot': {
    enabled: false,
    dryRun: true,
    provider: 'claude',
    model: 'haiku',
    mergeMethod: 'squash',
    cooldownDays: 3,
    allowedUpdates: ['patch', 'minor'],
    concurrency: 1,
    // agent-ready matches the Developer's default trigger.
    failingCiCard: true,
    cardIssueType: 'Task',
    cardLabels: ['agent-ready'],
    cardTransition: '',
  },
  'agents.documenter': { enabled: false, dryRun: true, provider: 'claude', model: '', intervalDays: 7, concurrency: 1, folder: '.agents' },
  'agents.auditor': {
    enabled: false,
    dryRun: true,
    concurrency: 1,
    jiraIssueType: 'Task',
    categories: {
      security: { enabled: true, provider: 'claude', model: 'opus', intervalDays: 7 },
      privacy: { enabled: false, provider: 'claude', model: 'opus', intervalDays: 7 },
      performance: { enabled: false, provider: 'claude', model: 'sonnet', intervalDays: 14 },
      reliability: { enabled: false, provider: 'claude', model: 'sonnet', intervalDays: 14 },
      tests: { enabled: false, provider: 'claude', model: 'sonnet', intervalDays: 30 },
      'code-health': { enabled: false, provider: 'claude', model: 'sonnet', intervalDays: 30 },
      dependencies: { enabled: false, provider: 'claude', model: 'sonnet', intervalDays: 7 },
      accessibility: { enabled: false, provider: 'claude', model: 'sonnet', intervalDays: 30 },
    },
  },
  'agents.sentinel': {
    enabled: false,
    dryRun: true,
    provider: 'claude',
    model: 'sonnet',
    nightlyAt: '09:00',
    retries: 2,
    maxInvestigations: 5,
    exploreMinutes: 20,
    exploreEveryHours: 6,
    bugIssueType: 'Bug',
  },
  'agents.developer': {
    enabled: false,
    dryRun: true,
    triggerJql: 'labels = "agent-ready" AND statusCategory != Done',
    startTransition: 'In Progress',
    blockedTransition: 'Blocked',
    doneTransition: '',
    mergedTransition: '',
    draft: true,
    baseBranch: '',
    lead: { provider: 'claude', model: 'opus' },
    coderModel: 'sonnet',
    testerModel: 'sonnet',
    reviewer: { enabled: true, provider: 'codex', model: '' },
    secondReviewer: { enabled: false, provider: 'agy', model: '' },
    limits: { planReview: 2, verify: 3, diffReview: 3, runMinutes: 90, followUp: 3 },
    concurrency: 1,
  },
  projects: { items: [] },
  stacks: {
    node: ['pnpm install --frozen-lockfile', 'pnpm build', 'pnpm test'],
    react: ['pnpm install --frozen-lockfile', 'pnpm build', 'pnpm test'],
    dotnet: ['dotnet restore', 'dotnet build --configuration Release --no-restore', 'dotnet test --configuration Release --no-build'],
  },
};

/** Every repository of every project, once each: what the Dependabot agent watches. */
export function projectRepos(): ProjectRepo[] {
  const all = read('projects').items.flatMap((p) => Object.values(p.repos));
  return [...new Map(all.map((r) => [r.repo, r])).values()];
}

/** What the platform runs to verify a repository: its own commands, or its stack's defaults. */
export const verifyCommands = (r: ProjectRepo): string[] => (r.verify?.length ? r.verify : read('stacks')[r.stack]);

export const SECRETS = {
  githubToken: 'github.token',
  jiraToken: 'jira.token',
  providerApiKey: (id: ProviderId) => `providers.${id}.apiKey`,
  claudeOauthToken: 'providers.claude.oauthToken',
  // The webhook URL is a secret: Slack, Discord and Teams URLs carry their own token.
  webhookUrl: 'notifications.webhookUrl',
} as const;

export function read<K extends SectionKey>(key: K): Settings[K] {
  const value = getSetting(key, DEFAULTS[key]);
  // Categories added in later versions get their defaults in sections saved before them.
  if (key === 'agents.auditor') {
    const auditor = value as Settings['agents.auditor'];
    const defaults = DEFAULTS['agents.auditor'].categories;
    const categories = Object.fromEntries(AUDIT_CATEGORIES.map((cat) => [cat, { ...defaults[cat], ...auditor.categories?.[cat] }]));
    return { ...auditor, categories } as Settings[K];
  }
  // Limits added in later versions get their default in sections saved before them.
  if (key === 'agents.developer') {
    const dev = value as Settings['agents.developer'];
    const d = DEFAULTS['agents.developer'];
    return {
      ...d,
      ...dev,
      limits: { ...d.limits, ...dev.limits },
      reviewer: { ...d.reviewer, ...dev.reviewer },
      secondReviewer: { ...d.secondReviewer, ...dev.secondReviewer },
    } as Settings[K];
  }
  // Fields added in later versions get their default in sections saved before them.
  return { ...DEFAULTS[key], ...value };
}

/** Validates a section sent by the UI and stores it; throws with a readable message when invalid. */
export function write<K extends SectionKey>(key: K, value: unknown): Settings[K] {
  if (!(key in DEFAULTS)) throw new Error(`Unknown settings section "${key}"`);
  const valid = validate(key, value);
  putSetting(key, valid);
  return valid;
}

// --- validation (trust boundary: everything below comes from the browser) ---

type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${where} must be an object`);
  return v as Obj;
}
function str(o: Obj, k: string, where: string, { required = false, max = 2000 } = {}): string {
  const v = o[k] ?? '';
  if (typeof v !== 'string') throw new Error(`${where}.${k} must be text`);
  if (required && !v.trim()) throw new Error(`${where}.${k} is required`);
  if (v.length > max) throw new Error(`${where}.${k} is too long`);
  return v.trim();
}
function bool(o: Obj, k: string, where: string): boolean {
  if (typeof o[k] !== 'boolean') throw new Error(`${where}.${k} must be true or false`);
  return o[k] as boolean;
}
function int(o: Obj, k: string, where: string, min: number, max: number): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${where}.${k} must be a whole number from ${min} to ${max}`);
  }
  return v;
}
function oneOf<T extends string>(o: Obj, k: string, where: string, values: readonly T[]): T {
  if (!values.includes(o[k] as T)) throw new Error(`${where}.${k} must be one of: ${values.join(', ')}`);
  return o[k] as T;
}
function strings(o: Obj, k: string, where: string, pattern?: RegExp): string[] {
  const v = o[k] ?? [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new Error(`${where}.${k} must be a list of text`);
  const list = (v as string[]).map((s) => s.trim()).filter(Boolean);
  const bad = pattern && list.find((s) => !pattern.test(s));
  if (bad) throw new Error(`${where}.${k}: "${bad}" is not valid`);
  return list;
}
function choice(v: unknown, where: string): ModelChoice {
  const o = obj(v, where);
  return { provider: oneOf(o, 'provider', where, PROVIDERS), model: str(o, 'model', where, { max: 200 }) };
}

function reviewer(v: unknown, where: string): Reviewer {
  return { enabled: bool(obj(v, where), 'enabled', where), ...choice(v, where) };
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

/** A repository's folder in the developer's workspace: its name without the owner (acme/web → web). */
export const repoFolder = (repo: string): string => repo.slice(repo.indexOf('/') + 1);

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Variables the platform sets itself; a secret with one of these names is refused. */
const RESERVED_ENV = new Set(['PATH', 'HOME', 'CI', 'GH_TOKEN', 'GITHUB_TOKEN']);

function validateEnvironment(v: unknown, where: string, repos: Record<string, unknown>): TestEnvironment {
  const o = obj(v, where);
  const known = new Set(Object.values(repos).map((r) => (r as { repo?: unknown }).repo));
  const byRepo = obj(o.repos ?? {}, `${where}.repos`);
  const env: TestEnvironment = { repos: {} };
  for (const [repo, value] of Object.entries(byRepo)) {
    const w = `${where}.repos.${repo}`;
    if (!known.has(repo)) throw new Error(`${w} is not one of the project's repositories`);
    const r = obj(value, w);
    const e2e = r.e2e === true;
    const explore = r.explore === true;
    if (!e2e && !explore) continue; // not tested
    const baseUrl = str(r, 'baseUrl', w, { max: 300 }).replace(/\/$/, '');
    if (!/^https?:\/\/[\w.-]+(:\d+)?(\/.*)?$/.test(baseUrl)) throw new Error(`${w}.baseUrl must be an http(s) URL`);
    const branch = str(r, 'branch', w, { max: 200 });
    env.repos[repo] = { baseUrl, ...(branch ? { branch } : {}), e2e, explore };
  }
  return env;
}

/** Where a project database's connection URL is stored. */
export const dbSecretName = (project: string, name: string) => `db.${project}.${name}`;

const DB_NAME = /^[a-z][a-z0-9_-]{0,39}$/;

function validateDatabases(v: unknown, where: string): ProjectDatabase[] {
  if (!Array.isArray(v) || v.length > 10) throw new Error(`${where} must be a list of at most 10 databases`);
  const names = new Set<string>();
  return v.map((d, k) => {
    const w = `${where}[${k}]`;
    const o = obj(d, w);
    const name = str(o, 'name', w, { required: true, max: 40 });
    if (!DB_NAME.test(name)) throw new Error(`${w}.name: lowercase letters, digits, - and _, starting with a letter`);
    if (names.has(name)) throw new Error(`${where}: two databases are named "${name}"`);
    names.add(name);
    return { name, access: oneOf(o, 'access', w, ['read', 'write'] as const), description: str(o, 'description', w, { max: 500 }) };
  });
}

/** Where a repository's test variables (one JSON object) are stored. */
export const envSecretName = (project: string, repo: string) => `env.${project}.${repo}`;

/**
 * A repository's test variables from their JSON: an object of variables the platform does not set itself; a
 * nested object (several test users) becomes its JSON text.
 */
export function parseTestVars(json: string): Record<string, string> {
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    throw new Error('The test variables must be valid JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('The test variables must be a JSON object: { "NAME": "value" }');
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => {
      if (!ENV_NAME.test(k) || RESERVED_ENV.has(k)) throw new Error(`${k}: use an environment variable name the platform does not set (like TEST_PASSWORD)`);
      if (v === null || v === undefined) throw new Error(`${k} has no value`);
      return [k, typeof v === 'object' ? JSON.stringify(v) : String(v)];
    }),
  );
}

export function validateProjects(v: unknown): Project[] {
  if (!Array.isArray(v)) throw new Error('projects must be a list');
  const projects = v.map((p, i) => {
    const where = `projects[${i}]`;
    const o = obj(p, where);
    const repos = obj(o.repos, `${where}.repos`);
    if (Object.keys(repos).length === 0) throw new Error(`${where} needs at least one repository`);
    const out: Project = { name: str(o, 'name', where, { required: true, max: 100 }), repos: {} };
    const boardId = str(o, 'boardId', where, { max: 20 });
    if (boardId && !/^\d+$/.test(boardId)) throw new Error(`${where}.boardId must be the number in the board URL`);
    if (boardId) out.boardId = boardId;
    const baseBranch = str(o, 'baseBranch', where, { max: 200 });
    if (baseBranch) out.baseBranch = baseBranch;
    if (o.environment !== undefined && o.environment !== null) {
      // A test environment exists when some repository is checked for testing.
      const env = validateEnvironment(o.environment, `${where}.environment`, repos);
      if (Object.keys(env.repos).length) out.environment = env;
    }
    const databases = validateDatabases(o.databases ?? [], `${where}.databases`);
    if (databases.length) out.databases = databases;
    // Stored by folder name, whatever key the client sent: the folder is always the repository's name.
    for (const r of Object.values(repos)) {
      const ro = obj(r, `${where}.repos`);
      const repo = str(ro, 'repo', `${where}.repos`, { required: true, max: 200 });
      const folder = repoFolder(repo);
      if (!REPO.test(repo) || folder === '.' || folder === '..') throw new Error(`${where}.repos: "${repo}" must look like owner/name`);
      if (out.repos[folder]) throw new Error(`${where}: two repositories are named "${folder}"; their folders would collide`);
      const stack = oneOf(ro, 'stack', `${where}.repos.${folder}`, STACKS);
      const verify = strings(ro, 'verify', `${where}.repos.${folder}`);
      out.repos[folder] = verify.length ? { repo, stack, verify } : { repo, stack };
    }
    return out;
  });
  // Test variables, schedules and inbox items are keyed by the name.
  const seen = new Set<string>();
  for (const p of projects) {
    const name = p.name.trim().toLowerCase();
    if (seen.has(name)) throw new Error(`Two projects are named "${p.name}": project names must be unique`);
    seen.add(name);
  }
  return projects;
}

function validate<K extends SectionKey>(key: K, value: unknown): Settings[K] {
  const o = obj(value, key);
  const out = ((): unknown => {
    switch (key) {
      case 'general':
        return {
          language: oneOf(o, 'language', key, LANGUAGE_CODES),
          pollSeconds: int(o, 'pollSeconds', key, 30, 86_400),
          fallback: o.fallback === undefined ? true : bool(o, 'fallback', key),
        };
      case 'github':
        return { gitName: str(o, 'gitName', key, { required: true, max: 100 }), gitEmail: str(o, 'gitEmail', key, { max: 200 }) };
      case 'jira': {
        const url = str(o, 'url', key, { max: 300 }).replace(/\/$/, '');
        if (url && !/^https:\/\/[\w.-]+(:\d+)?$/.test(url)) throw new Error('jira.url must look like https://your-site.atlassian.net');
        return { url, email: str(o, 'email', key, { max: 200 }) };
      }
      case 'notifications': {
        const uiUrl = str(o, 'uiUrl', key, { max: 300 }).replace(/\/$/, '');
        if (uiUrl && !/^https?:\/\/[^\s/]+/.test(uiUrl)) throw new Error('notifications.uiUrl must start with http:// or https://');
        const events = obj(o.events, `${key}.events`);
        return {
          uiUrl,
          events: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e, bool(events, e, `${key}.events`)])) as Record<NotifyEvent, boolean>,
        };
      }
      case 'providers.claude':
      case 'providers.codex':
      case 'providers.agy':
        return {
          authMethod: oneOf(o, 'authMethod', key, ['api-key', 'account'] as const),
          defaultModel: str(o, 'defaultModel', key, { max: 200 }),
        };
      case 'agents.approver':
        return { enabled: bool(o, 'enabled', key), ...choice(o, key), concurrency: int(o, 'concurrency', key, 1, 8) };
      case 'agents.dependabot':
        return {
          enabled: bool(o, 'enabled', key),
          ...choice(o, key),
          mergeMethod: oneOf(o, 'mergeMethod', key, ['squash', 'merge', 'rebase'] as const),
          cooldownDays: int(o, 'cooldownDays', key, 0, 60),
          allowedUpdates: strings(o, 'allowedUpdates', key, /^(patch|minor)$/),
          concurrency: int(o, 'concurrency', key, 1, 4),
          failingCiCard: bool(o, 'failingCiCard', key),
          cardIssueType: str(o, 'cardIssueType', key, { required: true, max: 60 }),
          cardLabels: strings(o, 'cardLabels', key, /^[\w.-]{1,60}$/),
          cardTransition: str(o, 'cardTransition', key, { max: 100 }),
        };
      case 'agents.documenter': {
        const folder = str(o, 'folder', key, { required: true, max: 100 }).replace(/^\.\/|\/+$/g, '');
        // A folder inside the repository, never its root or a path that climbs out of it.
        if (!/^[\w.-]+(\/[\w.-]+)*$/.test(folder) || folder.split('/').some((part) => part === '..' || part === '.')) {
          throw new Error(`${key}.folder must be a folder inside the repository, e.g. .agents or docs/architecture`);
        }
        return { enabled: bool(o, 'enabled', key), ...choice(o, key), intervalDays: int(o, 'intervalDays', key, 1, 365), concurrency: int(o, 'concurrency', key, 1, 4), folder };
      }
      case 'agents.auditor': {
        const categories = obj(o.categories, `${key}.categories`);
        return {
          enabled: bool(o, 'enabled', key),
          concurrency: int(o, 'concurrency', key, 1, 4),
          jiraIssueType: str(o, 'jiraIssueType', key, { required: true, max: 60 }),
          categories: Object.fromEntries(
            AUDIT_CATEGORIES.map((cat) => {
              const where = `${key}.categories.${cat}`;
              const c = obj(categories[cat], where);
              return [cat, { enabled: bool(c, 'enabled', where), ...choice(c, where), intervalDays: int(c, 'intervalDays', where, 1, 365) }];
            }),
          ),
        };
      }
      case 'agents.sentinel': {
        const nightlyAt = str(o, 'nightlyAt', key, { required: true, max: 5 });
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(nightlyAt)) throw new Error(`${key}.nightlyAt must be HH:MM (UTC)`);
        if (choice(o, key).provider !== 'claude') throw new Error(`${key}: the browser tools need Claude Code as the provider`);
        return {
          enabled: bool(o, 'enabled', key),
          ...choice(o, key),
          nightlyAt,
          retries: int(o, 'retries', key, 0, 5),
          maxInvestigations: int(o, 'maxInvestigations', key, 0, 30),
          exploreMinutes: int(o, 'exploreMinutes', key, 5, 120),
          exploreEveryHours: int(o, 'exploreEveryHours', key, 1, 168),
          bugIssueType: str(o, 'bugIssueType', key, { required: true, max: 60 }),
        };
      }
      case 'agents.developer': {
        const limits = obj(o.limits, `${key}.limits`);
        return {
          enabled: bool(o, 'enabled', key),
          triggerJql: str(o, 'triggerJql', key, { required: true }),
          startTransition: str(o, 'startTransition', key, { max: 100 }),
          blockedTransition: str(o, 'blockedTransition', key, { max: 100 }),
          doneTransition: str(o, 'doneTransition', key, { max: 100 }),
          mergedTransition: str(o, 'mergedTransition', key, { max: 100 }),
          draft: bool(o, 'draft', key),
          baseBranch: str(o, 'baseBranch', key, { max: 200 }),
          lead: choice(o.lead, `${key}.lead`),
          coderModel: str(o, 'coderModel', key, { max: 200 }),
          testerModel: str(o, 'testerModel', key, { max: 200 }),
          reviewer: reviewer(o.reviewer, `${key}.reviewer`),
          secondReviewer: reviewer(o.secondReviewer, `${key}.secondReviewer`),
          limits: {
            planReview: int(limits, 'planReview', `${key}.limits`, 0, 10),
            verify: int(limits, 'verify', `${key}.limits`, 1, 10),
            diffReview: int(limits, 'diffReview', `${key}.limits`, 0, 10),
            runMinutes: int(limits, 'runMinutes', `${key}.limits`, 5, 600),
            followUp: int(limits, 'followUp', `${key}.limits`, 1, 10),
          },
          concurrency: int(o, 'concurrency', key, 1, 4),
        };
      }
      case 'projects':
        return { items: validateProjects(o.items) };
      case 'stacks':
        return Object.fromEntries(STACKS.map((s) => [s, strings(o, s, key)]));
    }
  })();
  if (key.startsWith('agents.')) Object.assign(out as object, { dryRun: bool(o, 'dryRun', key) });
  return out as Settings[K];
}
