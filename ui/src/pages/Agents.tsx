import { useEffect, useState } from 'react';
import { type AgentId, api, AUDIT_CATEGORIES, type ModelChoice, type Overview, type ProviderId, type Run, saveSection, type Sections, type SettingsResponse } from '../api';
import { AGENT_NAMES, AGENT_SUMMARY, Badge, Button, Card, Embedded, Empty, Field, Loading, Message, ModelInput, Num, PROVIDER_NAMES, RunStatus, Select, Tabs, Text, Time, Toggle, useAction, useFetch, useUnsaved } from '../ui';
import { useT } from '../i18n';
import { Assets } from './Assets';

const MODEL_HINT = 'Pick from the list or type any id. Empty uses the provider default.';
const providerOptions = (Object.keys(PROVIDER_NAMES) as ProviderId[]).map((p) => ({ value: p, label: PROVIDER_NAMES[p] }));
const modelLabel = (c: ModelChoice) => `${PROVIDER_NAMES[c.provider]}${c.model ? ` · ${c.model}` : ''}`;

function ModelPicker({ value, onChange, settings }: { value: ModelChoice; onChange: (v: ModelChoice) => void; settings: SettingsResponse }) {
  const status = settings.providers[value.provider];
  return (
    <div className="row fields">
      <Field label="Provider" hint={status.ready ? 'Ready' : status.reason}>
        <Select value={value.provider} onChange={(provider) => onChange({ ...value, provider })} options={providerOptions} />
      </Field>
      <Field label="Model" hint={MODEL_HINT}>
        <ModelInput provider={value.provider} value={value.model} onChange={(model) => onChange({ ...value, model })} />
      </Field>
    </div>
  );
}

function useSection<K extends keyof Sections>(settings: SettingsResponse | undefined, key: K) {
  const [value, setValue] = useState<Sections[K]>();
  useEffect(() => {
    if (settings) setValue(settings.sections[key]);
  }, [settings, key]);
  useUnsaved(value, settings?.sections[key]);
  return [value, setValue] as const;
}

function SaveRow({ action, onSave }: { action: ReturnType<typeof useAction>; onSave: () => void }) {
  return (
    <div className="row">
      <Button variant="primary" busy={action.busy} onClick={onSave}>
        Save
      </Button>
      <Message message={action.message} />
    </div>
  );
}

const DESCRIPTIONS: Record<AgentId, string> = {
  developer:
    "Picks agent-ready cards from each project's Jira board, plans with the lead, has the reviewer check the plan and the diff, verifies with the repository commands and opens a PR per changed repository. Then it follows each PR until it is merged or closed: it answers every review comment (fixing it, or declining it with a justification) and keeps the pipeline green, including quality gates such as SonarQube. Merging stays with humans.",
  approver:
    "Reviews open PRs that request review directly from the GitHub user of this instance. Approves when there is nothing to suggest; otherwise comments inline.",
  dependabot:
    "Watches every repository of the projects under Projects. Merges Dependabot PRs when the release is older than the cooldown, checks are green, the repository's verify commands pass and the model finds no risk. Everything else goes to the inbox.",
  sentinel:
    "Once a day per project with a test environment (Projects → Test environment): runs the project's end-to-end suite (Playwright, Cucumber or Cypress, found in its repositories), runs each failed test again on its own to rule out flakiness, reproduces the ones that keep failing in a browser, and files the real bugs on the project's board with screenshots, the HAR and the steps, or comments on the open bug. Every few hours it also explores what changed in the repositories checked for it, and sends what it confirms to the inbox, where a person turns it into a card.",
  documenter:
    "Documents every repository of the projects under Projects: architecture, modules, data model, entry points, security, state machines, critical flows, technical debt and one file per business domain, with Mermaid diagrams and a code reference for every rule. The first run writes it all; later ones update what the new commits touched. It writes only in the docs folder and opens one PR per repository, updating it while it is open. Merging stays with humans.",
  auditor:
    "Audits every repository of the projects under Projects on its base branch, one category at a time, each with its own skill, model and interval, and only when the branch has new commits since that category's last audit. Results go to the Findings page; critical and high findings also go to the inbox. Read-only on the code.",
};

// {command} marks where the inline <code> goes.
const CI_FAILS_NOTE =
  "A PR in conflict, or failing while behind its base, gets {command}. Failing on an up-to-date branch, Dependabot can't fix it: a card on the project's board lets the Developer agent apply the update and fix what breaks (one card per PR).";

