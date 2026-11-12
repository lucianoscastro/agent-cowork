import { type AccountInfo, type AgentId } from '../api';
import { api } from '../api';
import { type T, useLocale, useT } from '../i18n';
import { AGENT_NAMES, Badge, Button, Card, Empty, formatCost, formatTokens, Loading, Message, PageHeader, PROVIDER_NAMES, Time, useAction, useFetch } from '../ui';

type Row = { calls: number; runs: number; input: number; cache: number; output: number; cost: number };
type Summary = {
  totals: { today: Row; week: Row; month: Row };
  byAgent: (Row & { agent: AgentId })[];
  byModel: (Row & { provider: string; model: string })[];
  byDay: (Row & { day: string })[];
  limits: Limits;
  accounts: Accounts;
};

type Window = { name: string; usedPercent: number; resetsAt: string | null };
type ProviderLimits = { windows: Window[]; limitedUntil: string | null; plan?: string; at: string } | null;
export type Limits = Record<keyof typeof PROVIDER_NAMES, ProviderLimits>;
export type Accounts = Record<keyof typeof PROVIDER_NAMES, AccountInfo | null>;

const NO_WINDOWS: Record<keyof typeof PROVIDER_NAMES, string> = {
  claude: 'No run has reported its limits yet.',
  codex: 'No run has reported its limits yet.',
  agy: 'No run has reported its limits yet.',
};

/** The server names windows "5 hours" or "7 days" (agy with its model group first): translated here. */
function windowLabel(t: T, name: string): string {
  // agy prefixes its model group: "Gemini Models: 5 hours".
  const m = /^(.*?)(\d+) (hours|days)$/.exec(name);
  return m ? m[1] + t(m[3] === 'hours' ? '{n} hours' : '{n} days', { n: m[2] }) : name;
}

