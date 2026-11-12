import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { api, clearSecret, saveSection, setSecret, type Sections, type SettingsResponse } from '../api';
import { Badge, Button, Card, Field, Loading, Message, PageHeader, Text, useAction, useFetch, useUnsaved } from '../ui';

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
      <Card title={<>GitHub {data.secrets['github.token'] ? <Badge tone="ok">token stored</Badge> : <Badge tone="warn">no token</Badge>}</>}>
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
      </Card>
      <Card title={<>Jira {data.secrets['jira.token'] ? <Badge tone="ok">token stored</Badge> : <Badge tone="muted">not set</Badge>}</>}>
        <p className="muted">
          {t('Used by the developer agent; each project sets its own board under Projects.')}{' '}
          {t('Create the API token at {path}.', { path: 'id.atlassian.com → Security → API tokens' })} <b>{t('Pick classic, not "with scopes".')}</b>
        </p>
        <div className="row fields">
          <Field label="Site URL">
            <Text value={jira.url} onChange={(url) => setJira({ ...jira, url })} placeholder="https://your-site.atlassian.net" />
          </Field>
          <Field label="Account email">
            <Text value={jira.email} onChange={(email) => setJira({ ...jira, email })} />
          </Field>
          <Button variant="primary" busy={j.busy} onClick={() => j.run(async () => (await saveSection('jira', jira), reload()))}>
            Save
          </Button>
          <Message message={j.message} />
        </div>
        <SecretInput name="jira.token" label="API token" hint="Stored encrypted; never shown again." settings={data} reload={reload} />
        <TestButton path="/test/jira" />
      </Card>
    </>
  );
}
