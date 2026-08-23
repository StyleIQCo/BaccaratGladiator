// Config-driven, brand-swappable theme. Loads a white-label JSON, pushes the
// palette into CSS vars (same contract as the classic themes-extended.js), and
// exposes the bandwidth-gated useVideo flag.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useBandwidth } from '../hooks/useBandwidth';

interface ThemeConfig { brand: string; logo: string; stages: Record<string, any>; fallback: any; }
const Ctx = createContext<{ theme: ThemeConfig | null; stage: string; useVideo: boolean }>(
  { theme: null, stage: '', useVideo: true },
);

export function ThemeProvider({ brand, stage, children }: { brand: string; stage: string; children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeConfig | null>(null);

  useEffect(() => {
    fetch(`/arena/config/themes/${brand}.json`).then(r => r.json()).then(setTheme).catch(() => {});
  }, [brand]);

  const poster = theme?.stages[stage]?.videoPoster ?? '/card_back.png';
  const { useVideo } = useBandwidth(poster); // probe the small poster as the sample

  useEffect(() => {
    const p = theme?.stages[stage]?.palette;
    if (p) for (const [k, val] of Object.entries(p)) document.documentElement.style.setProperty(`--${k}`, val as string);
  }, [theme, stage]);

  return <Ctx.Provider value={{ theme, stage, useVideo }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
