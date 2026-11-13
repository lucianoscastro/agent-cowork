import { useEffect, useState } from 'react';
import { api, type Project, saveSection, type SettingsResponse, type Stack, STACK_NAMES, type TestEnvironment } from '../api';
import { useT } from '../i18n';
import { TestEnvironmentFields } from './TestEnvironment';

const STACKS = Object.keys(STACK_NAMES) as Stack[];
import { Badge, Button, Empty, Field, Lines, Loading, Message, PageHeader, Select, Text, useAction, useFetch, useUnsaved } from '../ui';

type RepoRow = { repo: string; stack: Stack; verify: string[] };
type ProjectDraft = { name: string; boardId: string; baseBranch: string; repos: RepoRow[]; environment?: TestEnvironment };

const toDraft = (p: Project): ProjectDraft => ({
  name: p.name,
  boardId: p.boardId ?? '',
  baseBranch: p.baseBranch ?? '',
  repos: Object.values(p.repos).map((r) => ({ repo: r.repo, stack: r.stack, verify: r.verify ?? [] })),
  environment: p.environment,
});
const fromDraft = (d: ProjectDraft): Project => ({
  name: d.name,
  boardId: d.boardId || undefined,
  baseBranch: d.baseBranch || undefined,
  // The server keys repositories by their folder (the repository name); any unique key works here.
  repos: Object.fromEntries(d.repos.map((r, i) => [String(i), { repo: r.repo, stack: r.stack, verify: r.verify.filter((c) => c.trim()) }])),
  environment: d.environment && {
    // The server drops it when no repository is checked.
    // Only the repositories still in the project with a check on; the rest are not tested.
    repos: Object.fromEntries(
      Object.entries(d.environment.repos)
        .filter(([repo, t]) => (t.e2e || t.explore) && d.repos.some((r) => r.repo === repo))
        .map(([repo, t]) => [repo, { ...t, branch: t.branch || undefined }]),
    ),
  },
});
const EMPTY_REPO: RepoRow = { repo: '', stack: 'react', verify: [] };

/** One project's Save and Remove, each with its own progress and message. */
function ProjectActions({ onSave, onRemove }: { onSave: () => Promise<unknown>; onRemove: () => Promise<unknown> }) {
  const t = useT();
  const save = useAction();
  const remove = useAction();
  return (
    <div className="row project-actions">
      <Message message={save.message ?? remove.message} />
      <span className="spacer" />
      <Button variant="danger" busy={remove.busy} onClick={() => window.confirm(t('Remove this project? Its agents stop working on it.')) && remove.run(onRemove, 'Removed')}>
        Remove project
      </Button>
      <Button variant="primary" busy={save.busy} onClick={() => save.run(onSave)}>
        Save
      </Button>
    </div>
  );
}

type Check = { label: string; ok: boolean; detail: string };

