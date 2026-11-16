import { useState } from 'react';
import { api, type DbEngine, type ProjectDatabase } from '../api';
import { useT } from '../i18n';
import { Badge, Button, Field, Message, Select, Text, Toggle, useAction } from '../ui';

/** A database as edited: its password, when typed, is stored by the project's Save and never comes back. */
export type DatabaseDraft = ProjectDatabase & { password?: string };

const ENGINES: { value: DbEngine; label: string }[] = [
  { value: 'sqlserver', label: 'SQL Server' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mongodb', label: 'MongoDB' },
];
const PORTS: Record<DbEngine, string> = { sqlserver: '1433', postgres: '5432', mongodb: '27017' };
const OPTIONS: Record<DbEngine, string> = {
  sqlserver: 'encrypt=true&trustServerCertificate=true',
  postgres: 'sslmode=require',
  mongodb: 'authSource=admin&replicaSet=rs0',
};
const ACCESS = [
  { value: 'read', label: 'Read only' },
  { value: 'write', label: 'Read, and validate scripts (always rolled back)' },
] as const;

type Probe = { version: string; canWrite: boolean; admin: boolean };

/** Test connection on the saved settings, and Remove password. */
function Check(props: { project: string; db: DatabaseDraft; saved: boolean; stored: boolean; onChanged: () => void }) {
  const t = useT();
  const { db } = props;
  const [probe, setProbe] = useState<Probe>();
  const action = useAction();
  const body = { project: props.project, name: db.name };
  const needsPassword = Boolean(db.user) && !props.stored;
  const test = () => action.run(async () => setProbe(await api<Probe>('/databases/test', { method: 'POST', body })), 'Connected');
  const remove = () =>
    action.run(async () => {
      await api('/db-secrets/delete', { method: 'POST', body });
      setProbe(undefined);
      props.onChanged();
    }, 'Removed');
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
      <div className="row">
        <Button busy={action.busy} disabled={!props.saved || needsPassword} onClick={test}>
          Test connection
        </Button>
        {props.stored && (
          <Button variant="danger" busy={action.busy} onClick={remove}>
            Remove password
          </Button>
        )}
        {!props.saved ? (
          <span className="muted small">{t('Save the project to test these settings.')}</span>
        ) : props.stored ? (
          <Badge tone="ok">password stored</Badge>
        ) : (
          needsPassword && <span className="muted small">{t('No password stored: type it and save the project.')}</span>
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

const FIELDS = ['access', 'engine', 'host', 'port', 'database', 'user', 'options', 'srv'] as const;
/** Whether a database's row matches what is saved: only then does Test connection test what is on screen. */
const unchanged = (db: DatabaseDraft, saved: ProjectDatabase | undefined) => Boolean(saved) && !db.password && FIELDS.every((f) => (db[f] ?? '') === (saved?.[f] ?? ''));

/** The databases the Developer and its reviewers may query, and validate scripts against, through the platform. */
export function ProjectDatabases(props: {
  project: string;
  /** The databases of the saved project: only those can be tested. */
  savedRows: ProjectDatabase[];
  rows: DatabaseDraft[];
  onChange: (rows: DatabaseDraft[]) => void;
  /** By name: whether its password is stored. */
  stored: Record<string, boolean>;
  onSecretChanged: () => void;
}) {
  const t = useT();
  const set = (k: number, next: DatabaseDraft) => props.onChange(props.rows.map((x, j) => (j === k ? next : x)));
  const empty: DatabaseDraft = { name: '', access: 'read', description: '', engine: 'sqlserver', host: '', database: '', user: '' };
  return (
    <>
      <div className="row repos-head">
        <h3>{t('Databases')}</h3>
        <Button onClick={() => props.onChange([...props.rows, empty])}>Add database</Button>
      </div>
      <p className="muted small">
        {t(
          'Optional. The developer agent and its reviewers query them through the platform, which holds the credentials. With write access, the steps that change code may also validate a migration: it runs twice in one transaction that is always rolled back, so nothing is saved.',
        )}
      </p>
      {props.rows.map((db, k) => {
        const saved = props.savedRows.find((d) => d.name === db.name);
        const stored = Boolean(props.stored[db.name]) && Boolean(saved);
        return (
          <div key={k} className="subcard">
            <div className="row fields">
              <Field label="Name" hint="How agents refer to it, like dev-api. After a rename, type the password again.">
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
            <div className="row fields">
              <Field label="Engine">
                <Select value={db.engine} onChange={(engine) => set(k, { ...db, engine, srv: engine === 'mongodb' ? db.srv : undefined })} options={ENGINES} />
              </Field>
              <Field label="Host" hint={db.engine === 'mongodb' ? 'One host, or several as host1:27017,host2:27017.' : undefined}>
                <Text value={db.host} onChange={(host) => set(k, { ...db, host: host.trim() })} placeholder="db.example.com" />
              </Field>
              {!(db.engine === 'mongodb' && db.srv) && (
                <Field label="Port">
                  <Text value={db.port ? String(db.port) : ''} onChange={(v) => /^\d{0,5}$/.test(v.trim()) && set(k, { ...db, port: v.trim() ? Number(v) : undefined })} placeholder={PORTS[db.engine]} />
                </Field>
              )}
            </div>
            <div className="row fields">
              <Field label="Database">
                <Text value={db.database} onChange={(database) => set(k, { ...db, database: database.trim() })} placeholder="shop" />
              </Field>
              <Field label="User" hint="Empty when the database needs no login.">
                <Text value={db.user} onChange={(user) => set(k, { ...db, user: user.trim() })} />
              </Field>
              <Field label="Password" hint="Stored encrypted when you save the project, and never shown again; agents never see it.">
                <Text type="password" value={db.password ?? ''} onChange={(password) => set(k, { ...db, password: password || undefined })} placeholder={stored ? t('stored: leave empty to keep it') : ''} />
              </Field>
            </div>
            <Field label="Options (optional)" hint="Connection parameters as key=value, joined by &.">
              <Text value={db.options ?? ''} onChange={(options) => set(k, { ...db, options: options.trim() || undefined })} placeholder={OPTIONS[db.engine]} />
            </Field>
            {db.engine === 'mongodb' && (
              <Toggle checked={Boolean(db.srv)} onChange={(srv) => set(k, { ...db, srv: srv || undefined, port: srv ? undefined : db.port })} label="DNS seed list (mongodb+srv, as on Atlas)" />
            )}
            {/* A new key when the saved settings change: an earlier test result no longer describes them. */}
            <Check key={`${JSON.stringify(saved ?? null)}${stored}`} project={props.project} db={db} saved={unchanged(db, saved)} stored={stored} onChanged={props.onSecretChanged} />
          </div>
        );
      })}
    </>
  );
}
