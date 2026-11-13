import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useState } from 'react';
import { api, type ProviderId, type Run } from './api';
import { type T, useLocale, useT } from './i18n';

/**
 * The shared components translate the text they are given (labels, hints, button text, titles), so pages pass
 * English and only add the translations to ./locales. Anything that isn't a plain string passes through.
 */
const tr = (t: T, node: ReactNode): ReactNode => (typeof node === 'string' ? t(node) : node);

// Edits not saved yet, one token per form that differs from what is saved: the shell asks before leaving them.
const unsaved = new Set<symbol>();
export const hasUnsaved = () => unsaved.size > 0;

/** Marks a form's draft as unsaved while it differs from the saved value (compared as JSON). */
export function useUnsaved(draft: unknown, saved: unknown) {
  const dirty = draft !== undefined && saved !== undefined && JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) return;
    const token = Symbol();
    unsaved.add(token);
    return () => void unsaved.delete(token);
  }, [dirty]);
}

/** Fetches a path, optionally re-fetching every `refreshMs` while the page is open. */
/** An agent someone turned on that is not working: off for a reason, paused at a limit, or failing its poll. */
export const needsAttention = (a: { on: boolean; reason?: string; lastError: unknown }) => (!a.on && a.reason !== 'Disabled') || (a.on && Boolean(a.lastError));

export function useFetch<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void reload();
    if (!refreshMs) return;
    const id = setInterval(() => void reload(), refreshMs);
    return () => clearInterval(id);
  }, [reload, refreshMs]);
  return { data, error, reload, setData };
}

/** Runs an async action and exposes busy/message state for a button and a status line. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | undefined>();
  const run = useCallback(async (fn: () => Promise<unknown>, okText = 'Saved') => {
    setBusy(true);
    setMessage(undefined);
    try {
      await fn();
      setMessage({ tone: 'ok', text: okText });
      return true;
    } catch (err) {
      setMessage({ tone: 'bad', text: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, message, run, setMessage };
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = useT();
  return <span className={`badge ${tone}`}>{tr(t, children)}</span>;
}

/**
 * The status mark, as on a CI checks list: a small shape in a status color. Next to words it is decoration
 * (hidden from screen readers); alone, `label` names it.
 */
export function Mark({ tone, label }: { tone: Tone | 'idle'; label?: string }) {
  return label ? <span className={`mark ${tone}`} role="img" aria-label={label} title={label} /> : <span className={`mark ${tone}`} aria-hidden="true" />;
}

export function RunStatus({ status }: { status: Run['status'] }) {
  // The status words are translated by Badge.
  const tone: Record<Run['status'], Tone> = { running: 'info', done: 'ok', failed: 'bad', killed: 'bad', parked: 'warn', waiting: 'warn' };
  return <Badge tone={tone[status]}>{status}</Badge>;
}

/**
 * A card that folds to its title line: starts open when `open` (e.g. not set up yet), then the person decides.
 * The initial state only: saving inside it does not snap it shut.
 */
export function FoldCard({ title, open, children }: { title: ReactNode; open: boolean; children: ReactNode }) {
  const t = useT();
  const [isOpen, setOpen] = useState(open);
  return (
    <details className="card accordion" open={isOpen} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <h2 className="fold-title">{tr(t, title)}</h2>
      </summary>
      {children}
    </details>
  );
}

/** Provider reasons from the server (English), with the known phrases translated: "claude: account not logged in". */
const REASON_PHRASES = ['account not logged in', 'no API key set', 'usage limit reached, paused until'];
export const reasonText = (t: T, reason = ''): string => REASON_PHRASES.reduce((s, p) => s.replace(p, t(p)), t(reason));

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{tr(t, title)}</h2>}
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Set when a page is shown as one section of another page: its header becomes a section title. */
export const Embedded = createContext(false);

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  const embedded = useContext(Embedded);
  const t = useT();
  return (
    <header className={embedded ? 'page-head section-head' : 'page-head'}>
      {embedded ? <h2 className="section-title">{t(title)}</h2> : <h1>{t(title)}</h1>}
      {children && <div className="row">{children}</div>}
    </header>
  );
}

