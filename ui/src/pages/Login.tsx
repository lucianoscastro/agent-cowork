import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { LanguagePicker, useT } from '../i18n';
import { ThemeToggle } from '../theme';

export function Login({ onLogin }: { onLogin: () => void }) {
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/login', { method: 'POST', body: { username, password } });
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-prefs">
        <LanguagePicker />
        <ThemeToggle />
      </div>
      <form className="card login-card" onSubmit={submit}>
        <h1>agentCowork</h1>
        <p className="muted">{t('Sign in with the admin user configured for this container.')}</p>
        <label className="field">
          <span className="field-label">{t('Username')}</span>
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{t('Password')}</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="message bad" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy || !username || !password}>
          {busy ? '…' : t('Sign in')}
        </button>
      </form>
    </div>
  );
}
