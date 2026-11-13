import { useState } from 'react';
import { api, type DatabaseTarget, type ProjectDatabase } from '../api';
import { useT } from '../i18n';
import { Badge, Button, Field, Message, Select, Text, useAction } from '../ui';

const ACCESS = [
  { value: 'read', label: 'Read only' },
  { value: 'write', label: 'Read, and validate scripts (always rolled back)' },
] as const;

type Probe = { version: string; canWrite: boolean; admin: boolean };

/** One database's connection: stored encrypted and never shown again; the agents only reach it through the platform. */
function Connection(props: { project: string; db: ProjectDatabase; saved: boolean; target?: DatabaseTarget; onSaved: () => void }) {
  const t = useT();
  const { project, db, target } = props;
  const [value, setValue] = useState('');
  const [probe, setProbe] = useState<Probe>();
  const action = useAction();
  const body = { project, name: db.name };
  const store = () =>
    action.run(async () => {
      await api('/db-secrets', { method: 'PUT', body: { ...body, value } });
      setValue('');
      setProbe(undefined);
      props.onSaved();
    }, 'Stored');
  const remove = () =>
    action.run(async () => {
      await api('/db-secrets/delete', { method: 'POST', body });
      setProbe(undefined);
      props.onSaved();
    }, 'Removed');
  const test = () => action.run(async () => setProbe(await api<Probe>('/databases/test', { method: 'POST', body })), 'Connected');
  // The login decides what is possible; the access chosen here only decides what the agents may try.
  const verdict =
    probe &&
    (db.access === 'read' && probe.canWrite
      ? { tone: 'bad' as const, text: t('This login can change data: for a read-only database, use a login that can only read.') }
      : db.access === 'write' && !probe.canWrite
        ? { tone: 'bad' as const, text: t('This login cannot change data or schema, so validating scripts will fail.') }
        : { tone: 'ok' as const, text: t(probe.canWrite ? 'This login can change data; every validation is rolled back.' : 'This login can only read.') });
  return (
    <>
      <Field
        label="Connection URL"
        hint="postgresql://user:password@host:5432/db, mongodb://user:password@host/db, sqlserver://user:password@host:1433/db or a SQL Server connection string (Server=…;Database=…). Stored encrypted and never shown again; agents never see it."
      >
        <Text type="password" value={value} onChange={setValue} placeholder={target ? '••••••••' : ''} />
      </Field>
      <div className="row">
        <Button disabled={!value.trim() || !props.saved} busy={action.busy} onClick={store}>
          Store
        </Button>
        {target && (
          <>
            <Button busy={action.busy} onClick={test}>
              Test connection
            </Button>
            <Button variant="danger" busy={action.busy} onClick={remove}>
              Remove connection
            </Button>
          </>
        )}
        {!props.saved ? (
          <span className="muted small">{t('Save the project first, then store it.')}</span>
        ) : target ? (
          <span className="muted small">{t('{engine} at {host}', { engine: target.engine, host: [target.host, target.database].filter(Boolean).join('/') })}</span>
        ) : (
          <Badge tone="muted">nothing stored</Badge>
        )}
        <Message message={action.message} />
      </div>
      {probe && verdict && (
        <p className={`message ${verdict.tone}`}>
          {probe.version}. {verdict.text}
        </p>
      )}
      {probe?.admin && (
        <p className="message bad">
          {t('This login administers the whole server, so an agent could reach past this database (other databases, server settings, commands on the host). Use a login limited to this database.')}
        </p>
      )}
    </>
  );
}

/** The databases the Developer and its reviewers may query, and validate scripts against, through the platform. */
export function ProjectDatabases(props: {
  project: string;
  /** Names of the databases in the saved project: only those can store a connection. */
  savedNames: string[];
  rows: ProjectDatabase[];
  onChange: (rows: ProjectDatabase[]) => void;
  targets: Record<string, DatabaseTarget>;
  onSecretSaved: () => void;
}) {
  const t = useT();
  const set = (k: number, next: ProjectDatabase) => props.onChange(props.rows.map((x, j) => (j === k ? next : x)));
  return (
    <>
      <div className="row repos-head">
        <h3>{t('Databases')}</h3>
        <Button onClick={() => props.onChange([...props.rows, { name: '', access: 'read', description: '' }])}>Add database</Button>
      </div>
      <p className="muted small">
        {t(
          'Optional. The developer agent and its reviewers query them through the platform, which holds the credentials. With write access, the steps that change code may also validate a migration: it runs twice in one transaction that is always rolled back, so nothing is saved.',
        )}
      </p>
      {props.rows.map((db, k) => (
        <div key={k} className="subcard">
          <div className="row fields">
            <Field label="Name" hint="How agents refer to it, like dev-api. After a rename, store the connection again.">
              <Text value={db.name} onChange={(name) => set(k, { ...db, name: name.toLowerCase() })} placeholder="dev-api" />
            </Field>
            <Field label="Access">
              <Select value={db.access} onChange={(access) => set(k, { ...db, access })} options={[...ACCESS]} />
            </Field>
            <Button variant="danger" onClick={() => props.onChange(props.rows.filter((_, j) => j !== k))}>
              Remove
            </Button>
          </div>
          <Field label="What it holds" hint="Tells the agents what to expect: the environment, the main schemas, and whether it has real personal data.">
            <Text value={db.description} onChange={(description) => set(k, { ...db, description })} placeholder="Development database of the API; no real personal data" />
          </Field>
          <Connection project={props.project} db={db} saved={props.savedNames.includes(db.name)} target={props.targets[db.name]} onSaved={props.onSecretSaved} />
        </div>
      ))}
    </>
  );
}