/** Tabs as links (#/agents/developer/settings): the URL keeps the place, back and forward work. */
export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: { id: string; label: ReactNode }[] }) {
  const t = useT();
  return (
    <nav className="tabs" aria-label={t('Sections')}>
      {tabs.map((tab) => (
        <a key={tab.id} href={`#/${base}${tab.id ? `/${tab.id}` : ''}`} className={current === tab.id ? 'active' : ''} aria-current={current === tab.id ? 'page' : undefined}>
          {tr(t, tab.label)}
        </a>
      ))}
    </nav>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <button type={props.type ?? 'button'} className={`btn ${props.variant ?? 'secondary'}`} onClick={props.onClick} disabled={props.busy || props.disabled} aria-busy={props.busy || undefined}>
      {/* While busy the label is hidden, not removed, so the button keeps its name. */}
      {props.busy ? (
        <>
          <span aria-hidden="true">…</span>
          <span className="sr-only">{tr(t, props.children)}</span>
        </>
      ) : (
        tr(t, props.children)
      )}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <label className="field">
      <span className="field-label">{t(label)}</span>
      {children}
      {hint && <span className="hint">{tr(t, hint)}</span>}
    </label>
  );
}

export function Text({ value, onChange, placeholder, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  const t = useT();
  return <input type={type} value={value} placeholder={placeholder && t(placeholder)} onChange={(e) => onChange(e.target.value)} />;
}

export const Num = ({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) => (
  <input type="number" value={value} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} />
);

export function Select<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[] }) {
  const t = useT();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as V)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {t(o.label)}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const t = useT();
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{t(label)}</span>
    </label>
  );
}

/** One item per line, for lists such as verify commands or repositories. */
export const Lines = ({ value, onChange, placeholder, rows = 4 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; rows?: number }) => (
  <textarea rows={rows} value={value.join('\n')} placeholder={placeholder} onChange={(e) => onChange(e.target.value.split('\n'))} spellCheck={false} />
);

