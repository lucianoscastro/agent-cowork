import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { type Dictionary, translate } from './translate';

/**
 * UI translations, kept simple: the English text is the key (`t('Save')`), and each file in ./locales maps it to
 * pt-BR and es-ES. A text without a translation shows in English, never blank. `{name}` placeholders are filled
 * from `vars`. The agents' own output language is a separate setting (Setup → General).
 */
export type Locale = 'en-US' | 'pt-BR' | 'es-ES';
export type Translations = Partial<Record<Exclude<Locale, 'en-US'>, Dictionary>>;

// Every file in ./locales is merged here, so each page area keeps its own translations.
const files = import.meta.glob<{ default: Translations }>('./locales/*.ts', { eager: true });
const DICTIONARIES: Record<Locale, Dictionary> = { 'en-US': {}, 'pt-BR': {}, 'es-ES': {} };
for (const file of Object.values(files)) {
  for (const [locale, entries] of Object.entries(file.default) as [Locale, Dictionary][]) Object.assign(DICTIONARIES[locale], entries);
}

export const LOCALES: { id: Locale; name: string }[] = [
  { id: 'en-US', name: 'English' },
  { id: 'pt-BR', name: 'Português' },
  { id: 'es-ES', name: 'Español' },
];

const KEY = 'agentcowork.locale';
const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.id === v);

/** The saved choice, else the browser's language when it is one of ours, else English. */
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Storage blocked: fall through to the browser's language.
  }
  const lang = navigator.language.toLowerCase();
  return lang.startsWith('pt') ? 'pt-BR' : lang.startsWith('es') ? 'es-ES' : 'en-US';
}

export type T = (text: string, vars?: Record<string, string | number>) => string;

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({ locale: 'en-US', setLocale: () => {} });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, set] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    set(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  }, []);
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);

/** The translator for the current language; components re-render when it changes. */
export function useT(): T {
  const { locale } = useLocale();
  return useCallback<T>((text, vars) => translate(DICTIONARIES[locale], text, vars), [locale]);
}

/** Small flags drawn inline: emoji flags don't render on Windows. */
export function Flag({ locale }: { locale: Locale }) {
  const box = { width: 20, height: 14, viewBox: '0 0 20 14', 'aria-hidden': true, className: 'flag' } as const;
  if (locale === 'pt-BR') {
    return (
      <svg {...box}>
        <rect width="20" height="14" fill="#009c3b" />
        <path d="M10 1.6 18.2 7 10 12.4 1.8 7z" fill="#ffdf00" />
        <circle cx="10" cy="7" r="3.1" fill="#002776" />
      </svg>
    );
  }
  if (locale === 'es-ES') {
    return (
      <svg {...box}>
        <rect width="20" height="14" fill="#aa151b" />
        <rect y="3.5" width="20" height="7" fill="#f1bf00" />
      </svg>
    );
  }
  return (
    <svg {...box}>
      <rect width="20" height="14" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((y) => (
        <rect key={y} y={y * (14 / 13)} width="20" height={14 / 13} fill="#b22234" />
      ))}
      <rect width="9" height={(14 / 13) * 7} fill="#3c3b6e" />
    </svg>
  );
}

/** The language picker: one button per language, the current one pressed. */
export function LanguagePicker() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <div className="lang-picker" role="group" aria-label={t('Language')}>
      {LOCALES.map((l) => (
        <button key={l.id} type="button" className={l.id === locale ? 'active' : ''} aria-pressed={l.id === locale} title={l.name} aria-label={l.name} onClick={() => setLocale(l.id)}>
          <Flag locale={l.id} />
        </button>
      ))}
    </div>
  );
}
