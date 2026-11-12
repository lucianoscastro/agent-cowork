import { useState } from 'react';
import type { AssetFile, SettingsResponse } from '../api';
import { useT } from '../i18n';
import { Badge, Loading, PageHeader, useFetch } from '../ui';

const Source = ({ source }: { source: string }) => (source === 'default' ? <Badge tone="ok">default</Badge> : <Badge tone="info">custom mount</Badge>);

const GROUPS: { id: AssetFile['group']; title: string; strip: string }[] = [
  { id: 'instructions', title: 'Global instructions', strip: '' },
  { id: 'prompts', title: 'Prompts (SCOPED)', strip: 'prompts/' },
  { id: 'skills', title: 'Skills', strip: 'skills/' },
];

/** Groups file names by their first folder (the agent for prompts, the skill for skills). */
function byFolder(files: AssetFile[], strip: string): [string, AssetFile[]][] {
  const folders = new Map<string, AssetFile[]>();
  for (const f of files) {
    const rel = f.name.slice(strip.length);
    const folder = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '';
    folders.set(folder, [...(folders.get(folder) ?? []), f]);
  }
  return [...folders];
}

/** The shipped instructions, prompts and skills; `only` narrows them to one folder (an agent's prompts). */
export function Assets({ only }: { only?: string }) {
  const t = useT();
  const { data, error: loadError, reload } = useFetch<SettingsResponse>('/settings');
  const [picked, setPicked] = useState<string>();
  const files = data?.assets.files.filter((f) => !only || f.name.startsWith(only)) ?? [];
  const selected = picked ?? files[0]?.name ?? 'AGENTS.md';
  const setSelected = setPicked;
  const { data: file, error } = useFetch<{ name: string; source: string; path: string; text: string }>(data ? `/assets/file?name=${encodeURIComponent(selected)}` : null);
  if (!data) return <Loading error={loadError} retry={reload} />;

  return (
    <>
      {!only && <PageHeader title="Instructions" />}
      <p className="muted">
        {t("Shipped with the image and versioned with the product. They can't be changed here by design.")}{' '}
        {t('To replace one, mount your own file read-only in the compose file, under:')} <code>/overrides</code>
      </p>
      <div className="assets">
        <nav className="card asset-list" aria-label={t('Instructions, prompts and skills')}>
          {GROUPS.map((g) => {
            const inGroup = files.filter((f) => f.group === g.id);
            if (!inGroup.length) return null;
            const custom = inGroup.some((f) => f.source !== 'default');
            return (
              <section key={g.id}>
                <h2>
                  {t(g.title)} <Source source={custom ? 'custom' : 'default'} />
                </h2>
                {byFolder(inGroup, g.strip).map(([folder, list]) => (
                  <div key={folder} className="asset-folder">
                    {folder && <h3>{folder}</h3>}
                    {list.map((f) => {
                      const rel = f.name.slice(g.strip.length + (folder ? folder.length + 1 : 0));
                      return (
                        <button
                          key={f.name}
                          type="button"
                          className={`asset-item${f.name === selected ? ' active' : ''}`}
                          aria-current={f.name === selected}
                          onClick={() => setSelected(f.name)}
                        >
                          <span>{rel}</span>
                          {f.source !== 'default' && <Badge tone="info">custom</Badge>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </section>
            );
          })}
        </nav>
        <section className="card asset-view">
          <header className="card-head">
            <h2>
              <code>{selected}</code>
            </h2>
            {file?.name === selected && <Source source={file.source} />}
          </header>
          {error ? (
            <p className="message bad">{error}</p>
          ) : file?.name === selected ? (
            <>
              <p className="muted small">
                <code>{file.path}</code>
              </p>
              <pre className="log">{file.text}</pre>
            </>
          ) : (
            <p className="muted">{t('Loading…')}</p>
          )}
        </section>
      </div>
    </>
  );
}
