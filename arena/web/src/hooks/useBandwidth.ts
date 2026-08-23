// Decides useVideo from two signals: the Network Information API (instant) and a
// timed asset probe (covers browsers without that API). Re-evaluates on network change.
import { useEffect, useState } from 'react';

export function useBandwidth(probeUrl: string): { useVideo: boolean; reason: string } {
  const [v, setV] = useState({ useVideo: true, reason: 'default' });

  useEffect(() => {
    const c = (navigator as any).connection;
    if (c?.saveData) return setV({ useVideo: false, reason: 'save-data' });
    if (c?.effectiveType && /(^|-)2g$/.test(c.effectiveType))
      return setV({ useVideo: false, reason: c.effectiveType });

    const started = performance.now();
    fetch(`${probeUrl}?cb=${started}`, { cache: 'no-store' })
      .then(r => r.blob())
      .then(blob => {
        const secs = (performance.now() - started) / 1000;
        const kbps = (blob.size / 1024) / Math.max(secs, 0.001);
        setV(kbps < 400
          ? { useVideo: false, reason: `slow ${Math.round(kbps)}KB/s` }
          : { useVideo: true, reason: `ok ${Math.round(kbps)}KB/s` });
      })
      .catch(() => setV({ useVideo: false, reason: 'probe-failed' }));

    const onChange = () => {
      if (c?.effectiveType && /(^|-)2g$/.test(c.effectiveType))
        setV({ useVideo: false, reason: 'downgraded' });
    };
    c?.addEventListener?.('change', onChange);
    return () => c?.removeEventListener?.('change', onChange);
  }, [probeUrl]);

  return v;
}
