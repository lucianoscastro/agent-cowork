import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { api, clearSecret, saveSection, setSecret, type Sections, type SettingsResponse } from '../api';
import { Badge, Button, Card, Field, FoldCard, Loading, Message, PageHeader, Text, Toggle, useAction, useFetch, useUnsaved } from '../ui';

export function SecretInput({ name, label, hint, settings, reload }: { name: string; label: string; hint: string; settings: SettingsResponse; reload: () => void }) {
  const [value, setValue] = useState('');
  const action = useAction();
  const stored = settings.secrets[name];
  return (
    <div className="row fields">
      <Field label={label} hint={stored ? 'Stored. Enter a new value to replace it.' : hint}>
        <Text type="password" value={value} onChange={setValue} placeholder={stored ? '••••••••' : ''} />
      </Field>
      <Button variant="primary" disabled={!value} busy={action.busy} onClick={() => action.run(async () => (await setSecret(name, value), setValue(''), reload()))}>
        Store
      </Button>
      {stored && (
        <Button variant="danger" onClick={() => action.run(async () => (await clearSecret(name), reload()), 'Removed')}>
          Remove
        </Button>
      )}
      <Message message={action.message} />
    </div>
  );
}

export function TestButton({ path, label = 'Test connection' }: { path: string; label?: string }) {
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="row">
      <Button busy={busy} onClick={async () => (setBusy(true), setResult(await api<{ ok: boolean; message: string }>(path, { method: 'POST' }).finally(() => setBusy(false))))}>
        {label}
      </Button>
      {result && <Message message={{ tone: result.ok ? 'ok' : 'bad', text: result.message }} />}
    </div>
  );
}

export function Integrations() {
  const t = useT();
  const { data, error, reload } = useFetch<SettingsResponse>('/settings');
  const [github, setGithub] = useState<Sections['github']>();
  const [jira, setJira] = useState<Sections['jira']>();
  const g = useAction();
  const j = useAction();
  useUnsaved(github, data?.sections.github);
  useUnsaved(jira, data?.sections.jira);
  useEffect(() => {
    if (data) (setGithub(data.sections.github), setJira(data.sections.jira));
  }, [data]);
  if (!data || !github || !jira) return <Loading error={error} retry={reload} />;
  return (
    <>
      <PageHeader title="GitHub and Jira" />
      <FoldCard open={!data.secrets['github.token']} title={<>GitHub {data.secrets['github.token'] ? <Badge tone="ok">token stored</Badge> : <Badge tone="warn">no token</Badge>}</>}>
        <p className="muted">
          {t('The GitHub user every agent acts as: it reviews and approves as this user, and opens and merges PRs as this user.')} {t('Token scopes:')}{' '}
          <code>repo</code>, <code>read:org</code> {t('(authorized for SSO if your organization uses it).')}
        </p>
        <SecretInput name="github.token" label="Token" hint="Stored encrypted; never shown again." settings={data} reload={reload} />
        <div className="row fields">
          <Field label="Commit author name">
            <Text value={github.gitName} onChange={(gitName) => setGithub({ ...github, gitName })} />
          </Field>
          <Field label="Commit author email" hint="Empty uses a GitHub noreply address.">
            <Text value={github.gitEmail} onChange={(gitEmail) => setGithub({ ...github, gitEmail })} />
          </Field>
          <Button variant="primary" busy={g.busy} onClick={() => g.run(async () => (await saveSection('github', github), reload()))}>
            Save
          </Button>
          <Message message={g.message} />
        </div>
        <TestButton path="/test/github" />
      </FoldCard>
      <FoldCard
        open={!data.secrets['jira.token']}
        title={
          <>
            Jira {data.secrets['jira.token'] ? <Badge tone="ok">token stored</Badge> : <Badge tone="muted">not set</Badge>}{' '}
            {jira.url && <span className="muted small">{jira.url.replace(/^https:\/\//, '')}</span>}
          </>
        }
      >
        <p className="muted">
          {t('Used by the Developer and the Product Manager; each project sets its own board under Projects.')}{' '}
          {t('Create the API token at {path}.', { path: 'id.atlassian.com → Security → API tokens' })} <b>{t('Pick classic, not "with scopes".')}</b>
        </p>
        <div className="row fields">
          <Field label="Site URL">
            <Text value={jira.url} onChange={(url) => setJira({ ...jira, url })} placeholder="https://your-site.atlassian.net" />
          </Field>
          <Field label="Account email">
            <Text value={jira.email} onChange={(email) => setJira({ ...jira, email })} />
          </Field>
        </div>
        <div className="row fields">
          <Field label="Cards the agents take (JQL)" hint='Shared by every agent that takes cards from a board, each adding its own label (the Developer agent-ready, the Product Manager agent-spec and agent-discovery). For example: statusCategory != Done AND status = "Ready for AI".'>
            <Text value={jira.readyJql} onChange={(readyJql) => setJira({ ...jira, readyJql })} placeholder="statusCategory != Done" />
          </Field>
        </div>
        <p className="small muted">{t('How a card moves on the board, the same for every agent (a transition or status name; empty leaves it where it is):')}</p>
        <div className="row fields">
          <Field label="When an agent takes it">
            <Text value={jira.startTransition} onChange={(startTransition) => setJira({ ...jira, startTransition })} placeholder="leave unchanged" />
          </Field>
          <Field label="While waiting for people" hint="Their answers to the agent's questions.">
            <Text value={jira.blockedTransition} onChange={(blockedTransition) => setJira({ ...jira, blockedTransition })} placeholder="leave unchanged" />
          </Field>
          <Field label="While waiting for approval" hint="A finished proposal people approve, or comment to change.">
            <Text value={jira.reviewTransition} onChange={(reviewTransition) => setJira({ ...jira, reviewTransition })} placeholder="as waiting for people" />
          </Field>
          <Field label="When handed to another agent" hint="Where the JQL finds it again: needed when the JQL names a status.">
            <Text value={jira.readyTransition} onChange={(readyTransition) => setJira({ ...jira, readyTransition })} placeholder="leave unchanged" />
          </Field>
        </div>
        <Toggle
          checked={jira.assign}
          onChange={(assign) => setJira({ ...jira, assign })}
          label="Assign the card to this Jira account when an agent takes it"
        />
        <p className="hint">{t('So the board shows who is on it. The account needs the Assign issues and Assignable user permissions (Check on Jira, in Projects).')}</p>
        <Toggle
          checked={jira.worklog}
          onChange={(worklog) => setJira({ ...jira, worklog })}
          label="Log each agent run on its card as Jira work log: how long it took, the runtimes, tokens and cost, and a link to the run"
        />
        <p className="hint">
          {t("It counts in Jira's time reports (and Tempo) like people's time; the estimate stays as it is and nobody is notified. Needs time tracking on in Jira.")}
        </p>
        <div className="row">
          <Button variant="primary" busy={j.busy} onClick={() => j.run(async () => (await saveSection('jira', jira), reload()))}>
            Save
          </Button>
          <Message message={j.message} />
        </div>
        <SecretInput name="jira.token" label="API token" hint="Stored encrypted; never shown again." settings={data} reload={reload} />
        <TestButton path="/test/jira" />
      </FoldCard>
    </>
  );
}
