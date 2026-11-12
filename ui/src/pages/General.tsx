import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { NOTIFY_EVENTS, saveSection, type Sections, type SettingsResponse, type Stack, STACK_NAMES } from '../api';
import { SecretInput, TestButton } from './Integrations';
import { Button, Card, Field, Lines, Loading, Message, Num, PageHeader, Select, Text, Toggle, useAction, useFetch, useUnsaved } from '../ui';

export function General() {
  const t = useT();
  const { data, error, reload } = useFetch<SettingsResponse>('/settings');
  const [general, setGeneral] = useState<Sections['general']>();
  const [stacks, setStacks] = useState<Sections['stacks']>();
  const [notifications, setNotifications] = useState<Sections['notifications']>();
  const action = useAction();
  const stackAction = useAction();
  const notifyAction = useAction();
  useUnsaved(general, data?.sections.general);
  useUnsaved(stacks, data?.sections.stacks);
  useUnsaved(notifications, data?.sections.notifications);
  useEffect(() => {
    if (data) {
      setGeneral(data.sections.general);
      setStacks(data.sections.stacks);
      setNotifications(data.sections.notifications);
    }
  }, [data]);
  if (!data || !general || !stacks || !notifications) return <Loading error={error} retry={reload} />;
  return (
    <>
      <PageHeader title="General" />
      <Card>
        <div className="row fields">
          <Field label="Language of agent output" hint="Review comments, card questions and PR descriptions. Code and commits stay in English.">
            <Select
              value={general.language}
              onChange={(language) => setGeneral({ ...general, language })}
              options={[
                { value: 'en-US', label: 'English (en-US)' },
                { value: 'pt-BR', label: 'Português (pt-BR)' },
                { value: 'es-ES', label: 'Español (es-ES)' },
              ]}
            />
          </Field>
          <Field label="Poll every (seconds)">
            <Num value={general.pollSeconds} min={30} onChange={(pollSeconds) => setGeneral({ ...general, pollSeconds })} />
          </Field>
        </div>
        <Toggle label="Switch provider on a usage limit" checked={general.fallback} onChange={(fallback) => setGeneral({ ...general, fallback })} />
        <p className="hint">
          {t(
            "When a provider is paused or hits its usage limit, the call moves on to the next one (Claude Code, Codex, agy) with that provider's default model; a run fails only when all three are limited. Browser steps stay on Claude Code.",
          )}
        </p>
        <div className="row">
          <Button variant="primary" busy={action.busy} onClick={() => action.run(async () => (await saveSection('general', general), reload()))}>
            Save
          </Button>
          <Message message={action.message} />
        </div>
      </Card>
      <Card title="Notifications">
        <p className="hint">
          {t(
            'A webhook that receives a JSON post for each event: text for Slack, Mattermost and Teams workflows, content for Discord, and the fields for anything else (n8n, Zapier, your own endpoint). Nothing is sent while no webhook is stored.',
          )}
        </p>
        <SecretInput name="notifications.webhookUrl" label="Webhook URL" hint="Stored encrypted, as it carries the channel's token." settings={data} reload={reload} />
        <h3>{t('Events')}</h3>
        <div className="toggles">
          {NOTIFY_EVENTS.map((e) => (
            <Toggle
              key={e.id}
              checked={notifications.events[e.id]}
              onChange={(on) => setNotifications({ ...notifications, events: { ...notifications.events, [e.id]: on } })}
              label={e.label}
            />
          ))}
        </div>
        <div className="row fields">
          <Field label="Address of this UI (optional)" hint="Used for links in the messages, e.g. https://agents.example.com. Empty: messages link to the GitHub or Jira item only.">
            <Text value={notifications.uiUrl} onChange={(uiUrl) => setNotifications({ ...notifications, uiUrl })} placeholder="https://" />
          </Field>
        </div>
        <div className="row">
          <Button variant="primary" busy={notifyAction.busy} onClick={() => notifyAction.run(async () => (await saveSection('notifications', notifications), reload()))}>
            Save
          </Button>
          {data.secrets['notifications.webhookUrl'] && <TestButton path="/notifications/test" label="Send test" />}
          <Message message={notifyAction.message} />
        </div>
      </Card>
      <Card title="Verify commands by stack">
        <p className="hint">
          {t(
            'What the platform runs, from the repository root, before a PR is opened or a Dependabot PR is merged. Each repository under Projects names its stack and may replace these with its own commands. Mirror your CI.',
          )}
        </p>
        <div className="grid three">
          {(Object.keys(STACK_NAMES) as Stack[]).map((s) => (
            <Field key={s} label={STACK_NAMES[s]}>
              <Lines value={stacks[s]} onChange={(list) => setStacks({ ...stacks, [s]: list })} rows={5} />
            </Field>
          ))}
        </div>
        <div className="row">
          <Button
            variant="primary"
            busy={stackAction.busy}
            onClick={() => stackAction.run(async () => (await saveSection('stacks', Object.fromEntries(Object.entries(stacks).map(([k, v]) => [k, v.filter((c) => c.trim())])) as Sections['stacks']), reload()))}
          >
            Save
          </Button>
          <Message message={stackAction.message} />
        </div>
      </Card>
    </>
  );
}
