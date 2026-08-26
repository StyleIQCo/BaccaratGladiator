// ═══════════════════════════════════════════════════════════════════
//  PIKE ST. BARISTA RUSH — Framer Motion modal wrapper.
//
//  React OWNS this layer: the rainy-window chrome, the intro screen,
//  the receipt-printer HUD, and the end-of-shift receipt. The canvas
//  between them runs entirely on refs.
//
//  Beat sheet:
//    1. intro   — rain on the glass, neon title, the three-station
//                 legend, "CLOCK IN!" (primes audio + starts the lo-fi).
//    2. playing — BaristaRushCanvas mounts and the shift starts. The
//                 receipt printer above the canvas re-renders at 4 Hz
//                 off onHudTick — the canvas itself never re-renders.
//    3. over    — the printer feeds out the full itemized receipt:
//                 every drink, the total, and the shift title
//                 ("MASTER ROASTER" … "DISHWASHER") + pulsing Claim.
//
//  Closing mid-run forfeits the shift (daily ticket = one attempt);
//  chips are only granted through onClaim on the receipt screen.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BaristaRushCanvas } from './BaristaRushCanvas';
import { primeAudio, sfxClaim, startBgm, stopAllAudio } from './baristaSfx';
import { RUN_SECONDS_DEFAULT, type DrinkGrade, type DrinkLogEntry } from './useBaristaPhysics';

export interface PikeBaristaGameProps {
  open: boolean;
  onClose: () => void;
  /** Award the chips (server call lives up here — the game never touches the wallet). */
  onClaim: (chips: number) => void | Promise<void>;
  runSeconds?: number; // default 60
}

type Phase = 'intro' | 'playing' | 'over';

interface ShiftResult {
  score: number;
  drinks: number;
  perfects: number;
  log: DrinkLogEntry[];
}

/** The end-of-shift performance review, straight from the manager. */
function shiftTitle(r: ShiftResult): string {
  if (r.drinks === 0 || r.score === 0) return 'DISHWASHER';
  if (r.perfects >= 6) return 'MASTER ROASTER';
  if (r.perfects >= 4) return 'LATTE ARTIST';
  if (r.perfects >= 2) return 'STEADY HAND';
  if (r.score >= 500) return 'DECAF APPRENTICE';
  return 'DISHWASHER';
}

const GRADE_MARK: Record<DrinkGrade, string> = {
  perfect: '★ PERFECT',
  good: '✓ GOOD',
  slop: '~ SLOP',
  ruined: '✗ RUINED',
};

