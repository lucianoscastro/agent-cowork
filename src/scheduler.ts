import { pollApprover } from './agents/approver.ts';
import { pollDependabot } from './agents/dependabot.ts';
import { pollDeveloper } from './agents/developer.ts';
import { pollAuditor } from './agents/auditor.ts';
import { pollSentinel } from './agents/sentinel.ts';
import { pollDocumenter } from './agents/documenter.ts';
import { AGENTS, agentStatus, forceAgent, isForced } from './agents/status.ts';
import { type AgentId, read } from './config.ts';
import { applyGithubEnv } from './integrations/github.ts';
import { log } from './sh.ts';

const POLLERS: Record<AgentId, () => Promise<void>> = {
  approver: pollApprover,
  dependabot: pollDependabot,
  developer: pollDeveloper,
  auditor: pollAuditor,
  sentinel: pollSentinel,
  documenter: pollDocumenter,
};

export const lastPoll: Partial<Record<AgentId, string>> = {};
/** The last poll failure per agent (cleared by a successful poll), shown on the overview. */
export const lastError: Partial<Record<AgentId, { at: string; message: string }>> = {};
const wakers = new Map<AgentId, () => void>();
const busy = new Set<AgentId>();
// A wake that arrives mid-poll (e.g. right after a config change) must not be lost: poll again after.
const wakeRequested = new Set<AgentId>();

/** Ends the current sleep of an agent's loop so it polls right away (or right after the current poll). */
export function wake(agent: AgentId): void {
  if (busy.has(agent)) wakeRequested.add(agent);
  else wakers.get(agent)?.();
}

export function isPolling(agent: AgentId): boolean {
  return busy.has(agent);
}

/** One independent loop per agent: a long card never delays a review. Config is re-read every cycle. */
// ponytail: polling, not webhooks; a new item waits up to one interval plus the current batch.
export function startScheduler(): void {
  for (const agent of AGENTS) void loop(agent);
}

async function loop(agent: AgentId): Promise<never> {
  for (;;) {
    const status = agentStatus(agent);
    if (status.on) {
      busy.add(agent);
      applyGithubEnv();
      // The poll takes the Run now request; if it fails (GitHub or Jira down), the next poll gets it back.
      const forced = isForced(agent);
      try {
        await POLLERS[agent]();
        delete lastError[agent];
      } catch (err) {
        if (forced) forceAgent(agent);
        lastError[agent] = { at: new Date().toISOString(), message: (err as Error).message.slice(0, 500) };
        log(`${agent} poll failed:`, (err as Error).message);
      }
      busy.delete(agent);
      lastPoll[agent] = new Date().toISOString();
    }
    if (wakeRequested.delete(agent)) continue;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, read('general').pollSeconds * 1000);
      wakers.set(agent, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
