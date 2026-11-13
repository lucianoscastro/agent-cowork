import { useState } from 'react';
import { api, AUDIT_CATEGORIES, type AuditCategory } from '../api';
import { type T, useT } from '../i18n';
import { Badge, Button, Card, Empty, Field, Loading, Mark, PageHeader, Select, Time, type Tone, useFetch } from '../ui';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type Verdict = 'block' | 'fix_first' | 'review' | 'clear';
type AuditSummary = { runId: number; at: string; dryRun: boolean; category: AuditCategory; base: string; sha: string; verdict: Verdict; counts: Record<Severity, number> };
type RepoAudits = { project: string; repo: string; audits: AuditSummary[] };
type Finding = {
  index: number;
  check: string;
  severity: Severity;
  title: string;
  where: string;
  evidence: string;
  impact: string;
  fix: string;
  acceptance: string[];
  change: 'new' | 'open' | 'first';
  card: { key: string; url: string } | null;
};
type Detail = {
  runId: number;
  repo: string;
  category: AuditCategory;
  verdictLabel: string;
  base: string;
  sha: string;
  previousRunId: number | null;
  audit: { verdict: Verdict; summary: string; stack: string; strengths: string[]; limitations: string[]; manualActions: string[] };
  findings: Finding[];
  fixed: Omit<Finding, 'index' | 'change' | 'card'>[];
};

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const CATEGORY_NAMES = Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c.id, c.name])) as Record<AuditCategory, string>;
const RANK: Verdict[] = ['block', 'fix_first', 'review', 'clear'];
/** Security keeps its ship/no-ship wording; the other categories speak of issues (as in agents/auditor.ts). */
const verdictLabel = (t: T, category: AuditCategory, v: Verdict) =>
  t(
    (category === 'security'
    ? { block: 'Do not ship', fix_first: 'Fix before shipping', review: 'Review pending', clear: 'No confirmed blocker' }
    : { block: 'Critical issues', fix_first: 'Fix soon', review: 'Review pending', clear: 'No confirmed issue' })[v],
  );
const VERDICT_TONES: Record<Verdict, Tone> = { block: 'bad', fix_first: 'warn', review: 'info', clear: 'ok' };

/** The latest audit of each category, and the worst verdict among them (for the repository list). */
function latestPerCategory(audits: AuditSummary[]): AuditSummary[] {
  const seen = new Set<AuditCategory>();
  return audits.filter((a) => !seen.has(a.category) && (seen.add(a.category), true));
}
const worst = (audits: AuditSummary[]) => [...audits].sort((a, b) => RANK.indexOf(a.verdict) - RANK.indexOf(b.verdict))[0];

function Sev({ s, n }: { s: Severity; n?: number }) {
  const t = useT();
  return <span className={`sev sev-${s}`}>{n === undefined ? t(s) : t(`{n} ${s}`, { n })}</span>;
}

function Counts({ counts }: { counts: Record<Severity, number> }) {
  const t = useT();
  const shown = SEVERITIES.filter((s) => counts[s] > 0);
  return shown.length ? (
    <span className="row tight">
      {shown.map((s) => (
        <Sev key={s} s={s} n={counts[s]} />
      ))}
    </span>
  ) : (
    <span className="muted small">{t('no findings')}</span>
  );
}

