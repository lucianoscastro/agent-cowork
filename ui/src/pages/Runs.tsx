import { useEffect, useRef, useState } from 'react';
import { type AgentId, api, type Run, type RunDetail } from '../api';
import { useLocale, useT } from '../i18n';
import { AGENT_NAMES, Badge, Button, Card, duration, Empty, Field, formatCost, formatTokens, Loading, Message, PAGE_SIZE, PageHeader, Pager, RunStatus, Select, Time, type Tone, useAction, useFetch } from '../ui';

export function Runs() {
  const t = useT();
  const [agent, setAgentFilter] = useState<'' | AgentId>('');
  const [status, setStatusFilter] = useState('');
  const [page, setPageNumber] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // One extra row tells whether a next page exists.
  const query = new URLSearchParams({ limit: String(PAGE_SIZE + 1), offset: String(page * PAGE_SIZE), ...(agent ? { agent } : {}), ...(status ? { status } : {}) });
  const { data, reload } = useFetch<Run[]>(`/runs?${query}`, 10_000);
  const action = useAction();
  const rows = data?.slice(0, PAGE_SIZE) ?? [];
  const hasNext = (data?.length ?? 0) > PAGE_SIZE;
  const selectable = rows.filter((r) => r.status !== 'running').map((r) => r.id);
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));
  const someSelected = selectable.some((id) => selected.has(id));

  // Changing page or filters clears the selection, so a delete never includes runs out of sight.
  const setPage = (p: number) => (setPageNumber(p), setSelected(new Set()));
  const setAgent = (v: '' | AgentId) => (setAgentFilter(v), setPage(0));
  const setStatus = (v: string) => (setStatusFilter(v), setPage(0));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable));

  const remove = async (filter: { ids: number[] }) => {
    const { count } = await api<{ count: number }>('/runs/delete', { method: 'POST', body: { ...filter, preview: true } });
    if (count === 0) return action.setMessage({ tone: 'bad', text: 'No finished runs match.' });
    if (!window.confirm(t('Delete {n} run(s) with their logs and transcripts? This cannot be undone.', { n: count }))) return;
    await action.run(async () => {
      const { deleted } = await api<{ deleted: number }>('/runs/delete', { method: 'POST', body: filter });
      setSelected(new Set());
      await reload();
      return deleted;
    }, 'Deleted');
  };

  const toggle = (id: number) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));

  return (
    <>
      <PageHeader title="Runs" />
      <Card>
        <div className="row filters">
          <Field label="Agent">
            <Select
              value={agent}
              onChange={setAgent}
              options={[{ value: '', label: 'All' }, ...Object.entries(AGENT_NAMES).map(([value, label]) => ({ value: value as AgentId, label }))]}
            />
          </Field>
          <Field label="Status">
            <Select
              value={status}
              onChange={setStatus}
              options={['', 'running', 'done', 'waiting', 'parked', 'failed', 'killed'].map((s) => ({ value: s, label: s || 'All' }))}
            />
          </Field>
          <span className="spacer" />
          <Button variant="danger" disabled={selected.size === 0} onClick={() => remove({ ids: [...selected] })}>
            {t('Delete selected ({n})', { n: selected.size })}
          </Button>
        </div>
        <Message message={action.message} />
        {!rows.length ? (
          <Empty>{page > 0 ? 'No more runs.' : 'No runs.'}</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={t('Select all runs on this page')}
                    disabled={selectable.length === 0}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={toggleAll}
                  />
                </th>
                <th>{t('Run')}</th>
                <th>{t('Agent')}</th>
                <th>{t('Item')}</th>
                <th>{t('Status')}</th>
                <th>{t('Result')}</th>
                <th>{t('Started')}</th>
                <th>{t('Took')}</th>
                <th className="num">{t('Tokens')}</th>
                <th className="num">{t('Est. cost')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" aria-label={t('Select run #{id}', { id: r.id })} disabled={r.status === 'running'} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td>
                    <a href={`#/runs/${r.id}`}>#{r.id}</a>
                  </td>
                  <td>{AGENT_NAMES[r.agent]}</td>
                  <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.item}</a> : r.item}</td>
                  <td>
                    <RunStatus status={r.status} /> {r.dry_run ? <Badge tone="muted">dry run</Badge> : null}
                  </td>
                  <td className="clip">{r.summary ?? r.error ?? r.stage}</td>
                  <td>
                    <Time iso={r.started_at} />
                  </td>
                  <td>{duration(r.started_at, r.ended_at)}</td>
                  <td className="num">{formatTokens(r.tokens)}</td>
                  <td className="num">{formatCost(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager page={page} hasNext={hasNext} onPage={setPage} />
      </Card>
    </>
  );
}

type LiveLine = { kind: 'say' | 'tool' | 'out' | 'err' | 'info'; text: string };

/** The run's terminal: what the agent says and runs, and the output, refreshed every 2 s while it runs. */
function LiveTerminal({ id, running }: { id: number; running: boolean }) {
  const [lines, setLines] = useState<LiveLine[]>([]);
  const next = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  // Follows new lines unless the reader scrolled up to look at something.
  const follow = useRef(true);
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const r = await api<{ lines: LiveLine[]; next: number }>(`/runs/${id}/live?after=${next.current}`).catch(() => undefined);
      if (stopped || !r) return;
      next.current = r.next;
      if (r.lines.length) setLines((l) => [...l, ...r.lines]);
    };
    void tick();
    const timer = running ? setInterval(tick, 2000) : undefined;
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id, running]);
  useEffect(() => {
    if (follow.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);
  if (!lines.length) return <Empty>{running ? 'Waiting for the agent to start…' : 'No agent output for this run.'}</Empty>;
  return (
    <div
      ref={box}
      className="terminal"
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {lines.map((l, i) => (
        <div key={i} className={`t-${l.kind}`}>
          {l.text}
        </div>
      ))}
      {running && <div className="t-cursor">▍</div>}
    </div>
  );
}

/** The timeline's event kinds, colored like the rest of the UI. */
const EVENT_TONES: Record<string, Tone> = { stage: 'info', error: 'bad', warn: 'warn', artifact: 'ok' };

export function RunDetailPage({ id }: { id: number }) {
  const { locale } = useLocale();
  const t = useT();
  const { data, error, reload } = useFetch<RunDetail>(`/runs/${id}`, 3000);
  const { data: files } = useFetch<string[]>(`/runs/${id}/files`, 5000);
  const [file, setFile] = useState<{ name: string; text: string }>();
  if (!data) return <Loading error={error} retry={reload} />;
  const open = async (name: string) => setFile({ name, text: await api<string>(`/runs/${id}/files/${name}`) });
  return (
    <>
      <PageHeader title={t('Run #{id}', { id: data.id })}>
        <a className="btn secondary" href="#/runs">
          ← {t('All runs')}
        </a>
        {data.status === 'running' && (
          <Button variant="danger" onClick={() => api(`/runs/${id}/kill`, { method: 'POST' }).then(reload)}>
            Kill run
          </Button>
        )}
      </PageHeader>
      <Card>
        <dl className="facts">
          <dt>{t('Agent')}</dt>
          <dd>{AGENT_NAMES[data.agent]}</dd>
          <dt>{t('Item')}</dt>
          <dd>{data.url ? <a href={data.url} target="_blank" rel="noreferrer">{data.item}</a> : data.item}</dd>
          <dt>{t('Status')}</dt>
          <dd>
            <RunStatus status={data.status} /> {data.dry_run ? <Badge tone="muted">dry run</Badge> : null} {data.stage}
          </dd>
          <dt>{t('Started')}</dt>
          <dd>
            <Time iso={data.started_at} /> · {duration(data.started_at, data.ended_at)}
          </dd>
          <dt>{t('Usage')}</dt>
          <dd>{t('{tokens} tokens · {cost} estimated', { tokens: formatTokens(data.tokens), cost: formatCost(data.cost) })}</dd>
          {data.summary && data.summary !== data.error && (
            <>
              <dt>{t('Result')}</dt>
              <dd className="pre">{data.summary}</dd>
            </>
          )}
          {data.error && (
            <>
              <dt>{t('Error')}</dt>
              <dd className="pre bad">{data.error}</dd>
            </>
          )}
        </dl>
      </Card>
      <Card title="Timeline">
        <ol className="timeline">
          {data.events.map((e, i) => (
            // A provider switch ("…; trying codex") is an info event that reads as a warning.
            <li key={i} className={`ev ${e.kind}${/; trying \w+$/.test(e.message) ? ' switch' : ''}`}>
              <span className="ev-time">{new Date(e.at).toLocaleTimeString(locale)}</span>
              <span className="ev-kind">
                <Badge tone={EVENT_TONES[e.kind] ?? 'muted'}>{e.kind}</Badge>
              </span>
              <span className="ev-msg">{e.message}</span>
              {e.data != null && (
                <details>
                  <summary>{t('details')}</summary>
                  <pre>{typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      </Card>
      <Card title={data.status === 'running' ? 'Live output' : 'Output'}>
        <LiveTerminal id={id} running={data.status === 'running'} />
      </Card>
      <Card title="Logs and transcripts">
        {!files?.length ? (
          <Empty>No files.</Empty>
        ) : (
          <div className="row wrap">
            {files.map((f) => (
              <Button key={f} onClick={() => open(f)}>
                {f}
              </Button>
            ))}
          </div>
        )}
        {file && (
          <>
            <h3>{file.name}</h3>
            <pre className="log">{file.text}</pre>
          </>
        )}
      </Card>
    </>
  );
}