export function Message({ message }: { message?: { tone: 'ok' | 'bad'; text: string } }) {
  const t = useT();
  // Announced: a save's result or error reaches screen readers too (errors interrupt, the rest waits its turn).
  return message ? (
    <span className={`message ${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
      {t(message.text)}
    </span>
  ) : null;
}

export function Time({ iso }: { iso: string | null | undefined }) {
  const t = useT();
  const { locale } = useLocale();
  if (!iso) return <span className="muted">—</span>;
  const d = new Date(iso);
  return <time dateTime={iso} title={d.toLocaleString(locale)}>{relative(t, locale, d)}</time>;
}

/** Dates follow the language picked in the UI, not the browser's. */
function relative(t: T, locale: string, d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  // Future times (a limit's reset): how long until then; past ones: how long ago.
  if (s < -60) {
    const ahead = -s;
    if (ahead < 3600) return t('in {m} min', { m: Math.ceil(ahead / 60) });
    if (ahead < 86_400) return t('in {h} h {m} min', { h: Math.floor(ahead / 3600), m: Math.floor((ahead % 3600) / 60) });
    return d.toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  if (s < 60) return t('just now');
  if (s < 3600) return t('{m} min ago', { m: Math.floor(s / 60) });
  if (s < 86_400) return t('{h} h ago', { h: Math.floor(s / 3600) });
  return d.toLocaleDateString(locale);
}

export function duration(start: string, end: string | null): string {
  const s = Math.round(((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** 1234 -> 1.2k, 3456789 -> 3.5M. */
export const formatTokens = (n: number | undefined) =>
  !n ? '—' : n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${(n / 1_000_000).toFixed(1)}M`;
/** Estimated cost; a dash when no runtime reported one. */
export const formatCost = (usd: number | undefined) => (!usd ? '—' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

export const AGENT_NAMES = { approver: 'Approver', dependabot: 'Dependabot', developer: 'Developer', auditor: 'Auditor', sentinel: 'Sentinel', documenter: 'Documenter' } as const;
/** One line per agent: what it does, for cards and headers. */
export const AGENT_SUMMARY = {
  approver: 'Reviews PRs that request your review directly; approves when there is nothing to suggest.',
  dependabot: 'Merges green patch and minor Dependabot PRs; sends the rest to a person.',
  developer: 'Turns agent-ready Jira cards into verified PRs and keeps them green until they close.',
  auditor: 'Audits each repository by category (security, privacy, performance…) when its code moves.',
  sentinel: "Runs each test environment's end-to-end suite, reproduces real failures and files them as bugs.",
  documenter: "Documents each repository's architecture, business rules and flows, with diagrams, as a pull request.",
} as const;
export const PROVIDER_NAMES ={ claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity (agy)' } as const;

export const PAGE_SIZE = 10;

/** Previous/next paging for lists fetched with `limit = PAGE_SIZE + 1`; the extra row means a next page exists. */
export function Pager({ page, hasNext, onPage }: { page: number; hasNext: boolean; onPage: (page: number) => void }) {
  const t = useT();
  if (page === 0 && !hasNext) return null;
  return (
    <div className="row pager">
      <Button disabled={page === 0} onClick={() => onPage(page - 1)}>
        {`← ${t('Previous')}`}
      </Button>
      <span className="muted">{t('Page {n}', { n: page + 1 })}</span>
      <Button disabled={!hasNext} onClick={() => onPage(page + 1)}>
        {`${t('Next')} →`}
      </Button>
    </div>
  );
}

/**
 * What a page shows before its data arrives: a loading line, or the error with a way to try again. A failed
 * refresh of data already shown keeps the data on screen instead.
 */
export function Loading({ error, retry }: { error?: string; retry?: () => void }) {
  const t = useT();
  if (error) {
    return (
      <div className="card load-error" role="alert">
        <p>{t('This page could not be loaded: {error}', { error })}</p>
        {retry && <Button onClick={retry}>Try again</Button>}
      </div>
    );
  }
  return (
    <p className="muted loading" role="status" aria-live="polite">
      {t('Loading…')}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  const t = useT();
  return <p className="empty">{tr(t, children)}</p>;
}

type ModelList = { models: { id: string; label: string }[]; error?: string };
// Shared by every model field of a page; keyed by the provider's connection, so a new login lists again.
const modelLists = new Map<string, Promise<ModelList>>();

/** Model field that suggests the models the provider's account can use, and still accepts any id. */
export function ModelInput({
  provider,
  value,
  onChange,
  placeholder = 'provider default',
  connection = '',
  ready = true,
}: {
  provider: ProviderId;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Changes when the account is connected again (e.g. its connection date), so the list is fetched anew. */
  connection?: string;
  /** False while the provider is not connected: no model list to ask for, so no error to show. */
  ready?: boolean;
}) {
  const t = useT();
  const listId = useId();
  const [list, setList] = useState<ModelList>();
  useEffect(() => {
    if (!ready) return setList(undefined);
    const key = `${provider}:${connection}`;
    if (!modelLists.has(key)) {
      const fetching = api<ModelList>(`/providers/${provider}/models`).catch((e) => ({ models: [], error: (e as Error).message }));
      modelLists.set(key, fetching);
      // An error (not connected yet, a bad token) is not kept: the next render asks again.
      void fetching.then((l) => l.error && modelLists.delete(key));
    }
    let live = true;
    void modelLists.get(key)!.then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [provider, connection, ready]);
  return (
    <>
      <input list={listId} value={value} placeholder={t(placeholder)} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>
        {list?.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </datalist>
      {list && (
        <span className="hint">
          {list.error ? t('Model list unavailable: {error}', { error: list.error }) : t('{n} models available to this account; any id is accepted.', { n: list.models.length })}
        </span>
      )}
    </>
  );
}
