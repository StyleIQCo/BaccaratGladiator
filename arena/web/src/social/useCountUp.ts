// ═══════════════════════════════════════════════════════════════════
//  useCountUp — the odometer behind every "+N CHIPS" reveal.
//  Respects prefers-reduced-motion by snapping straight to the target.
// ═══════════════════════════════════════════════════════════════════
import { animate, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function useCountUp(target: number, active: boolean, delaySec = 0): number {
  const [value, setValue] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    if (reduceMotion) {
      setValue(target);
      return;
    }
    const controls = animate(0, target, {
      duration: 1.1,
      delay: delaySec,
      ease: [0.16, 1, 0.3, 1], // fast start, luxurious settle
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [active, target, delaySec, reduceMotion]);

  return value;
}