function FindingRow({ f, runId, category, onCard }: { f: Finding; runId: number; category: AuditCategory; onCard: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const create = async () => {
    if (!window.confirm(
        t('Create a Jira card "{title}" on the board of this repository\'s project? This writes to Jira, even in dry run.', {
          title: `[${CATEGORY_NAMES[category]}] ${f.title}`,
        }),
      )) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`/findings/audits/${runId}/findings/${f.index}/card`, { method: 'POST' });
      onCard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="finding">
      <summary>
        <Sev s={f.severity} />
        <span className="muted small">{f.check}</span>
        <span className="finding-title">{f.title}</span>
        {f.change === 'new' && <Badge tone="warn">new</Badge>}
        {f.card && (
          <a href={f.card.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {f.card.key}
          </a>
        )}
      </summary>
      <p>
        <code>{f.where}</code>
      </p>
      <pre className="log">{f.evidence}</pre>
      <p>
        <b>{t('Impact.')}</b> {f.impact}
      </p>
      <p>
        <b>{t('Fix.')}</b> {f.fix}
      </p>
      {f.acceptance.length > 0 && (
        <ul>
          {f.acceptance.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      <div className="row">
        {f.card ? (
          <a className="btn secondary" href={f.card.url} target="_blank" rel="noreferrer">
            {t('Open {key}', { key: f.card.key })}
          </a>
        ) : (
          <Button busy={busy} onClick={create}>
            Create Jira card
          </Button>
        )}
        {error && <span className="message bad">{error}</span>}
      </div>
    </details>
  );
}

function AuditView({ runId }: { runId: number }) {
  const t = useT();
  const { data, error, reload } = useFetch<Detail>(`/findings/audits/${runId}`);
  if (!data) return <Loading error={error} retry={reload} />;
  const isNew = data.findings.filter((f) => f.change === 'new').length;
  const open = data.findings.filter((f) => f.change === 'open').length;
  return (
    <>
      <Card
        title={
          <>
            <Badge tone="info">{t(CATEGORY_NAMES[data.category])}</Badge> {data.verdictLabel} <span className="muted small">{data.audit.stack}</span>
          </>
        }
        actions={
          <a className="btn secondary" href={`#/runs/${runId}`}>
            {t('Run and full report')}
          </a>
        }
      >
        <p>{data.audit.summary}</p>
        {data.previousRunId ? (
          <p className="row tight">
            {t('Since the previous audit:')} <Badge tone="warn">{t('{n} new', { n: isNew })}</Badge>{' '}
            <Badge tone="muted">{t('{n} still open', { n: open })}</Badge> <Badge tone="ok">{t('{n} fixed', { n: data.fixed.length })}</Badge>
          </p>
        ) : (
          <p className="muted small">{t('First audit of this repository; the next one shows what changed.')}</p>
        )}
      </Card>
      <Card title={t('Findings ({n})', { n: data.findings.length })}>
        {!data.findings.length ? (
          <Empty>No confirmed findings.</Empty>
        ) : (
          data.findings.map((f) => <FindingRow key={f.index} f={f} runId={runId} category={data.category} onCard={reload} />)
        )}
      </Card>
      {data.fixed.length > 0 && (
        <Card title={t('Fixed since the previous audit ({n})', { n: data.fixed.length })}>
          <ul className="plain">
            {data.fixed.map((f, i) => (
              <li key={i}>
                <Sev s={f.severity} /> <span className="muted small">{f.check}</span> {f.title} <code>{f.where}</code>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid three">
        {(
          [
            ['Strengths', data.audit.strengths],
            ['Limitations', data.audit.limitations],
            ['Manual actions for the owner', data.audit.manualActions],
          ] as const
        ).map(([title, list]) => (
          <Card key={title} title={title}>
            {list.length ? (
              <ul className="plain small">
                {list.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            ) : (
              <Empty>None.</Empty>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

export function Findings({ repo }: { repo?: string }) {
  const t = useT();
  const { data: raw, error, reload } = useFetch<RepoAudits[]>('/findings', 30_000);
  const [picked, setPicked] = useState<number>();
  const [category, setCategory] = useState<'' | AuditCategory>('');
  if (!raw) return <Loading error={error} retry={reload} />;
  const data = raw.map((r) => ({ ...r, audits: r.audits.filter((a) => !category || a.category === category) }));
  const current = data.find((r) => r.repo === repo) ?? data.find((r) => r.audits.length) ?? data[0];
  const runId = picked && current?.audits.some((a) => a.runId === picked) ? picked : current?.audits[0]?.runId;
  const projects = [...new Set(data.map((r) => r.project))];

  return (
    <>
      <PageHeader title="Findings" />
      <p className="muted">
        {t(
          "Audits of each project repository by the Auditor agent, one category at a time. Findings are matched with the previous audit of the same category by check and file. A Jira card can be created from any finding, on the board of the repository's project.",
        )}
      </p>
      <div className="row filters">
        <Field label="Category">
          <Select
            value={category}
            onChange={(c) => (setCategory(c), setPicked(undefined))}
            options={[{ value: '' as const, label: 'All' }, ...AUDIT_CATEGORIES.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Field>
      </div>
      {!data.length ? (
        <Empty>No project repositories yet. Add them under Projects.</Empty>
      ) : (
        <div className="assets">
          <nav className="card asset-list" aria-label={t('Repositories')}>
            {projects.map((p) => (
              <section key={p}>
                <h2>{p}</h2>
                {data
                  .filter((r) => r.project === p)
                  .map((r) => (
                    <a
                      key={r.repo}
                      href={`#/findings/${encodeURIComponent(r.repo)}`}
                      onClick={() => setPicked(undefined)}
                      className={`asset-item${r.repo === current?.repo ? ' active' : ''}`}
                    >
                      <span>{r.repo.split('/')[1]}</span>
                      {r.audits.length ? <Mark tone={VERDICT_TONES[worst(latestPerCategory(r.audits)).verdict]} label={verdictLabel(t, 'security', worst(latestPerCategory(r.audits)).verdict)} /> : <span className="small">—</span>}
                    </a>
                  ))}
              </section>
            ))}
          </nav>
          <section className="stack">
            {current && (
              <Card title={current.repo}>
                {!current.audits.length ? (
                  <Empty>{category
                      ? t('No {category} audit yet.', { category: t(CATEGORY_NAMES[category]) })
                      : t('Not audited yet. Enable the Auditor agent and its categories, or Run now from the overview.')}</Empty>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>{t('When')}</th>
                        <th>{t('Category')}</th>
                        <th>{t('Commit')}</th>
                        <th>{t('Verdict')}</th>
                        <th>{t('Findings')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.audits.map((a) => (
                        <tr
                          key={a.runId}
                          className={`clickable${a.runId === runId ? ' selected' : ''}`}
                          onClick={() => setPicked(a.runId)}
                          // Reachable and usable from the keyboard, like the mouse click.
                          tabIndex={0}
                          aria-selected={a.runId === runId}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setPicked(a.runId))}
                        >
                          <td>
                            <Time iso={a.at} /> {a.dryRun && <Badge tone="muted">dry run</Badge>}
                          </td>
                          <td>{t(CATEGORY_NAMES[a.category])}</td>
                          <td>
                            <code>
                              {a.base}@{a.sha.slice(0, 7)}
                            </code>
                          </td>
                          <td>
                            <Mark tone={VERDICT_TONES[a.verdict]} /> {verdictLabel(t, a.category, a.verdict)}
                          </td>
                          <td>
                            <Counts counts={a.counts} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            )}
            {runId && <AuditView key={runId} runId={runId} />}
          </section>
        </div>
      )}
    </>
  );
}
