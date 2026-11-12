import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type AgentId, api, CHANGED, type Overview, setUnauthorizedHandler } from './api';
import { Activity } from './pages/Activity';
import { AgentPage, TeamPage } from './pages/Agents';
import { Brain } from './pages/Brain';
import { Accounts } from './pages/Accounts';
import { Assets } from './pages/Assets';
import { Findings } from './pages/Findings';
import { General } from './pages/General';
import { Home } from './pages/Home';
import { Inbox } from './pages/Inbox';
import { Login } from './pages/Login';
import { Projects } from './pages/Projects';
import { RunDetailPage, Runs } from './pages/Runs';
import { Usage } from './pages/Usage';
import { LanguagePicker, LocaleProvider, useT } from './i18n';
import { applyTheme, ThemeToggle } from './theme';
import { AGENT_NAMES, hasUnsaved, needsAttention, useFetch } from './ui';
import './styles.css';

/** The groups of the global nav and the pages of each, in the frosted sub-nav. */
const GROUPS = [
  { id: 'home', label: 'Home', pages: [{ path: '', label: 'Today' }] },
  {
    id: 'work',
    label: 'Work',
    pages: [{ path: 'inbox', label: 'Inbox' }, { path: 'runs', label: 'Runs' }, { path: 'findings', label: 'Findings' }, { path: 'brain', label: 'Brain' }, { path: 'usage', label: 'Usage' }],
  },
  { id: 'team', label: 'Team', pages: [{ path: 'agents', label: 'All agents' }, ...(Object.keys(AGENT_NAMES) as AgentId[]).map((id) => ({ path: `agents/${id}`, label: AGENT_NAMES[id] }))] },
  {
    id: 'setup',
    label: 'Setup',
    pages: [
      { path: 'projects', label: 'Projects' },
      { path: 'accounts', label: 'Accounts' },
      { path: 'general', label: 'General' },
      { path: 'instructions', label: 'Instructions' },
      { path: 'activity', label: 'Activity' },
    ],
  },
] as const;

/** Old addresses (bookmarks, links in reports) keep working. */
const MOVED: Record<string, string> = { providers: 'accounts', integrations: 'accounts', assets: 'instructions' };

/** Hash routes (#/runs/12): no server-side routing needed. Leaving a form with unsaved edits asks first. */
function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [route, setRoute] = useState(read);
  const t = useT();
  const question = useRef('');
  question.current = t('You have unsaved changes. Leave this page and lose them?');
  useEffect(() => {
    let current = window.location.hash;
    const on = () => {
      // The hash already changed: staying puts the old address back without another hashchange.
      if (hasUnsaved() && !window.confirm(question.current)) return history.replaceState(null, '', current || '#/');
      current = window.location.hash;
      setRoute(read());
    };
    // Closing or reloading the tab: the browser shows its own question.
    const leave = (e: BeforeUnloadEvent) => {
      if (hasUnsaved()) e.preventDefault();
    };
    window.addEventListener('hashchange', on);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('beforeunload', leave);
    };
  }, []);
  return route;
}

function Page({ route }: { route: string[] }) {
  const t = useT();
  const [page, id, tab] = route;
  switch (page) {
    case undefined:
      return <Home />;
    case 'inbox':
      return <Inbox />;
    case 'runs':
      return id ? <RunDetailPage id={Number(id)} /> : <Runs />;
    case 'findings':
      return <Findings repo={id ? decodeURIComponent(id) : undefined} />;
    case 'agents':
      return id && id in AGENT_NAMES ? <AgentPage id={id as AgentId} tab={tab ?? ''} /> : <TeamPage />;
    case 'brain':
      return <Brain />;
    case 'projects':
      return <Projects />;
    case 'accounts':
      return <Accounts />;
    case 'general':
      return <General />;
    case 'instructions':
      return <Assets />;
    case 'usage':
      return <Usage />;
    case 'activity':
      return <Activity />;
    default:
      return <p>{t('Page not found.')}</p>;
  }
}

