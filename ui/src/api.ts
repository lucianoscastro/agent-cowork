export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const CHANGED = 'agentcowork:changed';

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      // Required by the server on every write (CSRF protection).
      ...(method !== 'GET' ? { 'x-agentcowork': '1' } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && path !== '/login') onUnauthorized();
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? String(data));
  // A write may change what the shell shows (the Work count, the live bar): it refreshes on this event.
  if (method !== 'GET') window.dispatchEvent(new Event(CHANGED));
  return data as T;
}

export type AgentId = 'approver' | 'dependabot' | 'developer' | 'auditor' | 'sentinel' | 'documenter';
export type AuditCategory = 'security' | 'privacy' | 'performance' | 'reliability' | 'tests' | 'code-health' | 'dependencies' | 'accessibility';
export const AUDIT_CATEGORIES: { id: AuditCategory; name: string; skill: string; scope: string }[] = [
  { id: 'security', name: 'Security', skill: 'check-pre-deploy', scope: 'Tenant isolation, authorization, IDOR, secrets, injection, XSS, uploads (20 checks)' },
  { id: 'privacy', name: 'Privacy', skill: 'check-privacy', scope: 'Personal data under LGPD/GDPR: logs, masking, retention, data subject rights, sharing' },
  { id: 'performance', name: 'Performance', skill: 'check-performance', scope: 'N+1 and unbounded queries, serial calls, blocking work, caching, bundle size, re-renders' },
  { id: 'reliability', name: 'Reliability', skill: 'check-reliability', scope: 'Swallowed errors, timeouts, idempotency, transactions, health checks, shutdown' },
  { id: 'tests', name: 'Test gaps', skill: 'check-test-gaps', scope: 'Critical rules without tests, tests that cannot fail, flaky and skipped tests' },
  { id: 'code-health', name: 'Code health', skill: 'check-code-health', scope: 'Duplicated rules, dead code, oversized code, layering violations, cycles' },
  { id: 'dependencies', name: 'Dependencies', skill: 'check-dependencies', scope: 'Vulnerable, end-of-life and outdated packages, licenses, lockfiles (runs the package managers)' },
  { id: 'accessibility', name: 'Accessibility', skill: 'check-accessibility', scope: 'WCAG 2.2 AA on React repositories: labels, keyboard, focus, dialogs, contrast' },
];
export type ProviderId = 'claude' | 'codex' | 'agy';
export type ModelChoice = { provider: ProviderId; model: string };

export type Run = {
  id: number;
  agent: AgentId;
  item: string;
  url: string | null;
  title: string | null;
  status: 'running' | 'done' | 'failed' | 'parked' | 'waiting' | 'killed';
  stage: string | null;
  dry_run: number;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  error: string | null;
  /** All tokens of the run's model calls (fresh input, cache and output). */
  tokens?: number;
  /** Claude's estimate at API prices; 0 when no runtime reported one. */
  cost?: number;
};
export type RunDetail = Run & { events: { at: string; kind: string; message: string; data: unknown }[] };

export type Overview = {
  instance: string;
  /** Agents out of dry run: they write to GitHub and Jira. */
  live: AgentId[];
  agents: { id: AgentId; on: boolean; reason?: string; paused?: boolean; polling: boolean; lastPoll: string | null; lastError: { at: string; message: string } | null }[];
  running: Run[];
  recent: Run[];
  inbox: number;
  following: number;
};

export type Stack = 'node' | 'react' | 'dotnet';
export const STACK_NAMES: Record<Stack, string> = { node: 'Node.js', react: 'React', dotnet: '.NET' };
export type SuiteSetup = {
  framework: 'playwright' | 'cucumber' | 'cypress';
  workdir: string;
  setupCommands: string[];
  runCommand: string;
  isolateArgs: string;
  reportFormat: 'playwright-json' | 'cucumber-json' | 'junit';
  reportArgs: string;
  reportEnv: string[];
  urlVars: string[];
  secretVars: string[];
};
export type ResolvedSuite = SuiteSetup & { repo: string; branch: string };
export type RepoEnvironment = { baseUrl: string; branch?: string; e2e: boolean; explore: boolean };
export type TestEnvironment = { repos: Record<string, RepoEnvironment> };
export type Project = {
  name: string;
  boardId?: string;
  baseBranch?: string;
  repos: Record<string, { repo: string; stack: Stack; verify?: string[] }>;
  environment?: TestEnvironment;
};

