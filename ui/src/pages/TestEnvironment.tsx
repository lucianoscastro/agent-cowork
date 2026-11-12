import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { api, type RepoEnvironment, type ResolvedSuite, type TestEnvironment } from '../api';
import { Badge, Button, Field, Text, Toggle } from '../ui';

const FRAMEWORK_NAMES: Record<ResolvedSuite['framework'], string> = { playwright: 'Playwright', cucumber: 'Cucumber', cypress: 'Cypress' };
const OFF: RepoEnvironment = { baseUrl: '', e2e: false, explore: false };

type Detected = { busy: boolean; suite?: ResolvedSuite; branch?: string; notes: string[]; error?: string };

/**
 * The suite a repository would run now: detected on its branch in the saved project. `onMissing` gets the
 * branch when the repository was read and holds no suite.
 */
function useSuite(project: string, repo: string, branch: string, on: boolean, onMissing: (branch: string) => void): Detected {
  const [state, setState] = useState<Detected>({ busy: false, notes: [] });
  const missing = useRef(onMissing);
  missing.current = onMissing;
  useEffect(() => {
    if (!on) return;
    let live = true; // a later branch or an uncheck makes this answer stale
    setState((s) => ({ ...s, busy: true }));
    // Waits for typing to settle (the branch field) before reading the repository.
    const timer = setTimeout(() => {
      api<Omit<Detected, 'busy'>>('/projects/detect-suite', { method: 'POST', body: { project, repo, branch } })
        .then((r) => {
          if (!live) return;
          setState({ busy: false, ...r });
          if (!r.suite && r.branch) missing.current(r.branch);
        })
        .catch((err: Error) => live && setState({ busy: false, notes: [], error: err.message }));
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [project, repo, branch, on]);
  return state;
}

/** One repository: what to run against it, and where. */
function RepoTarget(props: {
  project: string;
  saved: boolean;
  repo: string;
  target: RepoEnvironment;
  onChange: (t: RepoEnvironment) => void;
  testVars: string[];
  onSecretSaved: () => void;
}) {
  const t = useT();
  const { target, onChange } = props;
  const set = (patch: Partial<RepoEnvironment>) => onChange({ ...target, ...patch });
  const [warning, setWarning] = useState<string>();
  // No suite to run: end-to-end tests are unchecked, so the project is not saved with a check that does nothing.
  const detected = useSuite(props.project, props.repo, target.branch ?? '', props.saved && target.e2e, (branch) => {
    setWarning(t('No end-to-end suite found on {branch} (Playwright, Cucumber or Cypress): end-to-end tests were unchecked.', { branch }));
    set({ e2e: false });
  });
  const { suite } = detected;
  return (
    <div className="subcard">
      <div className="row">
        <code>{props.repo}</code>
        <span className="spacer" />
        <Toggle
          checked={target.e2e}
          onChange={(e2e) => {
            setWarning(undefined);
            set({ e2e });
          }}
          label="End-to-end tests"
        />
        <Toggle checked={target.explore} onChange={(explore) => set({ explore })} label="Exploratory" />
      </div>
      {warning && !target.e2e && <p className="message bad">{warning}</p>}
      {(target.e2e || target.explore) && (
        <>
          <div className="row fields">
            <Field label="URL" hint="Never production: the Sentinel creates data while exploring.">
              <Text value={target.baseUrl} onChange={(baseUrl) => set({ baseUrl })} placeholder="https://staging.example.com" />
            </Field>
            <Field label="Branch" hint="Empty uses the project's base branch.">
              <Text value={target.branch ?? ''} onChange={(branch) => set({ branch })} placeholder={detected.branch} />
            </Field>
          </div>
          {target.explore && (
            <p className="muted small">{t('Every few hours, when the branch moved, the Sentinel explores what changed in a browser; confirmed findings wait in the inbox to become cards.')}</p>
          )}
          {target.e2e &&
            (!props.saved ? (
              <p className="muted small">{t('Save the project to find its suite.')}</p>
            ) : detected.busy ? (
              <p className="muted small">{t('Looking for the suite…')}</p>
            ) : detected.error ? (
              <p className="message bad">{detected.error}</p>
            ) : suite ? (
              <p>
                <Badge tone="ok">{FRAMEWORK_NAMES[suite.framework]}</Badge>
                {suite.workdir && <span className="muted"> {t('in {folder}/', { folder: suite.workdir })}</span>} {t('on branch')} <code>{suite.branch}</code>
                <span className="muted small"> · {t('runs {command}', { command: suite.runCommand })}</span>
              </p>
            ) : null /* no suite: unchecked with a warning; unreadable: the note says why */)}
          {target.e2e && !detected.busy && detected.notes.map((n, i) => (
            <p key={i} className="muted small">
              {n}
            </p>
          ))}
          <TestVars project={props.project} repo={props.repo} saved={props.saved} stored={props.testVars} needed={suite?.secretVars ?? []} onSaved={props.onSecretSaved} />
        </>
      )}
    </div>
  );
}

/** A repository's test variables: one JSON object, stored encrypted on the server, never shown again. */
function TestVars(props: { project: string; repo: string; saved: boolean; stored: string[]; needed: string[]; onSaved: () => void }) {
  const t = useT();
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  const call = async (path: string, body: object) => {
    setMessage(undefined);
    try {
      await api(path, { method: path.endsWith('delete') ? 'POST' : 'PUT', body: { project: props.project, repo: props.repo, ...body } });
      setValue('');
      props.onSaved();
    } catch (err) {
      setMessage({ tone: 'bad', text: (err as Error).message });
    }
  };
  const missing = props.needed.filter((n) => !props.stored.includes(n));
  const example = JSON.stringify(Object.fromEntries((props.needed.length ? props.needed : ['TEST_USERNAME', 'TEST_PASSWORD']).map((n) => [n, '…'])), null, 2);
  return (
    <>
      <Field
        label="Test variables (JSON)"
        hint="Users, passwords, tokens. They reach the test commands and, masked, the browser; never a model's text. Storing replaces the whole object."
      >
        <textarea rows={5} value={value} onChange={(e) => setValue(e.target.value)} placeholder={example} spellCheck={false} />
      </Field>
      <div className="row">
        <Button disabled={!value.trim() || !props.saved} onClick={() => call('/env-secrets', { value })}>
          Store
        </Button>
        {props.stored.length > 0 && (
          <Button variant="danger" onClick={() => call('/env-secrets/delete', {})}>
            Remove
          </Button>
        )}
        {!props.saved ? (
          <span className="muted small">{t('Save the project first, then store them.')}</span>
        ) : props.stored.length ? (
          <span className="muted small">{t('Stored: {names}', { names: props.stored.join(', ') })}</span>
        ) : (
          <Badge tone="muted">nothing stored</Badge>
        )}
        {message && <span className={`message ${message.tone}`}>{message.text}</span>}
      </div>
      {missing.length > 0 && <p className="message bad">{t('The suite also reads {names}.', { names: missing.join(', ') })}</p>}
    </>
  );
}

/** The Sentinel's view of a project: per repository, what to run, where, and with which variables. */
export function TestEnvironmentFields(props: {
  project: string;
  /** The project is saved: detection and the variables need it. */
  saved: boolean;
  repos: string[];
  env: TestEnvironment | undefined;
  onChange: (env: TestEnvironment) => void;
  /** By repository: the names of its stored test variables. */
  testVars: Record<string, string[]>;
  onSecretSaved: () => void;
}) {
  const { onChange, project } = props;
  // Checking a repository is what gives the project a test environment.
  const env = props.env ?? { repos: {} };
  return (
    <div className="subcard">
      {props.repos.map((repo) => (
        <RepoTarget
          key={repo}
          project={project}
          saved={props.saved}
          repo={repo}
          target={env.repos[repo] ?? OFF}
          onChange={(t) => onChange({ ...env, repos: { ...env.repos, [repo]: t } })}
          testVars={props.testVars[repo] ?? []}
          onSecretSaved={props.onSecretSaved}
        />
      ))}
    </div>
  );
}