function Shell({ me, onLogout }: { me: { user: string; instance: string }; onLogout: () => void }) {
  const t = useT();
  const route = useRoute();
  const { data, reload } = useFetch<Overview>('/overview', 15_000);
  useEffect(() => {
    const refresh = () => void reload();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [reload]);
  const moved = route[0] && MOVED[route[0]];
  useEffect(() => {
    if (moved) window.location.replace(`#/${moved}`);
  }, [moved]);
  const path = route.slice(0, route[0] === 'agents' ? 2 : 1).join('/');
  const group = GROUPS.find((g) => g.pages.some((p) => p.path === path || (p.path && path.startsWith(`${p.path}/`)))) ?? GROUPS[0];
  // Phones: the groups, language, theme and log out live in a menu behind ☰; it closes on navigation or Escape.
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);
  // Phones show each table row as a block: every cell gets its column's (translated) header as a label.
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const label = () =>
      main.querySelectorAll('table').forEach((table) => {
        const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
        table.querySelectorAll('tbody tr').forEach((tr) =>
          [...tr.children].forEach((td, i) => {
            const text = heads[i] ?? '';
            if (td.getAttribute('data-label') !== text) td.setAttribute('data-label', text);
          }),
        );
      });
    label();
    // Attribute changes don't trigger it again: only new rows and new text do.
    const observer = new MutationObserver(label);
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  // The sub-nav scrolls sideways on phones: keep the current page in view.
  useEffect(() => {
    // Sideways only: scrollIntoView would also scroll the page down.
    const active = document.querySelector<HTMLElement>('.subnav a.active');
    const bar = active?.parentElement;
    if (active && bar) bar.scrollLeft = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2;
  }, [path]);
  const inbox = data?.inbox ?? 0;
  const attention = data?.agents.filter(needsAttention).length ?? 0;
  const groupLinks = (className: string) =>
    GROUPS.map((g) => (
      <a key={g.id} href={`#/${g.pages[0].path}`} className={`${className}${g.id === group.id ? ' active' : ''}`} aria-current={g.id === group.id ? 'page' : undefined}>
        {t(g.label)}
        {g.id === 'work' && inbox > 0 && (
          <span className="count" aria-label={t('{count} waiting for you', { count: inbox })}>
            {inbox}
          </span>
        )}
        {g.id === 'team' && attention > 0 && (
          <span className="count warn" aria-label={t('{n} agents need attention', { n: attention })}>
            {attention}
          </span>
        )}
      </a>
    ));
  // The tab says where you are: the page, then the instance.
  const page = group.pages.find((p) => p.path === path) ?? group.pages[0];
  useEffect(() => {
    document.title = `${t(page.label)} · ${me.instance}`;
  }, [page, t, me.instance]);
  return (
    <>
      <a href="#main" className="skip-link" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        {t('Skip to content')}
      </a>
      <header className="globalnav">
        <nav className="globalnav-inner" aria-label={t('Main')}>
          <a href="#/" className="brand">
            agentCowork<span>{me.instance}</span>
          </a>
          {groupLinks('group')}
          <span className="nav-prefs">
            <LanguagePicker />
            <ThemeToggle />
          </span>
          <button className="logout" onClick={onLogout}>
            {t('Log out {user}', { user: me.user })}
          </button>
          <button className="menu-toggle" aria-expanded={menu} aria-controls="mobile-menu" aria-label={menu ? t('Close menu') : inbox > 0 ? t('Open menu ({count} waiting for you)', { count: inbox }) : t('Open menu')} onClick={() => setMenu(!menu)}>
            {menu ? '✕' : '☰'}
            {!menu && inbox > 0 && (
              <span className="count" aria-hidden="true">
                {inbox}
              </span>
            )}
          </button>
        </nav>
        {menu && (
          <div id="mobile-menu" className="mobile-menu">
            <nav aria-label={t('Main')}>{groupLinks('mobile-group')}</nav>
            <div className="mobile-prefs">
              <LanguagePicker />
              <ThemeToggle />
            </div>
            <button className="mobile-logout" onClick={onLogout}>
              {t('Log out {user}', { user: me.user })}
            </button>
          </div>
        )}
      </header>
      {group.id !== 'home' && (
        <nav className="subnav" aria-label={t(group.label)}>
          <div className="subnav-inner">
            <span className="group-name">{t(group.label)}</span>
            {group.pages.map((p) => (
              <a key={p.path} href={`#/${p.path}`} className={p.path === path ? 'active' : ''} aria-current={p.path === path ? 'page' : undefined}>
                {t(p.label)}
              </a>
            ))}
          </div>
        </nav>
      )}
      {data && data.live.length > 0 && (
        <div className="livebar" role="status">
          <div className="livebar-inner">
            <span className="badge warn">{t('Live')}</span>
            <span>
              {t(data.live.length === 1 ? '{agents} writes to GitHub and Jira. The others run in dry run.' : '{agents} write to GitHub and Jira. The others run in dry run.', {
                agents: data.live.map((id) => AGENT_NAMES[id]).join(', '),
              })}
            </span>
          </div>
        </div>
      )}
      <main className="content" id="main" tabIndex={-1}>
        <Page route={route} />
      </main>
    </>
  );
}

function App() {
  const [me, setMe] = useState<{ user: string; instance: string } | null | undefined>();
  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    api<{ user: string; instance: string }>('/me').then(setMe, () => setMe(null));
  }, []);
  if (me === undefined) return null;
  if (me === null) return <Login onLogin={() => api<{ user: string; instance: string }>('/me').then(setMe)} />;
  return <Shell me={me} onLogout={() => api('/logout', { method: 'POST' }).then(() => setMe(null))} />;
}

applyTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
