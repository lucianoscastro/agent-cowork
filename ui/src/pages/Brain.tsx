import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { Badge, Button, Empty, Field, Loading, PageHeader, Select, useFetch } from '../ui';

type Vault = { project: string; slug: string; dir: string; notes: number };
type NoteInfo = { path: string; title: string; tags: string[]; repos: string[]; updated: string; links: string[] };

/**
 * Each project's brain: the notes agents learned and read before working. Read-only here; people edit the
 * notes in Obsidian (the vault is a folder of Markdown files) or download the whole vault.
 */
export function Brain() {
  const t = useT();
  const { data: vaults, error, reload } = useFetch<Vault[]>('/brain');
  const [picked, setPicked] = useState<string>();
  const [note, setNote] = useState<string>();
  const [graph, setGraph] = useState(false);
  const vault = vaults?.find((v) => v.slug === picked) ?? vaults?.[0];
  const { data: notes } = useFetch<NoteInfo[]>(vault ? `/brain/${vault.slug}` : null);
  const selected = notes?.find((n) => n.path === note)?.path ?? notes?.find((n) => n.path === 'INDEX.md')?.path ?? notes?.[0]?.path;
  const { data: file } = useFetch<{ path: string; text: string }>(vault && selected ? `/brain/${vault.slug}/note?path=${encodeURIComponent(selected)}` : null);
  if (!vaults) return <Loading error={error} retry={reload} />;

  return (
    <>
      <PageHeader title="Brain">
        {vault && vault.notes > 0 && (
          <Button onClick={() => setGraph(!graph)} aria-pressed={graph}>
            {graph ? 'Notes' : 'Graph'}
          </Button>
        )}
        {vault && vault.notes > 0 && (
          <a className="btn secondary" href={`/api/brain/${vault.slug}/download`} download>
            {t('Download vault')}
          </a>
        )}
      </PageHeader>
      <p className="muted">
        {t('What the agents learned on each project: one Markdown note per lesson, read by every run of the project before it starts.')}{' '}
        {t('Edit or delete notes in Obsidian: mount this folder on the host and open it as a vault:')} <code>{vault?.dir ?? '/data/brain'}</code>
      </p>
      {!vaults.length ? (
        <Empty>No project yet: add one in Projects.</Empty>
      ) : (
        <>
          <Field label="Project">
            <Select value={vault!.slug} onChange={(v) => (setPicked(v), setNote(undefined))} options={vaults.map((v) => ({ value: v.slug, label: `${v.project} (${v.notes})` }))} />
          </Field>
          {!notes?.length ? (
            <Empty>Nothing learned yet: notes appear after runs where people answered or reviewed, or a review finding or a failing build was fixed.</Empty>
          ) : graph ? (
            <section className="card">
              <p className="hint">{t('Each note and the notes it links to with [[…]]. Click a note to read it.')}</p>
              <Graph notes={notes} selected={selected} onSelect={(path) => (setNote(path), setGraph(false))} />
            </section>
          ) : (
            <div className="assets">
              <nav className="card asset-list" aria-label={t('Notes')}>
                {notes.map((n) => (
                  <button key={n.path} type="button" className={`asset-item note-item${n.path === selected ? ' active' : ''}`} aria-current={n.path === selected} onClick={() => setNote(n.path)}>
                    <span>{n.path === 'INDEX.md' ? n.path : n.title}</span>
                    {n.tags.length > 0 && (
                      <span className="note-tags">
                        {n.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} tone="muted">
                            {tag}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
              <section className="card asset-view">
                <header className="card-head">
                  <h2>
                    <code>{selected}</code>
                  </h2>
                </header>
                {file && file.path === selected ? <pre className="log">{file.text}</pre> : <p className="muted">{t('Loading…')}</p>}
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}

type Point = { x: number; y: number; vx: number; vy: number };

/**
 * A force layout of the notes and their [[links]], like Obsidian's graph: linked notes pull together, all
 * notes push apart. ponytail: O(n²) per step, fine for a few hundred notes; past that, a Barnes-Hut layout.
 */
function layout(count: number, edges: [number, number][]): Point[] {
  const p = Array.from({ length: count }, (_, i) => ({ x: Math.cos(i * 2.4) * (40 + i * 6), y: Math.sin(i * 2.4) * (40 + i * 6), vx: 0, vy: 0 }));
  for (let step = 0; step < 300; step++) {
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = p[j].x - p[i].x;
        const dy = p[j].y - p[i].y;
        const d2 = Math.max(dx * dx + dy * dy, 1);
        const f = 20000 / d2;
        const d = Math.sqrt(d2);
        p[i].vx -= (dx / d) * f, p[i].vy -= (dy / d) * f, p[j].vx += (dx / d) * f, p[j].vy += (dy / d) * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = p[b].x - p[a].x;
      const dy = p[b].y - p[a].y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const f = (d - 170) * 0.04;
      p[a].vx += (dx / d) * f, p[a].vy += (dy / d) * f, p[b].vx -= (dx / d) * f, p[b].vy -= (dy / d) * f;
    }
    const cool = 1 - step / 300;
    for (const q of p) {
      q.vx -= q.x * 0.005, q.vy -= q.y * 0.005;
      q.x += Math.max(-20, Math.min(20, q.vx)) * cool;
      q.y += Math.max(-20, Math.min(20, q.vy)) * cool;
      q.vx *= 0.5, q.vy *= 0.5;
    }
  }
  return p;
}

function Graph({ notes, selected, onSelect }: { notes: NoteInfo[]; selected?: string; onSelect: (path: string) => void }) {
  const t = useT();
  const { points, edges, degree, box } = useMemo(() => {
    const index = new Map(notes.map((n, i) => [n.path, i]));
    const edges = notes.flatMap((n, i) => n.links.map((l) => index.get(l)).filter((j): j is number => j !== undefined && j !== i).map((j) => [i, j] as [number, number]));
    const degree = notes.map((_, i) => edges.filter(([a, b]) => a === i || b === i).length);
    const points = layout(notes.length, edges);
    // At least 900 × 560 units around the centre: a small vault keeps its 11px labels instead of zooming in.
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const w = Math.max(Math.max(...xs) - Math.min(...xs) + 240, 900);
    const h = Math.max(Math.max(...ys) - Math.min(...ys) + 120, 560);
    const box = [(Math.max(...xs) + Math.min(...xs) - w) / 2, (Math.max(...ys) + Math.min(...ys) - h) / 2, w, h];
    return { points, edges, degree, box };
  }, [notes]);
  const label = (n: NoteInfo) => (n.path === 'INDEX.md' ? 'INDEX' : n.title.length > 32 ? `${n.title.slice(0, 31)}…` : n.title);
  return (
    <svg className="brain-graph" viewBox={box.join(' ')} role="img" aria-label={t('Graph of the notes and their links')}>
      {edges.map(([a, b], i) => (
        <line key={i} x1={points[a].x} y1={points[a].y} x2={points[b].x} y2={points[b].y} />
      ))}
      {notes.map((n, i) => (
        <g
          key={n.path}
          className={n.path === selected ? 'active' : undefined}
          transform={`translate(${points[i].x} ${points[i].y})`}
          role="button"
          tabIndex={0}
          aria-label={n.title}
          onClick={() => onSelect(n.path)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(n.path))}
        >
          <title>{n.title}</title>
          <circle r={Math.min(5 + degree[i] * 1.5, 14)} />
          <text y={Math.min(5 + degree[i] * 1.5, 14) + 14}>{label(n)}</text>
        </g>
      ))}
    </svg>
  );
}
