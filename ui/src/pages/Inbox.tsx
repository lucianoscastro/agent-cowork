import { useState } from 'react';
import { type AgentId, api, type InboxItem } from '../api';
import { useT } from '../i18n';
import { AGENT_NAMES, Badge, Button, Card, Empty, Field, Message, PAGE_SIZE, PageHeader, Pager, Select, Time, useAction, useFetch } from '../ui';

const idOf = (i: InboxItem) => `${i.agent}:${i.dryRun}:${i.key}`;

/** Why an item is here, as a filter: the item's status, with paused PR follow-ups apart. */
const KINDS = {
  waiting: 'Waiting for an answer',
  human: 'Needs a human',
  watching: 'PR follow-up paused',
  failed: 'Out of retries',
} as const;

/** Long reasons (review findings, audit summaries) show their first line; the rest opens on click. */
function Reason({ text }: { text: string }) {
  const [first, ...rest] = text.split('\n');
  if (!rest.join('').trim() && first.length <= 200) return <span className="pre">{first}</span>;
  return (
    <details className="reason-more">
      <summary>{first.length > 200 ? `${first.slice(0, 200)}…` : first}</summary>
      <div className="pre">{text}</div>
    </details>
  );
}

export function Inbox() {
  const t = useT();
  const { data, reload } = useFetch<InboxItem[]>('/inbox', 10_000);
  const [agent, setAgentFilter] = useState<'' | AgentId>('');
  const [kind, setKindFilter] = useState<'' | InboxItem['status']>('');
  const [mode, setModeFilter] = useState<'' | 'live' | 'dry'>('');
  const [page, setPageNumber] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const action = useAction();
  const all = (data ?? []).filter(
    (i) => (!agent || i.agent === agent) && (!kind || i.status === kind) && (!mode || (mode === 'dry') === i.dryRun),
  );
  // An exploration finding becomes a Jira card on its project's board; the item leaves the inbox.
  const createCard = async (item: InboxItem) => {
    let created = '';
    const ok = await action.run(async () => {
      created = (await api<{ key: string }>('/inbox/card', { method: 'POST', body: { key: item.key, dryRun: item.dryRun } })).key;
      await reload();
    });
    if (ok) action.setMessage({ tone: 'ok', text: t('Created {key}', { key: created }) });
  };
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = all.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(idOf(r)));
  const someSelected = rows.some((r) => selected.has(idOf(r)));
  // A page change clears the selection, so a removal never includes items out of sight.
  const setPage = (p: number) => (setPageNumber(p), setSelected(new Set()));
  // Changing a filter also clears the selection and goes back to the first page.
  const filter = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(0));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));

  const remove = async () => {
    const chosen = all.filter((i) => selected.has(idOf(i)));
    if (!window.confirm(t('Remove {n} item(s) from the inbox? Their agents stop handling them (see above).', { n: chosen.length }))) return;
    await action.run(async () => {
      await api('/inbox/dismiss', { method: 'POST', body: { items: chosen.map(({ agent, key, dryRun }) => ({ agent, key, dryRun })) } });
      setSelected(new Set());
      await reload();
    }, 'Removed');
  };

  return (
    <>
      <PageHeader title="Inbox" />
      <p className="muted">
        {t(
          'Cards waiting for an answer or parked by a gate resume when someone comments on the card; open PRs the developer gave up on resume when someone comments on the PR. Dependabot PRs here need a human review, and audits here (any category) have critical or high findings (the link opens the report). Sentinel findings from exploration wait here:',
        )}{' '}
        <b>{t('Create card')}</b> {t("files one on its project's board.")} <b>{t('Retry')}</b> {t('makes the agent pick the item up again on its next poll.')}{' '}
        <b>{t('Remove')}</b> {t('marks it handled: the agent stops waiting on the card, stops following the PR, or skips that Dependabot commit; a repository is audited again only after new commits.')}
      </p>
      <Card>
        <div className="row filters">
          <Field label="Agent">
            <Select
              value={agent}
              onChange={filter(setAgentFilter)}
              options={[{ value: '', label: 'All' }, ...Object.entries(AGENT_NAMES).map(([value, label]) => ({ value: value as AgentId, label }))]}
            />
          </Field>
          <Field label="Why">
            <Select
              value={kind}
              onChange={filter(setKindFilter)}
              options={[{ value: '', label: 'All' }, ...Object.entries(KINDS).map(([value, label]) => ({ value: value as InboxItem['status'], label }))]}
            />
          </Field>
          <Field label="Mode">
            <Select
              value={mode}
              onChange={filter(setModeFilter)}
              options={[{ value: '', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'dry', label: 'Dry run' }]}
            />
          </Field>
          <span className="spacer" />
          <Button variant="danger" disabled={selected.size === 0} busy={action.busy} onClick={remove}>
            {t('Remove selected ({n})', { n: selected.size })}
          </Button>
        </div>
        <Message message={action.message} />
        {!rows.length ? (
          <Empty>{data?.length ? 'Nothing matches these filters.' : 'Nothing waiting for a human.'}</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={t('Select all items on this page')}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(idOf)))}
                  />
                </th>
                <th>{t('Agent')}</th>
                <th>{t('Item')}</th>
                <th>{t('Why')}</th>
                <th>{t('Since')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const url = typeof item.data.url === 'string' ? item.data.url : undefined;
                return (
                  <tr key={idOf(item)}>
                    <td>
                      <input type="checkbox" aria-label={t('Select {key}', { key: item.key })} checked={selected.has(idOf(item))} onChange={() => toggle(idOf(item))} />
                    </td>
                    <td>
                      {AGENT_NAMES[item.agent]} {item.dryRun && <Badge tone="muted">dry run</Badge>}
                    </td>
                    <td>{url ? <a href={url} target="_blank" rel="noreferrer">{String(item.data.title ?? item.key)}</a> : String(item.data.title ?? item.key)}</td>
                    <td>
                      <Reason text={String(item.data.reason ?? (item.status === 'failed' ? t('Failed: {error}', { error: String(item.data.error ?? '') }) : item.status === 'waiting' ? t('Waiting for an answer on the card') : t('Needs a human')))} />
                    </td>
                    <td>
                      <Time iso={item.updatedAt} />
                    </td>
                    <td>
                      {item.data.card ? (
                        <Button onClick={() => createCard(item)}>Create card</Button>
                      ) : (
                        <Button onClick={() => api('/inbox/retry', { method: 'POST', body: { agent: item.agent, key: item.key, dryRun: item.dryRun } }).then(reload)}>
                          Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pager page={current} hasNext={current < pages - 1} onPage={setPage} />
      </Card>
    </>
  );
}
