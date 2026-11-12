import { useState } from 'react';
import { useT } from './i18n';

/** Light or dark, saved in this browser; without a choice it follows the system. Applied on <html data-theme>. */
type Theme = 'light' | 'dark';
const KEY = 'agentcowork.theme';

function savedTheme(): Theme | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : undefined;
  } catch {
    return undefined;
  }
}

const systemTheme = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/** Called before the first render, so the page never flashes in the other theme. */
export function applyTheme(theme: Theme = savedTheme() ?? systemTheme()): Theme {
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function ThemeToggle() {
  const t = useT();
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) ?? applyTheme());
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? t('Switch to dark theme') : t('Switch to light theme');
  return (
    <button
      type="button"
      className="theme-toggle"
      title={label}
      aria-label={label}
      onClick={() => {
        setTheme(applyTheme(next));
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // Storage blocked: the choice lasts until the page reloads.
        }
      }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