const DRY_RUN_NOTE =
  'In dry run an agent does all the work (models, verification) but writes nothing to GitHub or Jira; take agents live one at a time. Dry runs keep their own history, so going live does not skip real work.';

/** One agent's settings form; saving applies on the agent's next poll. */
function AgentSettings({ id, settings, reload }: { id: AgentId; settings: SettingsResponse; reload: () => Promise<void> }) {
  const t = useT();
  const [approver, setApprover] = useSection(settings, 'agents.approver');
  const [dependabot, setDependabot] = useSection(settings, 'agents.dependabot');
  const [developer, setDeveloper] = useSection(settings, 'agents.developer');
  const [auditor, setAuditor] = useSection(settings, 'agents.auditor');
  const [sentinel, setSentinel] = useSection(settings, 'agents.sentinel');
  const [documenter, setDocumenter] = useSection(settings, 'agents.documenter');
  const a = useAction();
  const b = useAction();
  const c = useAction();
  const d = useAction();
  const e = useAction();
  const f = useAction();
  if (!approver || !dependabot || !developer || !auditor || !sentinel || !documenter) return <Loading />;
  const save = <K extends keyof Sections>(action: ReturnType<typeof useAction>, key: K, value: Sections[K]) =>
    action.run(async () => {
      await saveSection(key, value);
      await reload();
    });
  switch (id) {
    case 'developer':
      return (
        <Card>
          <Toggle checked={developer.enabled} onChange={(enabled) => setDeveloper({ ...developer, enabled })} label="Enabled" />
          <Toggle checked={developer.dryRun} onChange={(dryRun) => setDeveloper({ ...developer, dryRun })} label="Dry run (writes nothing to GitHub or Jira)" />
          <div className="row fields">
            <Field label="Cards in parallel" hint="Across all projects, the same project included. Each card has its own checkout and branch.">
              <Num value={developer.concurrency} min={1} max={4} onChange={(concurrency) => setDeveloper({ ...developer, concurrency })} />
            </Field>
          </div>
          <h3>{t('Trigger and Jira flow')}</h3>
          <Field label="Trigger JQL" hint="Applied within each project's board.">
            <Text value={developer.triggerJql} onChange={(triggerJql) => setDeveloper({ ...developer, triggerJql })} />
          </Field>
          <div className="row fields">
            <Field label="When picked, move to">
              <Text value={developer.startTransition} onChange={(startTransition) => setDeveloper({ ...developer, startTransition })} />
            </Field>
            <Field label="While waiting for a human">
              <Text value={developer.blockedTransition} onChange={(blockedTransition) => setDeveloper({ ...developer, blockedTransition })} />
            </Field>
            <Field label="When PRs are open">
              <Text value={developer.doneTransition} onChange={(doneTransition) => setDeveloper({ ...developer, doneTransition })} placeholder="leave unchanged" />
            </Field>
            <Field label="When PRs are merged" hint="The card is done then, and the agent stops following its PRs.">
              <Text value={developer.mergedTransition} onChange={(mergedTransition) => setDeveloper({ ...developer, mergedTransition })} placeholder="leave unchanged" />
            </Field>
          </div>
          <h3>{t('Pull requests')}</h3>
          <div className="row fields">
            <Field label="Default base branch" hint="Used when a project has none; empty uses the repository default.">
              <Text value={developer.baseBranch} onChange={(baseBranch) => setDeveloper({ ...developer, baseBranch })} />
            </Field>
            <Field label="Open PRs as">
              <Select
                value={developer.draft ? 'draft' : 'ready'}
                onChange={(v) => setDeveloper({ ...developer, draft: v === 'draft' })}
                options={[
                  { value: 'ready', label: 'Ready for review' },
                  { value: 'draft', label: 'Draft' },
                ]}
              />
            </Field>
          </div>
          <h3>{t('Team')}</h3>
          <p className="small muted">{t('Lead')}</p>
          <ModelPicker value={developer.lead} onChange={(lead) => setDeveloper({ ...developer, lead })} settings={settings} />
          <div className="row fields">
            <Field label="Coder subagent model" hint="Claude lead only.">
              <ModelInput provider={developer.lead.provider} value={developer.coderModel} onChange={(coderModel) => setDeveloper({ ...developer, coderModel })} />
            </Field>
            <Field label="Tester subagent model" hint="Claude lead only.">
              <ModelInput provider={developer.lead.provider} value={developer.testerModel} onChange={(testerModel) => setDeveloper({ ...developer, testerModel })} />
            </Field>
          </div>
          <p className="small muted">{t('Independent reviewers of the plan and the diff: none, one or both. With both, they review in parallel and each must approve.')}</p>
          <Toggle checked={developer.reviewer.enabled} onChange={(enabled) => setDeveloper({ ...developer, reviewer: { ...developer.reviewer, enabled } })} label="First reviewer" />
          {developer.reviewer.enabled && (
            <ModelPicker value={developer.reviewer} onChange={(r) => setDeveloper({ ...developer, reviewer: { ...r, enabled: true } })} settings={settings} />
          )}
          <Toggle
            checked={developer.secondReviewer.enabled}
            onChange={(enabled) => setDeveloper({ ...developer, secondReviewer: { ...developer.secondReviewer, enabled } })}
            label="Second reviewer"
          />
          {developer.secondReviewer.enabled && (
            <ModelPicker value={developer.secondReviewer} onChange={(r) => setDeveloper({ ...developer, secondReviewer: { ...r, enabled: true } })} settings={settings} />
          )}
          {!developer.reviewer.enabled && !developer.secondReviewer.enabled && (
            <p className="message warn">{t('No reviewer: plans and diffs go unreviewed; only the must-pass commands and the people on the PR check the work.')}</p>
          )}
          <h3>{t('Loop limits')}</h3>
          <div className="row">
            {(
              [
                ['planReview', 'Plan review rounds'],
                ['verify', 'Fix attempts after a red verify'],
                ['diffReview', 'Diff review rounds'],
                ['followUp', 'Rounds on a red PR before asking a human'],
                ['runMinutes', 'Max minutes per run'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <Num value={developer.limits[k]} onChange={(v) => setDeveloper({ ...developer, limits: { ...developer.limits, [k]: v } })} />
              </Field>
            ))}
          </div>
          <SaveRow action={c} onSave={() => save(c, 'agents.developer', developer)} />
        </Card>
      );
    case 'documenter':
      return (
        <Card>
          <Toggle checked={documenter.enabled} onChange={(enabled) => setDocumenter({ ...documenter, enabled })} label="Enabled" />
          <Toggle checked={documenter.dryRun} onChange={(dryRun) => setDocumenter({ ...documenter, dryRun })} label="Dry run (writes nothing to GitHub or Jira)" />
          <ModelPicker value={documenter} onChange={(v) => setDocumenter({ ...documenter, ...v })} settings={settings} />
          <div className="row fields">
            <Field label="Docs folder" hint="Inside each repository; the agent writes only there and the platform reverts anything else. Other files in it are kept.">
              <Text value={documenter.folder} onChange={(folder) => setDocumenter({ ...documenter, folder })} placeholder=".agents" />
            </Field>
            <Field label="Every (days)" hint="Only when the base branch has new commits since the last docs. Run now documents every repository at once.">
              <Num value={documenter.intervalDays} min={1} max={365} onChange={(intervalDays) => setDocumenter({ ...documenter, intervalDays })} />
            </Field>
            <Field label="Repositories in parallel">
              <Num value={documenter.concurrency} min={1} max={4} onChange={(concurrency) => setDocumenter({ ...documenter, concurrency })} />
            </Field>
          </div>
          <SaveRow action={f} onSave={() => save(f, 'agents.documenter', documenter)} />
        </Card>
      );
    case 'approver':
      return (
        <Card>
          <Toggle checked={approver.enabled} onChange={(enabled) => setApprover({ ...approver, enabled })} label="Enabled" />
          <Toggle checked={approver.dryRun} onChange={(dryRun) => setApprover({ ...approver, dryRun })} label="Dry run (writes nothing to GitHub or Jira)" />
          <ModelPicker value={approver} onChange={(v) => setApprover({ ...approver, ...v })} settings={settings} />
          <Field label="Reviews in parallel">
            <Num value={approver.concurrency} min={1} max={8} onChange={(concurrency) => setApprover({ ...approver, concurrency })} />
          </Field>
          <SaveRow action={a} onSave={() => save(a, 'agents.approver', approver)} />
        </Card>
      );
    case 'dependabot':
      return (
        <Card>
          <Toggle checked={dependabot.enabled} onChange={(enabled) => setDependabot({ ...dependabot, enabled })} label="Enabled" />
          <Toggle checked={dependabot.dryRun} onChange={(dryRun) => setDependabot({ ...dependabot, dryRun })} label="Dry run (writes nothing to GitHub or Jira)" />
          <ModelPicker value={dependabot} onChange={(v) => setDependabot({ ...dependabot, ...v })} settings={settings} />
          <div className="row fields">
            <Field label="Cooldown (days)" hint="Merge only releases at least this old.">
              <Num value={dependabot.cooldownDays} min={0} max={60} onChange={(cooldownDays) => setDependabot({ ...dependabot, cooldownDays })} />
            </Field>
            <Field label="Merge method">
              <Select
                value={dependabot.mergeMethod}
                onChange={(mergeMethod) => setDependabot({ ...dependabot, mergeMethod })}
                options={[{ value: 'squash', label: 'Squash' }, { value: 'merge', label: 'Merge commit' }, { value: 'rebase', label: 'Rebase' }]}
              />
            </Field>
            <Field label="Auto-merge updates">
              <div className="row">
                {(['patch', 'minor'] as const).map((kind) => (
                  <Toggle
                    key={kind}
                    label={kind}
                    checked={dependabot.allowedUpdates.includes(kind)}
                    onChange={(on) =>
                      setDependabot({ ...dependabot, allowedUpdates: on ? [...dependabot.allowedUpdates, kind] : dependabot.allowedUpdates.filter((x) => x !== kind) })
                    }
                  />
                ))}
              </div>
            </Field>
          </div>
          <h3>{t('When CI fails')}</h3>
          <p className="hint">
            {t(CI_FAILS_NOTE).split('{command}')[0]}
            <code>@dependabot rebase</code>
            {t(CI_FAILS_NOTE).split('{command}')[1]}
          </p>
          <Toggle
            checked={dependabot.failingCiCard}
            onChange={(failingCiCard) => setDependabot({ ...dependabot, failingCiCard })}
            label="Open a Jira card for the Developer (otherwise it goes to the inbox)"
          />
          {dependabot.failingCiCard && (
            <div className="row fields">
              <Field label="Issue type">
                <Text value={dependabot.cardIssueType} onChange={(cardIssueType) => setDependabot({ ...dependabot, cardIssueType })} />
              </Field>
              <Field label="Labels" hint="Comma-separated. Keep the one the Developer's trigger looks for (agent-ready by default).">
                <Text
                  value={dependabot.cardLabels.join(', ')}
                  onChange={(v) => setDependabot({ ...dependabot, cardLabels: v.split(',').map((l) => l.trim()).filter(Boolean) })}
                />
              </Field>
              <Field label="Move it to" hint="The status the Developer picks cards from, if its trigger is a status. Empty leaves it as created.">
                <Text value={dependabot.cardTransition} onChange={(cardTransition) => setDependabot({ ...dependabot, cardTransition })} placeholder="e.g. Ready for AI" />
              </Field>
            </div>
          )}
          <SaveRow action={b} onSave={() => save(b, 'agents.dependabot', dependabot)} />
        </Card>
      );
    case 'sentinel':
      return (
        <Card>
          <Toggle checked={sentinel.enabled} onChange={(enabled) => setSentinel({ ...sentinel, enabled })} label="Enabled" />
          <Toggle checked={sentinel.dryRun} onChange={(dryRun) => setSentinel({ ...sentinel, dryRun })} label="Dry run (writes nothing to GitHub or Jira)" />
          <ModelPicker value={sentinel} onChange={(v) => setSentinel({ ...sentinel, ...v })} settings={settings} />
          <p className="hint">{t('The browser tools need Claude Code as the provider.')}</p>
          <div className="row fields">
            <Field label="End-to-end tests run at (UTC)" hint="Pick a quiet hour: if the project's CI also tests this environment, keep the two apart.">
              <Text value={sentinel.nightlyAt} onChange={(nightlyAt) => setSentinel({ ...sentinel, nightlyAt })} placeholder="09:00" />
            </Field>
            <Field label="Explore every (hours)" hint="Only repositories whose branch moved since the last exploration.">
              <Num value={sentinel.exploreEveryHours} min={1} max={168} onChange={(exploreEveryHours) => setSentinel({ ...sentinel, exploreEveryHours })} />
            </Field>
          </div>
          <SaveRow action={e} onSave={() => save(e, 'agents.sentinel', sentinel)} />
        </Card>
      );
    case 'auditor':
      return (
        <Card>
          <Toggle checked={auditor.enabled} onChange={(enabled) => setAuditor({ ...auditor, enabled })} label="Enabled" />
          <Toggle checked={auditor.dryRun} onChange={(dryRun) => setAuditor({ ...auditor, dryRun })} label="Dry run (writes nothing to GitHub or Jira)" />
          <table className="categories">
            <thead>
              <tr>
                <th>{t('Category')}</th>
                <th>{t('Provider')}</th>
                <th>{t('Model')}</th>
                <th>{t('Every (days)')}</th>
              </tr>
            </thead>
            <tbody>
              {AUDIT_CATEGORIES.map((c) => {
                const cat = auditor.categories[c.id];
                const setCat = (next: typeof cat) => setAuditor({ ...auditor, categories: { ...auditor.categories, [c.id]: next } });
                return (
                  <tr key={c.id}>
                    <td>
                      <Toggle checked={cat.enabled} onChange={(enabled) => setCat({ ...cat, enabled })} label={c.name} />
                      <div className="muted small">
                        {t(c.scope)} · skill <code>{c.skill}</code>
                      </div>
                    </td>
                    <td>
                      <Select value={cat.provider} onChange={(provider) => setCat({ ...cat, provider })} options={providerOptions} />
                    </td>
                    <td>
                      <ModelInput provider={cat.provider} value={cat.model} onChange={(model) => setCat({ ...cat, model })} />
                    </td>
                    <td>
                      <Num value={cat.intervalDays} min={1} max={365} onChange={(intervalDays) => setCat({ ...cat, intervalDays })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">{t('Each enabled category is a full audit per repository: enabling many multiplies model usage.')}</p>
          <div className="row fields">
            <Field label="Repositories in parallel" hint="All due categories of a repository run at once, on one shared checkout.">
              <Num value={auditor.concurrency} min={1} max={4} onChange={(concurrency) => setAuditor({ ...auditor, concurrency })} />
            </Field>
            <Field label="Jira issue type for findings" hint="Used by Create Jira card on the Findings page.">
              <Text value={auditor.jiraIssueType} onChange={(jiraIssueType) => setAuditor({ ...auditor, jiraIssueType })} />
            </Field>
          </div>
          <SaveRow action={d} onSave={() => save(d, 'agents.auditor', auditor)} />
        </Card>
      );
  }
}

/** The team: each agent with its state; each card opens the agent. */
export function TeamPage() {
  const t = useT();
  const { data, error, reload } = useFetch<Overview>('/overview', 5000);
  if (!data) return <Loading error={error} retry={reload} />;
  return (
    <>
      <h1>{t('Agents')}</h1>
      <p className="lead">
        {t('An agent runs only when it is enabled and everything it needs is configured.')} {t(DRY_RUN_NOTE)}
      </p>
      <div className="agents-grid">
        {data.agents.map((a) => (
          <a key={a.id} href={`#/agents/${a.id}`} className="card agent-card">
            <h2>
              {AGENT_NAMES[a.id]}
              <span className="row tight">
                {a.polling && <Badge tone="info">working</Badge>}
                <StateBadge a={a} />
                {data.live.includes(a.id) ? <Badge tone="warn">live</Badge> : <Badge tone="muted">dry run</Badge>}
              </span>
            </h2>
            <p className="what">{t(AGENT_SUMMARY[a.id])}</p>
            {!a.on && <p className="why">{a.reason}</p>}
            <p className="when">
              {t('Last poll')} <Time iso={a.lastPoll} />
            </p>
          </a>
        ))}
      </div>
    </>
  );
}

/** What the agent did lately and what it waits on: its state, its last runs, its inbox. */
/** What Run now does: every agent but the Developer redoes its work, including what it already handled. */
const RUN_NOW: Record<AgentId, string> = {
  auditor: 'Auditing every enabled category of every repository now, each as its own run.',
  sentinel: 'Running the end-to-end suites and the explorations now.',
  dependabot: 'Assessing every open Dependabot PR again now, including the ones already handled.',
  approver: 'Reviewing every PR that still requests your review now, including commits already reviewed.',
  developer: 'Looking for agent-ready cards now. Cards already picked are not redone (that would open a second PR).',
  documenter: 'Documenting every repository now, whatever its interval or last commit.',
};

function AgentOverview({ id, overview, reload }: { id: AgentId; overview: Overview; reload: () => Promise<void> }) {
  const t = useT();
  const a = overview.agents.find((x) => x.id === id)!;
  const runNow = useAction();
  const { data: runs } = useFetch<Run[]>(`/runs?agent=${id}&limit=10`, 10_000);
  const { data: inbox } = useFetch<{ agent: AgentId }[]>('/inbox', 30_000);
  const waiting = inbox?.filter((i) => i.agent === id).length ?? 0;
  return (
    <>
      <Card title="State">
        <dl className="facts">
          <dt>{t('Status')}</dt>
          <dd>
            <StateBadge a={a} /> {!a.on && <span className="reason inline">{a.reason}</span>}
          </dd>
          <dt>{t('Mode')}</dt>
          <dd>{overview.live.includes(id) ? <Badge tone="warn">live: writes to GitHub and Jira</Badge> : <Badge tone="muted">dry run</Badge>}</dd>
          <dt>{t('Last poll')}</dt>
          <dd>
            <Time iso={a.lastPoll} />
            {a.polling && <> · <Badge tone="info">working</Badge></>}
          </dd>
          {a.lastError && (
            <>
              <dt>{t('Last poll failed')}</dt>
              <dd className="message bad pre">
                <Time iso={a.lastError.at} />: {a.lastError.message}
              </dd>
            </>
          )}
          <dt>{t('Waiting for you')}</dt>
          <dd>{waiting ? <a href="#/inbox">{t('{n} in the inbox', { n: waiting })}</a> : <span className="muted">{t('nothing')}</span>}</dd>
        </dl>
        <div className="row" style={{ marginTop: 16 }}>
          <Button
            variant="primary"
            disabled={!a.on}
            busy={runNow.busy}
            onClick={() =>
              runNow.run(
                () => api(`/agents/${id}/run-now`, { method: 'POST' }).then(reload),
                RUN_NOW[id],
              )
            }
          >
            Run now
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              window.confirm(
                t('Stop everything {agent} is running now? The stopped items go to the inbox and are not picked up again until you Retry them. The agent stays on.', {
                  agent: AGENT_NAMES[id],
                }),
              ) &&
              api(`/agents/${id}/stop`, { method: 'POST' }).then(reload)
            }
          >
            Stop running work
          </Button>
        </div>
        <Message message={runNow.message} />
      </Card>
      <Card title="Last runs" actions={<a href={`#/runs`}>{t('All runs')}</a>}>
        {!runs ? null : runs.length === 0 ? (
          <Empty>No runs yet.</Empty>
        ) : (
          <table>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`#/runs/${r.id}`}>#{r.id}</a>
                  </td>
                  <td>{r.title ?? r.item}</td>
                  <td>
                    <RunStatus status={r.status} /> {r.dry_run ? <Badge tone="muted">dry run</Badge> : null}
                  </td>
                  <td className="clip muted">{r.summary || r.error || r.stage}</td>
                  <td className="num">
                    <Time iso={r.started_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

/** One agent: overview, settings and its prompts (read-only), each a tab with its own address. */
export function AgentPage({ id, tab }: { id: AgentId; tab: string }) {
  const t = useT();
  const { data: overview, error: overviewError, reload: reloadOverview } = useFetch<Overview>('/overview', 5000);
  const { data: settings, error: settingsError, reload } = useFetch<SettingsResponse>('/settings');
  if (!overview || !settings) return <Loading error={overviewError ?? settingsError} retry={() => void Promise.all([reloadOverview(), reload()])} />;
  const a = overview.agents.find((x) => x.id === id)!;
  return (
    <>
      <header className="hero">
        <div>
          <h1>{AGENT_NAMES[id]}</h1>
        </div>
        <span className="row tight">
          <StateBadge a={a} />
          {overview.live.includes(id) ? <Badge tone="warn">live</Badge> : <Badge tone="muted">dry run</Badge>}
        </span>
      </header>
      <p className="lead">{t(DESCRIPTIONS[id])}</p>
      <Tabs
        base={`agents/${id}`}
        current={tab}
        tabs={[
          { id: '', label: 'Overview' },
          { id: 'settings', label: 'Settings' },
          { id: 'prompts', label: 'Prompts' },
        ]}
      />
      {tab === 'settings' ? (
        <>
          <p className="muted">
            {t(DRY_RUN_NOTE)} {t('Changes apply on the next poll.')}
          </p>
          <AgentSettings id={id} settings={settings} reload={reload} />
        </>
      ) : tab === 'prompts' ? (
        <Embedded.Provider value>
          <Assets only={`prompts/${id}/`} />
        </Embedded.Provider>
      ) : (
        <AgentOverview id={id} overview={overview} reload={reloadOverview} />
      )}
    </>
  );
}

/** On, paused by a provider usage limit, or off. */
function StateBadge({ a }: { a: { on: boolean; paused?: boolean } }) {
  if (a.on) return <Badge tone="ok">on</Badge>;
  return a.paused ? <Badge tone="warn">paused</Badge> : <Badge tone="muted">off</Badge>;
}
