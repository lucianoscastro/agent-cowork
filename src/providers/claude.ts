import { SECRETS } from '../config.ts';
import { getSecret } from '../db.ts';
import { env } from '../env.ts';
import { safeEnv } from '../sh.ts';
import type { ProviderRequest, ProviderResult } from './index.ts';
import { authMethod } from './index.ts';
import { claudeLimits, recordLimits } from './limits.ts';
import { jsonLines, spawnStream } from './process.ts';

// Shell commands for moving around (`cd x && ls`): one command outside the list denies the whole compound line.
// Claude Code itself runs simple readers (cat, head, grep) inside the working directory and applies NO_READ to
// them (checked: `cd /proc && cat self/status` is denied). Left out on purpose: commands that can write a file
// (sort -o, tree -o) or run one (find -exec, rg --pre, git grep -O), git branch (-D), anything on the network.
const READ_ONLY_SHELL = ['cd', 'ls', 'wc', 'git diff', 'git log', 'git show', 'git status', 'git ls-files', 'git rev-parse', 'git blame'];
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', ...READ_ONLY_SHELL.map((c) => `Bash(${c}:*)`), 'Skill'];
const READ_ONLY_HINT =
  'Read-only shell: cd, ls, wc, read-only git commands (diff, log, show, status, ls-files, rev-parse, blame) and simple readers (cat, head, grep) inside the checkout. Paths outside it, find, and anything that writes, installs or reaches the network are denied. Prefer the Read, Grep and Glob tools.';
/** Never readable by the model: process environments (the runtime's own credential) and the platform's data. */
const NO_READ = () => ['/proc', env.paths.auth, env.paths.db, env.backupsDir].map((dir) => `Read(/${dir}/**)`);
// The container is the sandbox for write mode: the agent needs a shell to build and test.
const WRITE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'Skill', 'Task', 'Agent'];

function credentials(): NodeJS.ProcessEnv {
  return authMethod('claude') === 'api-key'
    ? { ANTHROPIC_API_KEY: getSecret(SECRETS.providerApiKey('claude')) }
    : { CLAUDE_CODE_OAUTH_TOKEN: getSecret(SECRETS.claudeOauthToken) };
}

/**
 * The run's own result. Background subagents that finish after it append more `result` events (with an
 * `origin` of task-notification) that carry no answer and would hide a limit error. Exported for tests.
 */
export const mainResult = (events: Record<string, unknown>[]) =>
  events.findLast((e) => e.type === 'result' && (e.origin as { kind?: string } | undefined)?.kind !== 'task-notification');

export async function runClaude<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--json-schema', JSON.stringify(req.schema),
    '--permission-mode', 'dontAsk',
    // Ignore hooks/MCP servers committed in the checked-out repo: they would run code from an untrusted branch.
    '--setting-sources', 'user',
    '--strict-mcp-config',
    ...(req.model ? ['--model', req.model] : []),
    ...(req.subagents ? ['--agents', JSON.stringify(req.subagents)] : []),
    // Browser tools come only from the platform's own config (strict mode ignores every other MCP source).
    ...(req.browser ? ['--mcp-config', req.browser] : []),
    '--allowedTools', ...(req.mode === 'write' ? WRITE_TOOLS : READ_ONLY_TOOLS), ...(req.browser ? ['mcp__playwright'] : []),
    // git diff/log/show can write a file (--output) or read any file (--no-index), wherever the flag goes.
    '--disallowedTools', ...NO_READ(), 'Bash(git * --output*)', 'Bash(git * --no-index*)', 'Bash(git diff --no-index:*)',
    ...(req.mode === 'write' ? [] : ['--append-system-prompt', READ_ONLY_HINT]),
  ];
  const out = await spawnStream('claude', args, {
    cwd: req.cwd,
    env: safeEnv(credentials()),
    input: req.prompt,
    signal: req.run.signal,
    transcript: req.run.transcript(req.label),
  });
  const events = jsonLines(out.stdout);
  const limits = claudeLimits(events);
  if (limits) recordLimits('claude', limits);
  const result = mainResult(events) as
    | { is_error?: boolean; result?: string; structured_output?: T; total_cost_usd?: number; usage?: Record<string, number> }
    | undefined;
  if (!result) throw new Error(`claude exited ${out.code} without a result: ${out.stderr.slice(-500)}`);
  if (result.is_error || result.structured_output === undefined) {
    throw new Error(`claude: ${result.result || 'no structured output'}`.slice(0, 1000));
  }
  return {
    output: result.structured_output,
    usage: {
      inputTokens: result.usage?.input_tokens,
      outputTokens: result.usage?.output_tokens,
      cacheReadTokens: result.usage?.cache_read_input_tokens,
      cacheWriteTokens: result.usage?.cache_creation_input_tokens,
      costUsd: result.total_cost_usd,
    },
  };
}