const fmtTime = (s: number) => {
  const whole = Math.ceil(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Eased count-up for the receipt total. Post-game, so setState is fair game again. */
function CountUp({ to, duration = 0.9 }: { to: number; duration?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min((t - t0) / (duration * 1000), 1);
      setN(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <>{n.toLocaleString()}</>;
}

const LEGEND: { icon: string; name: string; hint: string }[] = [
  { icon: '🎯', name: 'THE TAMP', hint: 'Tap when the needle swings into the green' },
  { icon: '⏳', name: 'THE SHOT', hint: 'Hold the valve — release AT the etched line' },
  { icon: '🎨', name: 'THE ART', hint: 'Trace the stencil before the foam settles' },
];

export function PikeBaristaGame({ open, onClose, onClaim, runSeconds = RUN_SECONDS_DEFAULT }: PikeBaristaGameProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [result, setResult] = useState<ShiftResult>({ score: 0, drinks: 0, perfects: 0, log: [] });
  const [hud, setHud] = useState({ timeLeft: RUN_SECONDS_DEFAULT, score: 0, combo: 1 });
  const [claiming, setClaiming] = useState(false);
  const claimedRef = useRef(false); // double-tap guard across the async claim

  // Fresh shift every time the modal opens; silence on the way out.
  useEffect(() => {
    if (open) {
      setPhase('intro');
      setResult({ score: 0, drinks: 0, perfects: 0, log: [] });
      setHud({ timeLeft: runSeconds, score: 0, combo: 1 });
      setClaiming(false);
      claimedRef.current = false;
    } else {
      stopAllAudio();
    }
  }, [open, runSeconds]);
  useEffect(() => () => stopAllAudio(), []);

  // The rain: fixed streak field, randomized per mount. Pure CSS after that.
  const rain = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: `${(i * 4.1 + Math.random() * 3) % 100}%`,
        delay: `${(Math.random() * 2.4).toFixed(2)}s`,
        dur: `${(1.5 + Math.random() * 1.6).toFixed(2)}s`,
        h: 24 + Math.round(Math.random() * 40),
        o: 0.12 + Math.random() * 0.22,
      })),
    [],
  );

  const handleGameOver = (score: number, drinks: number, perfects: number, log: DrinkLogEntry[]) => {
    setResult({ score, drinks, perfects, log });
    setPhase('over');
  };

  const handleClaim = async () => {
    if (claimedRef.current) return;
    claimedRef.current = true;
    setClaiming(true);
    sfxClaim();
    stopAllAudio();
    try {
      await onClaim(result.score);
    } finally {
      onClose();
    }
  };

  const springIn = reduceMotion
    ? { duration: 0.01 }
    : { type: 'spring' as const, bounce: 0.5, duration: 0.7 };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {!reduceMotion && (
            <style>{`
              @keyframes pbr-rain-fall {
                from { transform: translateY(-12vh); }
                to   { transform: translateY(112vh); }
              }
            `}</style>
          )}
          <motion.div
            className="relative flex w-[min(420px,94vw)] flex-col overflow-hidden rounded-3xl border-2 border-amber-200/30 bg-gradient-to-b from-slate-800 via-slate-900 to-stone-950 shadow-2xl"
            initial={{ scale: 0.6, y: 60, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 40, opacity: 0 }}
            transition={springIn}
          >
            {/* ── The rainy Pike St. window behind everything ── */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              {/* City-light blobs bleeding through wet glass */}
              <div className="absolute -left-6 top-10 h-40 w-40 rounded-full bg-amber-400/10 blur-2xl" />
              <div className="absolute right-0 top-32 h-32 w-32 rounded-full bg-rose-400/10 blur-2xl" />
              <div className="absolute bottom-10 left-1/3 h-36 w-36 rounded-full bg-cyan-300/10 blur-2xl" />
              {!reduceMotion &&
                rain.map((d, i) => (
                  <span
                    key={i}
                    className="absolute top-0 w-px rounded-full bg-gradient-to-b from-transparent via-sky-100 to-sky-200"
                    style={{
                      left: d.left,
                      height: d.h,
                      opacity: d.o,
                      animation: `pbr-rain-fall ${d.dur} linear ${d.delay} infinite`,
                    }}
                  />
                ))}
            </div>

            {/* ✕ — mid-shift this forfeits; the daily ticket is spent either way */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-sm font-bold text-white/80 hover:bg-black/60"
            >
              ✕
            </button>

            {/* ── Receipt-printer HUD: lives above the canvas, 4 Hz ── */}
            {(phase === 'playing' || phase === 'over') && (
              <div className="relative z-10 mx-auto mt-3 w-[86%]">
                <div className="rounded-t-md bg-slate-700 px-3 pb-1 pt-1.5 shadow-inner">
                  <div className="h-1 rounded-full bg-slate-950/70" />
                </div>
                <div className="flex items-center justify-between border-x border-b border-stone-300/20 bg-[#f7f2e8] px-3 py-1.5 font-mono text-[11px] font-bold tracking-tight text-stone-800 [clip-path:polygon(0_0,100%_0,100%_88%,97%_100%,94%_88%,91%_100%,88%_88%,85%_100%,82%_88%,79%_100%,76%_88%,73%_100%,70%_88%,67%_100%,64%_88%,61%_100%,58%_88%,55%_100%,52%_88%,49%_100%,46%_88%,43%_100%,40%_88%,37%_100%,34%_88%,31%_100%,28%_88%,25%_100%,22%_88%,19%_100%,16%_88%,13%_100%,10%_88%,7%_100%,4%_88%,0_100%)]">
                  <span>⏱ {fmtTime(hud.timeLeft)}</span>
                  <span>🪙 {hud.score.toLocaleString()}</span>
                  <span className={hud.combo > 1 ? 'text-orange-600' : 'text-stone-400'}>
                    RUSH ×{hud.combo.toFixed(1).replace(/\.0$/, '')}
                  </span>
                </div>
              </div>
            )}

            <div className="relative h-[min(540px,66vh)] w-full">
              {phase === 'intro' && (
                // Scroll-safe centering: `my-auto` centers when the column
                // fits and top-aligns + scrolls when it doesn't (short
                // viewports would otherwise clip the Clock In button
                // inside the modal's overflow-hidden).
                <div className="relative z-10 flex h-full flex-col overflow-y-auto px-6 py-4">
                  <div className="my-auto flex w-full flex-col items-center gap-3 text-center">
                  <motion.div
                    className="text-5xl"
                    animate={reduceMotion ? undefined : { y: [0, -8, 0], rotate: [-5, 5, -5] }}
                    transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
                  >
                    ☕
                  </motion.div>
                  <h2 className="text-2xl font-black uppercase italic tracking-wide text-amber-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
                    Pike St. Barista Rush
                  </h2>
                  <p className="text-sm text-amber-50/90">
                    The morning line is out the door. Three stations, one drink at a time.
                    <br />
                    <span className="font-bold text-white">{runSeconds} seconds. Perfect pours stack the Caffeine Rush.</span>
                    <br />
                    <span className="text-xs text-amber-100/60">🔊 Sound on — the lo-fi and the steam do half the timing for you</span>
                  </p>
                  <div className="w-full space-y-2 rounded-2xl bg-black/30 p-3 text-left text-sm">
                    {LEGEND.map((row) => (
                      <div key={row.name} className="flex items-start gap-2.5">
                        <span className="text-base leading-5">{row.icon}</span>
                        <span className="flex-1 text-amber-50">
                          <span className="font-black text-amber-300">{row.name}</span>
                          <span className="block text-xs text-amber-100/70">{row.hint}</span>
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-white/10 pt-1.5 text-center text-xs font-bold text-red-300">
                      ⚠️ Overfill the shot and the drink is RUINED — rush resets!
                    </div>
                  </div>
                  <motion.button
                    onClick={() => {
                      primeAudio(); // MUST happen inside this tap — iOS unlocks audio only on a user gesture
                      startBgm();
                      setPhase('playing');
                    }}
                    whileTap={{ scale: 0.92 }}
                    className="mt-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-amber-950 shadow-lg shadow-amber-500/30"
                  >
                    ☕ Clock In!
                  </motion.button>
                  </div>
                </div>
              )}

              {(phase === 'playing' || phase === 'over') && (
                <BaristaRushCanvas
                  onGameOver={handleGameOver}
                  onHudTick={(timeLeft, score, combo) => setHud({ timeLeft, score, combo })}
                  runSeconds={runSeconds}
                  className="h-full w-full"
                />
              )}

              {/* ── The shift receipt: prints over the frozen final frame ── */}
              <AnimatePresence>
                {phase === 'over' && (
                  <motion.div
                    className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <motion.div
                      className="my-auto w-full max-w-[300px] bg-[#f7f2e8] px-4 pb-5 pt-4 font-mono text-[11px] leading-relaxed text-stone-800 shadow-2xl [clip-path:polygon(0_0,100%_0,100%_98%,96%_100%,92%_98%,88%_100%,84%_98%,80%_100%,76%_98%,72%_100%,68%_98%,64%_100%,60%_98%,56%_100%,52%_98%,48%_100%,44%_98%,40%_100%,36%_98%,32%_100%,28%_98%,24%_100%,20%_98%,16%_100%,12%_98%,8%_100%,4%_98%,0_100%)]"
                      initial={reduceMotion ? { opacity: 0 } : { y: -420, opacity: 1 }}
                      animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
                      transition={reduceMotion ? { duration: 0.01 } : { duration: 0.9, ease: [0.2, 0.9, 0.3, 1] }}
                    >
                      <div className="text-center">
                        <div className="text-sm font-black tracking-widest">PIKE ST. ESPRESSO</div>
                        <div className="text-[9px] text-stone-500">1912 PIKE PL · SEATTLE, WA</div>
                        <div className="mt-1 border-b border-dashed border-stone-400" />
                      </div>

                      <div className="mt-2 space-y-0.5">
                        {result.log.slice(0, 8).map((d, i) => (
                          <div key={i} className="flex justify-between gap-2">
                            <span className="truncate">{d.name}</span>
                            <span className="whitespace-nowrap text-stone-500">{GRADE_MARK[d.grade]}</span>
                            <span className="w-12 text-right font-bold">{d.chips.toLocaleString()}</span>
                          </div>
                        ))}
                        {result.log.length > 8 && (
                          <div className="text-center text-stone-400">… +{result.log.length - 8} more</div>
                        )}
                        {result.log.length === 0 && <div className="text-center text-stone-400">— no drinks served —</div>}
                      </div>

                      <div className="mt-2 border-b border-dashed border-stone-400" />
                      <div className="mt-1 flex justify-between text-[10px] text-stone-500">
                        <span>DRINKS: {result.drinks}</span>
                        <span>PERFECT: {result.perfects}</span>
                      </div>
                      <div className="mt-1 flex items-end justify-between">
                        <span className="text-sm font-black">TOTAL CHIPS</span>
                        <span className="text-lg font-black">
                          <CountUp to={result.score} />
                        </span>
                      </div>

                      <div className="mt-2 border-b border-dashed border-stone-400" />
                      <div className="mt-2 text-center">
                        <div className="text-[9px] text-stone-500">SHIFT PERFORMANCE REVIEW</div>
                        <div className="text-base font-black tracking-widest text-stone-900">
                          «{shiftTitle(result)}»
                        </div>
                        <div className="mt-1 text-[9px] text-stone-400">THANK YOU · COME AGAIN · ☂</div>
                      </div>

                      <motion.button
                        onClick={handleClaim}
                        disabled={claiming}
                        whileTap={{ scale: 0.92 }}
                        animate={reduceMotion || claiming ? undefined : { scale: [1, 1.05, 1] }}
                        transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                        className="mt-3 w-full rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-6 py-2.5 font-sans text-sm font-black uppercase tracking-wider text-amber-950 shadow-lg shadow-amber-500/40 disabled:opacity-60"
                      >
                        {claiming ? 'Claiming…' : `Claim ${result.score.toLocaleString()} Chips`}
                      </motion.button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
