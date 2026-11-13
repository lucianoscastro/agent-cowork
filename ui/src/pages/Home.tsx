import { api, type Overview, type SettingsResponse } from '../api';
import { AGENT_NAMES, Badge, Button, Card, duration, Empty, Loading, Mark, needsAttention, reasonText, RunStatus, Time, type Tone, useFetch } from '../ui';
import { useT } from '../i18n';
import { type Accounts, type Limits, LimitsCard } from './Usage';

/** What is still missing before agents can work; empty once the instance is set up. */
function setupSteps(s: SettingsResponse) {
  const projects = s.sections.projects.items;
  return [
    { done: s.secrets['github.token'], text: 'Connect GitHub: the token of the user the agents act as', href: '#/accounts' },
    { done: Object.values(s.providers).some((p) => p.ready), text: 'Sign in to at least one agent runtime (Claude Code, Codex or agy)', href: '#/accounts' },
    { done: projects.some((p) => Object.keys(p.repos).length > 0), text: 'Add a project with its repositories', href: '#/projects' },
    { done: Object.values(s.agents).some((a) => a.on), text: 'Enable an agent, in dry run first', href: '#/agents' },
  ];
}

export function Home() {
  const t = useT();
  const { data, error, reload } = useFetch<Overview>('/overview', 5000);
  const { data: settings } = useFetch<SettingsResponse>('/settings');
  const { data: usage, reload: reloadUsage } = useFetch<{ limits: Limits; accounts: Accounts }>('/usage', 60_000);
  if (!data) return <Loading error={error} retry={reload} />;
  const steps = settings ? setupSteps(settings) : [];
  return (
    <>
      <header className="hero">
        <h1>{t('Today')}</h1>
        <span className="muted">{data.running.length ? t('{n} running now', { n: data.running.length }) : t('Nothing running now')}</span>
      </header>

      {steps.some((s) => !s.done) && (
        <Card title="Set up">
          <ol className="checklist">
            {steps.map((s) => (
              <li key={s.text}>
                <Mark tone={s.done ? 'ok' : 'idle'} label={s.done ? t('done') : t('to do')} />
                {s.done ? <span className="muted">{t(s.text)}</span> : <a href={s.href}>{t(s.text)}</a>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <section className={`card needs-you${data.inbox ? '' : ' quiet'}`}>
        <div>
          <p className="big">{data.inbox ? t('{count} waiting for you', { count: data.inbox }) : t('Nothing needs you')}</p>
          <p className="muted">
            {data.inbox ? t('Questions, parked runs, PRs and findings that need a decision.') : t('The agents will bring anything that needs a decision here.')}
            {data.following > 0 &&
              ` ${data.following > 1 ? t('The Developer follows {n} cards with open PRs.', { n: data.following }) : t('The Developer follows 1 card with open PRs.')}`}
          </p>
        </div>
        {data.inbox > 0 && (
          <a className="btn primary" href="#/inbox">
            {t('Open the inbox')}
          </a>
        )}
      </section>


      {data.running.length > 0 && (
        <Card title="Running now">
          <table>
            <tbody>
              {data.running.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`#/runs/${r.id}`}>#{r.id}</a>
                  </td>
                  <td>{AGENT_NAMES[r.agent]}</td>
                  <td>{r.title ?? r.item}</td>
                  <td className="muted">{r.stage}</td>
                  <td className="num">{duration(r.started_at, null)}</td>
                  <td className="num">
                    <Button variant="danger" onClick={() => window.confirm(t('Stop run #{id}?', { id: r.id })) && api(`/runs/${r.id}/kill`, { method: 'POST' }).then(reload)}>
                      Stop
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Team" actions={<a href="#/agents">{t('All agents')}</a>}>
        {/* One line per agent, like a CI checks list: mark, name, what it is doing or why not, last poll. */}
        <ul className="checks">
          {data.agents.map((a) => {
            const tone: Tone | 'idle' = a.on ? (a.lastError ? 'bad' : 'ok') : needsAttention(a) ? 'warn' : 'idle';
            const state = a.polling
              ? t('working')
              : a.on
                ? a.lastError
                  ? t('Last poll failed: {error}', { error: a.lastError.message })
                  : t(data.live.includes(a.id) ? 'live' : 'dry run')
                : a.reason === 'Disabled'
                  ? t('off')
                  : reasonText(t, a.reason);
            return (
              <li key={a.id}>
                <a className="check" href={`#/agents/${a.id}`}>
                  <Mark tone={tone} />
                  <span className="check-name">{AGENT_NAMES[a.id]}</span>
                  <span className={`check-state ${tone}`}>{state}</span>
                  <span className="check-time">
                    <Time iso={a.lastPoll} />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Recent runs" actions={<a href="#/runs">{t('All runs')}</a>}>
        {data.recent.length === 0 ? (
          <Empty>No runs yet.</Empty>
        ) : (
          <table>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`#/runs/${r.id}`}>#{r.id}</a>
                  </td>
                  <td>{AGENT_NAMES[r.agent]}</td>
                  <td>{r.title ?? r.item}</td>
                  <td>
                    <RunStatus status={r.status} /> {r.dry_run ? <Badge tone="muted">dry run</Badge> : null}
                  </td>
                  <td className="clip muted">{r.summary || r.error}</td>
                  <td className="num">
                    <Time iso={r.started_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {usage && <LimitsCard limits={usage.limits} accounts={usage.accounts} onChange={reloadUsage} compact />}
    </>
  );
}