/** Each agent goes live on its own; in dry run it writes nothing to GitHub or Jira. */
type Shadow = { dryRun: boolean };

export type NotifyEvent = 'inbox' | 'pr' | 'limit' | 'merged';
export const NOTIFY_EVENTS: { id: NotifyEvent; label: string }[] = [
  { id: 'inbox', label: 'Something needs a person (Inbox)' },
  { id: 'pr', label: 'An agent opened or updated pull requests (Developer, Documenter)' },
  { id: 'limit', label: 'A provider paused at its usage limit' },
  { id: 'merged', label: 'Dependabot merged a pull request' },
];

export type Sections = {
  general: { language: 'en-US' | 'pt-BR' | 'es-ES'; pollSeconds: number; fallback: boolean };
  github: { gitName: string; gitEmail: string };
  jira: { url: string; email: string };
  notifications: { uiUrl: string; events: Record<NotifyEvent, boolean> };
  'providers.claude': { authMethod: 'api-key' | 'account'; defaultModel: string };
  'providers.codex': { authMethod: 'api-key' | 'account'; defaultModel: string };
  'providers.agy': { authMethod: 'api-key' | 'account'; defaultModel: string };
  'agents.approver': Shadow & ModelChoice & { enabled: boolean; concurrency: number };
  'agents.dependabot': Shadow & ModelChoice & {
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
  'agents.documenter': Shadow & ModelChoice & { enabled: boolean; intervalDays: number; concurrency: number; folder: string };
  'agents.auditor': Shadow & { enabled: boolean; concurrency: number; jiraIssueType: string; categories: Record<AuditCategory, ModelChoice & { enabled: boolean; intervalDays: number }> };
  'agents.sentinel': Shadow & ModelChoice & {
    enabled: boolean;
    nightlyAt: string;
    retries: number;
    maxInvestigations: number;
    exploreMinutes: number;
    exploreEveryHours: number;
    bugIssueType: string;
  };
  'agents.developer': Shadow & {
    enabled: boolean;
    triggerJql: string;
    startTransition: string;
    blockedTransition: string;
    doneTransition: string;
    mergedTransition: string;
    draft: boolean;
    baseBranch: string;
    lead: ModelChoice;
    coderModel: string;
    testerModel: string;
    reviewer: ModelChoice & { enabled: boolean };
    secondReviewer: ModelChoice & { enabled: boolean };
    limits: { planReview: number; verify: number; diffReview: number; runMinutes: number; followUp: number };
    concurrency: number;
  };
  projects: { items: Project[] };
  stacks: Record<Stack, string[]>;
};

export type SettingsResponse = {
  sections: Sections;
  secrets: Record<string, boolean>;
  /** By project, then repository: the names of its stored test variables. */
  testVars: Record<string, Record<string, string[]>>;
  providers: Record<ProviderId, { ready: boolean; reason?: string; authMethod: string; account?: AccountInfo }>;
  agents: Record<AgentId, { on: boolean; reason?: string; paused?: boolean }>;
  assets: {
    instructions: { source: string; path: string };
    skills: { source: string; path: string };
    files: AssetFile[];
  };
};

export type AssetFile = { name: string; group: 'instructions' | 'prompts' | 'skills'; source: string };

export type AccountInfo = { email?: string; name?: string; plan?: string; organization?: string; untilLabel?: string; since?: string; until?: string; keyHint?: string; note?: string };

export type LoginState = {
  provider: ProviderId;
  status: 'starting' | 'paste-code' | 'finishing' | 'done' | 'failed';
  url?: string;
  paste?: 'code' | 'callback-url';
  message?: string;
};

export type InboxItem = {
  key: string;
  agent: AgentId;
  dryRun: boolean;
  status: 'waiting' | 'human' | 'watching' | 'failed';
  attempts: number;
  data: Record<string, unknown>;
  updatedAt: string;
};

export const saveSection = <K extends keyof Sections>(key: K, value: Sections[K]) =>
  api<Sections[K]>(`/settings/${key}`, { method: 'PUT', body: value });
export const setSecret = (name: string, value: string) => api(`/secrets/${name}`, { method: 'PUT', body: { value } });
export const clearSecret = (name: string) => api(`/secrets/${name}`, { method: 'DELETE' });
