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
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        {theme === 'dark' ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
          </>
        ) : (
          <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
        )}
      </svg>
    </button>
  );
}
