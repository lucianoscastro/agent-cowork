import { useEffect, useState } from 'react';
import { useLocale, useT } from '../i18n';
import { type AccountInfo, api, clearSecret, type LoginState, type ProviderId, saveSection, setSecret, type SettingsResponse } from '../api';
import { Badge, Button, Card, Field, FoldCard, Loading, Message, ModelInput, PageHeader, PROVIDER_NAMES, reasonText, Select, Text, useAction, useFetch, useUnsaved } from '../ui';

const NOTES: Record<ProviderId, { apiKey: string; account: string }> = {
  claude: {
    apiKey: 'Anthropic Console API key.',
    account: 'Claude subscription (Pro, Max, Team or Enterprise) through `claude setup-token`: open the link, sign in, paste the code shown back here.',
  },
  codex: {
    apiKey: 'OpenAI API key.',
    account: 'ChatGPT account through the browser sign-in (works where device codes are disabled): sign in, then paste back the address the browser is sent to.',
  },
  agy: {
    apiKey: 'Gemini API key (Google AI Studio or Gemini for business). Experimental.',
    account: 'Google account. Note: Google’s terms do not permit personal accounts in third-party tools like this and may suspend them; business or Enterprise accounts follow your admin’s terms. After opening the link you have 60 seconds to paste the code (a limit of the agy CLI). Experimental.',
  },
};

function LoginFlow({ provider, onDone }: { provider: ProviderId; onDone: () => void }) {
  const t = useT();
  const [state, setState] = useState<LoginState | null>(null);
  const [code, setCode] = useState('');
  const action = useAction();
  // Resume a login still in progress on the server (for example after a page reload).
  useEffect(() => {
    api<LoginState | null>(`/providers/${provider}/login`).then((s) => {
      if (s && !['done', 'failed'].includes(s.status)) setState(s);
    });
  }, [provider]);
  useEffect(() => {
    if (!state || ['done', 'failed'].includes(state.status)) return;
    const id = setInterval(async () => {
      const next = await api<LoginState | null>(`/providers/${provider}/login`);
      setState(next);
      if (next?.status === 'done') onDone();
    }, 2000);
    return () => clearInterval(id);
  }, [state, provider, onDone]);

  if (!state) {
    return (
      <Button variant="primary" onClick={() => api<LoginState>(`/providers/${provider}/login`, { method: 'POST' }).then(setState)}>
        Connect account
      </Button>
    );
  }
  return (
    <div className="login-flow">
      {state.status === 'starting' && <p className="muted">{t('Starting login…')}</p>}
      {state.url && state.status === 'paste-code' && (
        <p>
          {t('1. Open')}{' '}
          <a href={state.url} target="_blank" rel="noreferrer">
            {t('the sign-in page')}
          </a>{' '}
          {t('and sign in with the account this instance should use.')}
        </p>
      )}
      {state.status === 'paste-code' && (
        <div className="row fields">
          <Field
            label={state.paste === 'callback-url' ? '2. Paste the address the browser was sent to' : '2. Paste the code the browser shows'}
            hint={
              state.paste === 'callback-url'
                ? 'After you sign in, the browser opens a page on 127.0.0.1:1455 that does not load. That is expected: copy the whole address from the address bar.'
                : undefined
            }
          >
            <Text value={code} onChange={setCode} placeholder={state.paste === 'callback-url' ? 'http://127.0.0.1:1455/auth/callback?code=…' : ''} />
          </Field>
          <Button
            variant="primary"
            busy={action.busy}
            disabled={!code}
            onClick={() => action.run(async () => setState(await api<LoginState>(`/providers/${provider}/login/code`, { method: 'POST', body: { code } })), 'Code sent')}
          >
            Send code
          </Button>
        </div>
      )}
      {state.status === 'finishing' && (
        <p className="muted">
          {t('Finishing login…')}
          {state.message && state.message !== 'Code sent, finishing login…' && <span className="pre small"> {t('The CLI says: {message}', { message: state.message })}</span>}
        </p>
      )}
      {state.status === 'done' && <p className="message ok">{state.message}</p>}
      {state.status === 'failed' && <p className="message bad pre">{state.message}</p>}
      <Message message={action.message} />
      {!['done'].includes(state.status) && (
        <Button onClick={() => api(`/providers/${provider}/login`, { method: 'DELETE' }).then(() => setState(null))}>Cancel</Button>
      )}
    </div>
  );
}

const day = (locale: string, iso?: string) => (iso ? new Date(iso).toLocaleDateString(locale) : undefined);

/** Who the runtime is connected as: what the stored login or key can tell, never the secret itself. */
function Account({ info }: { info: AccountInfo }) {
  const t = useT();
  const { locale } = useLocale();
  const who = info.email ? `${info.email}${info.name ? ` (${info.name})` : ''}` : info.keyHint ? t('API key {hint}', { hint: info.keyHint }) : undefined;
  const facts = [
    info.plan,
    day(locale, info.since) && t('connected {date}', { date: day(locale, info.since)! }),
    // The server's label is English ('token valid until', 'subscription until'): translated like any text.
    day(locale, info.until) && `${t(info.untilLabel ?? 'until')} ${day(locale, info.until)}`,
  ].filter(Boolean);
  return (
    <div className="account">
      {who && (
        <p>
          {t('Connected as')} <b>{who}</b>
        </p>
      )}
      {info.organization && (
        <p>
          {t('Organization ID')} <code>{info.organization}</code>
        </p>
      )}
      {facts.length > 0 && <p className="muted small">{facts.join(' · ')}</p>}
      {info.note && <p className="muted small">{info.note}</p>}
    </div>
  );
}