function Meter({ w }: { w: Window }) {
  const t = useT();
  const pct = Math.min(w.usedPercent, 100);
  const tone = w.usedPercent >= 90 ? 'bad' : w.usedPercent >= 70 ? 'warn' : 'ok';
  // The window already reset after the last run reported it: its usage is from before, until the next run reports again.
  const stale = Boolean(w.resetsAt && Date.parse(w.resetsAt) <= Date.now());
  const name = windowLabel(t, w.name);
  return (
    <div className={`limit${stale ? ' stale' : ''}`}>
      <div className="limit-head">
        <span>{name}</span>
        <span className="muted">
          <b>{w.usedPercent}%</b> {t('used')}
          {w.resetsAt && (
            <>
              {' · '}
              {stale ? t('reset') : t('resets')} <Time iso={w.resetsAt} />
            </>
          )}
        </span>
      </div>
      <div className={`meter ${tone}`} role="progressbar" aria-label={t('{name} window', { name })} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Each provider's account limits as its last run reported them, and any pause after a limit was hit. */
/** compact (Home): only the providers connected or with reported limits, and a link to Usage. */
export function LimitsCard({ limits, accounts, onChange, compact }: { limits: Limits; accounts: Accounts; onChange: () => void; compact?: boolean }) {
  const t = useT();
  const action = useAction();
  const blocked = (l: ProviderLimits) => Boolean(l?.limitedUntil && Date.parse(l.limitedUntil) > Date.now());
  const paused = (Object.keys(PROVIDER_NAMES) as (keyof typeof PROVIDER_NAMES)[]).filter((id) => blocked(limits[id]));
  // One button lifts every pause at once.
  const retryAll = () => Promise.all(paused.map((id) => api(`/providers/${id}/limits/clear`, { method: 'POST' })));
  const shown = (Object.keys(PROVIDER_NAMES) as (keyof typeof PROVIDER_NAMES)[]).filter((id) => !compact || limits[id] || accounts[id]);
  return (
    <Card
      title="Account limits"
      actions={
        paused.length > 0 ? (
          <Button busy={action.busy} onClick={() => action.run(retryAll, 'Agents will try again now').then(onChange)}>
            Try again now
          </Button>
        ) : (
          compact && <a href="#/usage">{t('Usage')}</a>
        )
      }
    >
      {!shown.length && <Empty>No runtime connected yet.</Empty>}
      <div className="limits">
        {shown.map((id) => {
          const l = limits[id];
          const a = accounts[id];
          // Same identity the Accounts page shows: the email, else the API key's last characters.
          const who = a?.email ?? (a?.keyHint && t('API key {hint}', { hint: a.keyHint }));
          return (
            <section key={id} className="limit-provider">
              <h3>
                {PROVIDER_NAMES[id]} {l?.plan && <Badge tone="muted">{l.plan}</Badge>}{' '}
                {blocked(l) ? (
                  <Badge tone="bad">
                    {t('Paused · back')} <Time iso={l!.limitedUntil} />
                  </Badge>
                ) : (
                  l && <Badge tone="ok">Available</Badge>
                )}
              </h3>
              {who && (
                <p className="muted small">
                  {t('Connected as')} <b>{who}</b>
                </p>
              )}
              {l?.windows.length ? l.windows.map((w) => <Meter key={w.name} w={w} />) : <p className="muted">{t(NO_WINDOWS[id])}</p>}
              {l && (
                <p className="hint">
                  {t('Updated')} <Time iso={l.at} />
                </p>
              )}
            </section>
          );
        })}
      </div>
      {paused.length > 0 && <p className="hint">{t('Only when the limit was lifted before its reset (a reset credit, a raised spend limit or plan): otherwise the next runs fail and pause it again.')}</p>}
      <Message message={action.message} />
    </Card>
  );
}

const tokens = (r: Row) => r.input + r.cache + r.output;

function Tile({ label, row }: { label: string; row: Row }) {
  const t = useT();
  return (
    <section className="card tile">
      <p className="tile-label">{t(label)}</p>
      <p className="tile-value">{formatTokens(tokens(row))}</p>
      <p className="tile-sub">
        {row.runs === 1
          ? t('tokens · {cost} estimated · 1 run', { cost: formatCost(row.cost) })
          : t('tokens · {cost} estimated · {n} runs', { cost: formatCost(row.cost), n: row.runs })}
      </p>
    </section>
  );
}

function Table<T extends Row>({ rows, first, name }: { rows: T[]; first: string; name: (r: T) => string }) {
  const t = useT();
  if (!rows.length) return <Empty>No model calls in this period.</Empty>;
  return (
    <table>
      <thead>
        <tr>
          <th>{t(first)}</th>
          <th className="num">{t('Runs')}</th>
          <th className="num">{t('Calls')}</th>
          <th className="num">{t('Input')}</th>
          <th className="num">{t('Cache')}</th>
          <th className="num">{t('Output')}</th>
          <th className="num">{t('Total')}</th>
          <th className="num">{t('Est. cost')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={name(r)}>
            <td>{name(r)}</td>
            <td className="num">{r.runs}</td>
            <td className="num">{r.calls}</td>
            <td className="num">{formatTokens(r.input)}</td>
            <td className="num">{formatTokens(r.cache)}</td>
            <td className="num">{formatTokens(r.output)}</td>
            <td className="num">
              <b>{formatTokens(tokens(r))}</b>
            </td>
            <td className="num">{formatCost(r.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Usage() {
  const t = useT();
  const { locale } = useLocale();
  const { data, error, reload } = useFetch<Summary>('/usage', 30_000);
  if (!data) return <Loading error={error} retry={reload} />;
  return (
    <>
      <PageHeader title="Usage" />
      <p className="muted">
        {t("Tokens of every model call, from the runs' records.")} <b>{t('Input')}</b> {t('is fresh input,')} <b>{t('Cache')}</b>{' '}
        {t("is input read from or written to the provider's cache (usually much cheaper),")} <b>{t('Output')}</b> {t('is what the model wrote.')}{' '}
        {t("The cost is Claude's own estimate at API prices: on a subscription (Team, Enterprise) the bill is the subscription, and Codex and agy report no cost.")}
      </p>
      <LimitsCard limits={data.limits} accounts={data.accounts} onChange={reload} />
      <div className="tiles">
        <Tile label="Last 24 hours" row={data.totals.today} />
        <Tile label="Last 7 days" row={data.totals.week} />
        <Tile label="Last 30 days" row={data.totals.month} />
      </div>
      <Card title="By agent (30 days)">
        <Table rows={data.byAgent} first="Agent" name={(r) => AGENT_NAMES[r.agent] ?? r.agent} />
      </Card>
      <Card title="By model (30 days)">
        <Table
          rows={data.byModel}
          first="Provider · model"
          name={(r) => `${PROVIDER_NAMES[r.provider as keyof typeof PROVIDER_NAMES] ?? r.provider} · ${r.model}`}
        />
      </Card>
      <Card title="By day (14 days)">
        <Table rows={data.byDay} first="Day" name={(r) => new Date(`${r.day}T12:00:00Z`).toLocaleDateString(locale)} />
      </Card>
    </>
  );
}