/** Checks the board against Jira: the board, the developer's trigger JQL there, and the statuses and issue types the agents name. */
function BoardCheck({ boardId }: { boardId: string }) {
  // Results belong to the board checked: editing it hides them.
  const t = useT();
  const [result, setResult] = useState<{ for: string; checks: Check[] }>();
  const checks = result?.for === boardId ? result.checks : undefined;
  const action = useAction();
  const check = () =>
    action.run(async () => {
      const { checks } = await api<{ checks: Check[] }>('/test/jira/board', { method: 'POST', body: { boardId } });
      setResult({ for: boardId, checks });
    }, 'Checked');
  return (
    <div className="board-check">
      <div className="row">
        <Button busy={action.busy} disabled={!boardId.trim()} onClick={check}>
          Check on Jira
        </Button>
        <span className="muted small">{t("Uses this board as typed, and the agents' saved settings.")}</span>
      </div>
      {checks && (
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.label}>
              <Badge tone={c.ok ? 'ok' : 'warn'}>{c.ok ? 'OK' : 'Check'}</Badge> <strong>{c.label}</strong> <span className="muted">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {action.message?.tone === 'bad' && <Message message={action.message} />}
    </div>
  );
}

export function Projects() {
  const t = useT();
  const { data, error, reload } = useFetch<SettingsResponse>('/settings');
  const [projects, setProjects] = useState<ProjectDraft[]>();
  // Projects start collapsed; the open ones are tracked here so a re-render never closes them.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const setOpenAt = (i: number, isOpen: boolean) =>
    setOpen((s) => {
      const next = new Set(s);
      if (isOpen) next.add(i);
      else next.delete(i);
      return next;
    });
  // Drafts are read once: a reload (after a save, or after storing test variables) keeps other projects' unsaved edits.
  useUnsaved(projects, data?.sections.projects.items.map(toDraft));
  useEffect(() => {
    if (data && !projects) setProjects(data.sections.projects.items.map(toDraft));
  }, [data, projects]);
  if (!projects || !data) return <Loading error={error} retry={reload} />;
  const { stacks } = data.sections;
  const saved = data.sections.projects.items;
  const update = (i: number, p: ProjectDraft) => setProjects(projects.map((x, j) => (j === i ? p : x)));
  // Drafts line up with the saved list by position; new ones come after it.
  const saveAt = async (i: number) => {
    const items = [...saved];
    items[Math.min(i, items.length)] = fromDraft(projects[i]);
    const result = await saveSection('projects', { items });
    setProjects((ps) => ps?.map((x, j) => (j === i ? toDraft(result.items[Math.min(i, result.items.length - 1)]) : x)));
    await reload();
  };
  const removeAt = async (i: number) => {
    if (i < saved.length) {
      await saveSection('projects', { items: saved.filter((_, j) => j !== i) });
      await reload();
    }
    setProjects((ps) => ps?.filter((_, j) => j !== i));
    setOpen(new Set());
  };

  return (
    <>
      <PageHeader title="Projects">
        <Button
          onClick={() => {
            setProjects([...projects, { name: 'New project', boardId: '', baseBranch: '', repos: [{ ...EMPTY_REPO }] }]);
            setOpenAt(projects.length, true);
          }}
        >
          Add project
        </Button>
      </PageHeader>
      <p className="muted">
        {t(
          "A project maps Jira cards to the repositories they may change. The developer agent checks out every repository of the project side by side; the platform runs each changed repository's verify commands before opening a PR. The Dependabot agent uses the same verify commands.",
        )}
      </p>
      {projects.length === 0 && <Empty>No project yet: add one to link a Jira board to its repositories.</Empty>}
      {projects.map((p, i) => (
        <details key={i} className="card accordion" open={open.has(i)} onToggle={(e) => setOpenAt(i, e.currentTarget.open)}>
          <summary>
            <strong>{p.name || t('Unnamed project')}</strong>
            <span className="muted small">
              {p.repos.map((r) => r.repo || t('(no repository)')).join(', ')}
              {`; ${p.boardId ? t('board {id}', { id: p.boardId }) : t('no board')}`}
              {p.baseBranch && `; ${t('base {branch}', { branch: p.baseBranch })}`}
            </span>
          </summary>
          <div className="row fields">
            <Field label="Name" hint="Also the key of its stored test variables: after a rename, store them again.">
              <Text value={p.name} onChange={(name) => update(i, { ...p, name })} />
            </Field>
            <Field label="Jira board id" hint="The number in the board URL (…/boards/<id>). Empty: the developer skips this project.">
              <Text value={p.boardId} onChange={(boardId) => update(i, { ...p, boardId })} placeholder="123" />
            </Field>
            <Field label="Base branch" hint="Empty uses the agent default.">
              <Text value={p.baseBranch} onChange={(baseBranch) => update(i, { ...p, baseBranch })} placeholder="develop" />
            </Field>
          </div>
          <BoardCheck boardId={p.boardId} />
          <div className="row repos-head">
            <h3>{t('Repositories')}</h3>
            <Button onClick={() => update(i, { ...p, repos: [...p.repos, { ...EMPTY_REPO }] })}>Add repository</Button>
          </div>
          {p.repos.map((r, k) => {
            const setRepo = (next: RepoRow) => update(i, { ...p, repos: p.repos.map((x, j) => (j === k ? next : x)) });
            return (
              <div key={k} className="subcard">
                <div className="row fields">
                  <Field label="Stack">
                    <Select value={r.stack} onChange={(stack) => setRepo({ ...r, stack })} options={STACKS.map((value) => ({ value, label: STACK_NAMES[value] }))} />
                  </Field>
                  <Field label="Repository" hint={r.repo.includes('/') ? t("Checked out as {folder}/ in the agent's workspace.", { folder: r.repo.slice(r.repo.indexOf('/') + 1) }) : 'owner/name'}>
                    <Text value={r.repo} onChange={(repo) => setRepo({ ...r, repo })} placeholder="owner/name" />
                  </Field>
                  <Button variant="danger" onClick={() => update(i, { ...p, repos: p.repos.filter((_, j) => j !== k) })}>
                    Remove
                  </Button>
                </div>
                <Field
                  label="Custom verify commands (optional)"
                  hint={t('Empty runs the {stack} defaults from General (shown greyed). Fill only when this repository differs; one per line, from the repository root.', { stack: STACK_NAMES[r.stack] })}
                >
                  <Lines value={r.verify} onChange={(verify) => setRepo({ ...r, verify })} placeholder={stacks[r.stack].join('\n')} />
                </Field>
              </div>
            );
          })}
          <h3>{t('Test environment')}</h3>
          <TestEnvironmentFields
            project={p.name}
            saved={saved.some((s) => s.name === p.name)}
            repos={p.repos.map((r) => r.repo).filter(Boolean)}
            env={p.environment}
            onChange={(environment) => update(i, { ...p, environment })}
            testVars={data.testVars[p.name] ?? {}}
            onSecretSaved={reload}
          />
          <ProjectActions onSave={() => saveAt(i)} onRemove={() => removeAt(i)} />
        </details>
      ))}
    </>
  );
}