function ProviderCard({ id, settings, reload }: { id: ProviderId; settings: SettingsResponse; reload: () => void }) {
  const t = useT();
  const section = settings.sections[`providers.${id}`];
  const [authMethod, setAuthMethod] = useState(section.authMethod);
  const [defaultModel, setDefaultModel] = useState(section.defaultModel);
  const [apiKey, setApiKey] = useState('');
  useUnsaved({ authMethod, defaultModel, apiKey }, { authMethod: section.authMethod, defaultModel: section.defaultModel, apiKey: '' });
  const status = settings.providers[id];
  const action = useAction();
  const { setMessage } = action;
  // A "Disconnected" note belongs to the moment it happened: it goes once the account is connected again.
  useEffect(() => {
    if (status.ready) setMessage(undefined);
  }, [status.ready, setMessage]);
  const keyName = `providers.${id}.apiKey`;
  const savedMethod = section.authMethod;

  return (
    <FoldCard
      open={!status.ready}
      title={
        <>
          {PROVIDER_NAMES[id]} {status.ready ? <Badge tone="ok">connected</Badge> : <Badge tone="warn">not connected</Badge>}{' '}
          {status.account?.email && <span className="muted small">{status.account.email}</span>}
        </>
      }
    >
      {!status.ready && <p className="reason">{reasonText(t, status.reason)}</p>}
      {status.ready && status.account && <Account info={status.account} />}
      <div className="row fields">
        <Field label="Authentication" hint="How this instance signs in to the runtime.">
          <Select
            value={authMethod}
            onChange={setAuthMethod}
            options={[{ value: 'account', label: 'Account login' }, { value: 'api-key', label: 'API key' }]}
          />
        </Field>
        <Field label="Default model" hint="Used when an agent does not pick one.">
          <ModelInput provider={id} value={defaultModel} onChange={setDefaultModel} placeholder="CLI default" connection={`${status.ready}:${status.account?.since ?? ''}`} ready={status.ready} />
        </Field>
        <Button
          variant="primary"
          busy={action.busy}
          onClick={() => action.run(async () => (await saveSection(`providers.${id}`, { authMethod, defaultModel }), reload()))}
        >
          Save
        </Button>
      </div>
      <p className="muted small">{t(authMethod === 'api-key' ? NOTES[id].apiKey : NOTES[id].account)}</p>
      {savedMethod !== authMethod && <p className="hint">{t('Save to switch the authentication method.')}</p>}
      {savedMethod === 'api-key' && authMethod === 'api-key' && (
        <div className="row fields">
          <Field label="API key" hint={settings.secrets[keyName] ? 'A key is stored. Enter a new one to replace it.' : 'Stored encrypted; never shown again.'}>
            <Text type="password" value={apiKey} onChange={setApiKey} placeholder={settings.secrets[keyName] ? '••••••••' : ''} />
          </Field>
          <Button variant="primary" disabled={!apiKey} onClick={() => action.run(async () => (await setSecret(keyName, apiKey), setApiKey(''), reload()))}>
            Store key
          </Button>
          {settings.secrets[keyName] && (
            <Button variant="danger" onClick={() => action.run(async () => (await clearSecret(keyName), reload()), 'Removed')}>
              Remove key
            </Button>
          )}
        </div>
      )}
      {savedMethod === 'account' && authMethod === 'account' &&
        (status.ready ? (
          <div className="row">
            <Button
              variant="danger"
              busy={action.busy}
              onClick={() =>
                confirm(t('Disconnect the {provider} account? Agents using it stop until you connect again.', { provider: PROVIDER_NAMES[id] })) &&
                action.run(async () => (await api(`/providers/${id}/account`, { method: 'DELETE' }), reload()), 'Disconnected')
              }
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <LoginFlow provider={id} onDone={reload} />
        ))}
      {action.message && (
        <p className="message-line">
          <Message message={action.message} />
        </p>
      )}
    </FoldCard>
  );
}

export function Providers() {
  const t = useT();
  const { data, error, reload } = useFetch<SettingsResponse>('/settings');
  if (!data) return <Loading error={error} retry={reload} />;
  return (
    <>
      <PageHeader title="Agent runtimes" />
      <p className="muted">
        {t(
          'The agent runtimes. Each one gets only its own credential, never the GitHub or Jira ones. Account logins are stored in the persistent auth volume; API keys are stored encrypted in the database.',
        )}
      </p>
      {(Object.keys(PROVIDER_NAMES) as ProviderId[]).map((id) => (
        <ProviderCard key={`${id}-${data.sections[`providers.${id}`].authMethod}`} id={id} settings={data} reload={reload} />
      ))}
    </>
  );
}
