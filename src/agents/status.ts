import { type AgentId, AUDIT_CATEGORIES, projectRepos, read, SECRETS } from '../config.ts';
import { getSecret } from '../db.ts';
import { jiraStatus } from '../integrations/jira.ts';
import { providerStatus, routeStatus } from '../providers/index.ts';

export const AGENTS: AgentId[] = ['approver', 'dependabot', 'developer', 'auditor', 'sentinel', 'documenter'];

const forced = new Set<AgentId>();
/** Run now: the agent's next poll redoes its work, including items it already handled. */
export function forceAgent(id: AgentId): void {
  forced.add(id);
}
/** Whether this poll was forced by Run now; reading it clears it. */
export function takeForce(id: AgentId): boolean {
  return forced.delete(id);
}
/** Whether a Run now waits for the agent's next poll, without clearing it. */
export const isForced = (id: AgentId): boolean => forced.has(id);

/** Whether an agent can run now, and the first reason it can't. Re-evaluated on every poll. */
export function agentStatus(agent: AgentId): { on: boolean; reason?: string; paused?: boolean } {
  // Paused: enabled and configured, but its provider waits for a usage limit to reset.
  const off = (reason: string, paused?: boolean) => ({ on: false, reason, ...(paused && { paused }) });
  const cfg = read(`agents.${agent}`);
  if (!cfg.enabled) return off('Disabled');
  if (!getSecret(SECRETS.githubToken)) return off('GitHub token not set');
  if (agent === 'developer') {
    const dev = read('agents.developer');
    const jira = jiraStatus();
    if (!jira.ready) return off(jira.reason!);
    if (!read('projects').items.some((p) => p.boardId)) return off('No project has a Jira board');
    const roles = [['lead', dev.lead], ['reviewer', dev.reviewer], ['second reviewer', dev.secondReviewer]] as const;
    for (const [role, choice] of roles.filter(([, c]) => !('enabled' in c) || c.enabled)) {
      const p = routeStatus(choice.provider);
      if (!p.ready) return off(`${role}: ${p.reason}`, p.paused);
    }
    return { on: true };
  }
  if (agent === 'auditor') {
    const { categories } = read('agents.auditor');
    const on = AUDIT_CATEGORIES.filter((c) => categories[c].enabled);
    if (!on.length) return off('No audit category enabled');
    for (const c of on) {
      const p = routeStatus(categories[c].provider);
      if (!p.ready) return off(`${c}: ${p.reason}`, p.paused);
    }
    if (projectRepos().length === 0) return off('No project has repositories');
    return { on: true };
  }
  if (agent === 'sentinel') {
    const p = providerStatus(read('agents.sentinel').provider);
    if (!p.ready) return off(p.reason!, p.paused);
    if (!read('projects').items.some((pr) => pr.environment)) return off('No project has a test environment');
    // Without Jira the Sentinel still runs; confirmed bugs then wait in the inbox.
    return { on: true };
  }
  const p = routeStatus(read(`agents.${agent}`).provider);
  if (!p.ready) return off(p.reason!, p.paused);
  if ((agent === 'dependabot' || agent === 'documenter') && projectRepos().length === 0) return off('No project has repositories');
  return { on: true };
}
