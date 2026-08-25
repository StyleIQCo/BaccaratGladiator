// ═══════════════════════════════════════════════════════════════════
//  LOCALE CONTEXT — cultural theming for the Asian-market build.
//
//  The one rule that matters: outcome colors are SEMANTIC. Components
//  never say green/red for win/loss — they say `win`/`loss` (Tailwind
//  tokens backed by CSS vars). For `zh`/`yue` locales the palette
//  flips to the Chinese market convention — RED rises/wins/is lucky,
//  GREEN declines — exactly how Shanghai/HK stock tickers render.
//
//  Mechanism: this provider only computes the scheme and stamps
//  `data-outcome-scheme` + `lang` on <html>. The palettes themselves
//  live in social.css (`:root` / `:root[data-outcome-scheme='east']`),
//  and tailwind.config.js exposes them as `win` / `loss` utilities.
//  The flip is pure CSS — zero re-render of the component tree.
//
//  Detection ladder: explicit `initial` prop → localStorage override
//  (`arena.locale`, set by the in-app language switch) → navigator.
// ═══════════════════════════════════════════════════════════════════
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type OutcomeScheme = 'west' | 'east';

const STORAGE_KEY = 'arena.locale';

/** zh (Mandarin) and yue (Cantonese) flip the outcome palette. */
export const schemeForLocale = (locale: string): OutcomeScheme =>
  /^(zh|yue)\b/i.test(locale) ? 'east' : 'west';

function detectLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch { /* private mode — fall through */ }
  return navigator.language || 'en';
}

interface LocaleCtx {
  locale: string;
  scheme: OutcomeScheme;
  isZh: boolean; // convenience: scheme === 'east'
  setLocale: (locale: string) => void;
}

const Ctx = createContext<LocaleCtx>({
  locale: 'en', scheme: 'west', isZh: false, setLocale: () => {},
});

export function LocaleProvider({ initial, children }: { initial?: string; children: ReactNode }) {
  const [locale, setLocaleState] = useState(() => initial ?? detectLocale());
  const scheme = schemeForLocale(locale);

  useEffect(() => {
    document.documentElement.dataset.outcomeScheme = scheme;
    document.documentElement.lang = locale;
  }, [scheme, locale]);

  function setLocale(next: string) {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  }

  return (
    <Ctx.Provider value={{ locale, scheme, isZh: scheme === 'east', setLocale }}>
      {children}
    </Ctx.Provider>
  );
}

export const useLocale = () => useContext(Ctx);
