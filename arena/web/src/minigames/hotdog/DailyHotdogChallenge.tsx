// ═══════════════════════════════════════════════════════════════════
//  DAILY HOTDOG CHALLENGE — Framer Motion modal wrapper.
//
//  React OWNS this layer: the modal chrome, the intro screen, and the
//  results overlay. The canvas between them runs entirely on refs.
//
//  Beat sheet:
//    1. intro   — modal springs in, topping legend, "DROP IN!" button.
//    2. playing — HotdogCanvas mounts and starts immediately; the only
//                 React work per run is the single onGameOver callback.
//    3. over    — the frozen final frame stays visible underneath while
//                 the results card bounces in: "LUNCHTIME OVER! YOU
//                 CAUGHT {n} CHIPS!" + pulsing Claim button.
//
//  Closing mid-run forfeits the run (daily challenge = one attempt);
//  chips are only granted through onClaim on the results screen.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { HotdogCanvas } from './HotdogCanvas';
import { primeAudio, sfxClaim } from './hotdogSfx';
import type { GameOverReason, HazardMode } from './useHotdogPhysics';

export interface DailyHotdogChallengeProps {
  open: boolean;
  onClose: () => void;
  /** Award the chips (server call lives up here — the game never touches the wallet). */
  onClaim: (chips: number) => void | Promise<void>;
  hazardMode?: HazardMode;   // default 'end_run': one burnt dog ends the drop
  runSeconds?: number;       // default 30
}

type Phase = 'intro' | 'playing' | 'over';

/** Eased count-up for the final score reveal. Post-game, so setState is fair game again. */
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

const LEGEND: { swatch: string; name: string; chips: string }[] = [
  { swatch: '#d99a4e', name: 'Plain Dog', chips: '+50' },
  { swatch: '#a5651e', name: 'Bavarian Pretzel', chips: '+150' },
  { swatch: '#f5c518', name: 'Mustard & Relish', chips: '+200' },
  { swatch: '#f09f1f', name: 'Beer Stein — Prost!', chips: '+350' },
  { swatch: '#ff8c3b', name: 'Chili Cheese (wobbly!)', chips: '+500' },
  { swatch: '#2e2624', name: 'Burnt Dog', chips: 'GAME OVER' },
];

export function DailyHotdogChallenge({
  open, onClose, onClaim, hazardMode = 'end_run', runSeconds = 30,
}: DailyHotdogChallengeProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [finalScore, setFinalScore] = useState(0);
  const [reason, setReason] = useState<GameOverReason>('time');
  const [claiming, setClaiming] = useState(false);
  const claimedRef = useRef(false);   // double-tap guard across the async claim

  // Fresh run every time the modal opens.
  useEffect(() => {
    if (open) {
      setPhase('intro');
      setFinalScore(0);
      setReason('time');
      setClaiming(false);
      claimedRef.current = false;
    }
  }, [open]);

  const handleGameOver = (score: number, r: GameOverReason) => {
    setFinalScore(score);
    setReason(r);
    setPhase('over');
  };

  const handleClaim = async () => {
    if (claimedRef.current) return;
    claimedRef.current = true;
    setClaiming(true);
    sfxClaim();
    try {
      await onClaim(finalScore);
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
          <motion.div
            className="relative flex w-[min(420px,94vw)] flex-col overflow-hidden rounded-3xl border-2 border-sky-300/40 bg-gradient-to-b from-sky-900 to-slate-900 shadow-2xl"
            initial={{ scale: 0.6, y: 60, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 40, opacity: 0 }}
            transition={springIn}
          >
            {/* ✕ — mid-run this forfeits; the daily attempt is spent either way */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-sm font-bold text-white/80 hover:bg-black/60"
            >
              ✕
            </button>

            <div className="relative h-[min(540px,68vh)] w-full">
              {phase === 'intro' && (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                  <motion.div
                    className="text-6xl"
                    animate={reduceMotion ? undefined : { y: [0, -10, 0], rotate: [-6, 6, -6] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                  >
                    🌭
                  </motion.div>
                  <h2 className="text-2xl font-black uppercase italic tracking-wide text-amber-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
                    Hotdog Parachute Drop
                  </h2>
                  <p className="text-sm text-sky-100/90">
                    Steer Gretchen's basket — catch her lunch, dodge the burnt ones.
                    <br />
                    <span className="font-bold text-white">{runSeconds} seconds. Guten Appetit!</span>
                    <br />
                    <span className="text-xs text-sky-200/70">🔊 Best with sound on — the accordion band is waiting</span>
                  </p>
                  <div className="w-full space-y-1.5 rounded-2xl bg-black/30 p-3 text-left text-sm">
                    {LEGEND.map(row => (
                      <div key={row.name} className="flex items-center gap-2.5">
                        <span
                          className="inline-block h-3.5 w-6 rounded-full border border-black/40"
                          style={{ background: row.swatch }}
                        />
                        <span className="flex-1 text-sky-50">{row.name}</span>
                        <span className={`font-black ${row.chips.startsWith('+') ? 'text-amber-300' : 'text-red-400'}`}>
                          {row.chips}
                        </span>
                      </div>
                    ))}
                  </div>
                  <motion.button
                    onClick={() => {
                      primeAudio();   // MUST happen inside this tap — iOS unlocks audio only on a user gesture
                      setPhase('playing');
                    }}
                    whileTap={{ scale: 0.92 }}
                    className="mt-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-amber-950 shadow-lg shadow-amber-500/30"
                  >
                    Drop In!
                  </motion.button>
                </div>
              )}

              {(phase === 'playing' || phase === 'over') && (
                <HotdogCanvas
                  onGameOver={handleGameOver}
                  hazardMode={hazardMode}
                  runSeconds={runSeconds}
                  className="h-full w-full"
                />
              )}

              {/* ── Results: bounces in over the frozen final frame ── */}
              <AnimatePresence>
                {phase === 'over' && (
                  <motion.div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/60 p-5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <motion.div
                      className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-amber-300/50 bg-gradient-to-b from-slate-800 to-slate-900 px-6 py-7 text-center shadow-2xl"
                      initial={{ scale: 0.3, y: 90, opacity: 0 }}
                      animate={{ scale: 1, y: 0, opacity: 1 }}
                      transition={reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.55, duration: 0.8 }}
                    >
                      <div className="text-5xl">{reason === 'hazard' ? '🔥' : '🏁'}</div>
                      <h3 className="text-xl font-black uppercase italic tracking-wide text-amber-300">
                        {reason === 'hazard' ? 'Burnt to a Crisp!' : 'Lunchtime Over!'}
                      </h3>
                      <p className="text-sm font-bold uppercase tracking-wide text-sky-100/80">You caught</p>
                      <div className="text-4xl font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.5)]">
                        <CountUp to={finalScore} />{' '}
                        <span className="text-2xl text-amber-300">chips!</span>
                      </div>
                      <motion.button
                        onClick={handleClaim}
                        disabled={claiming}
                        whileTap={{ scale: 0.92 }}
                        animate={reduceMotion || claiming ? undefined : { scale: [1, 1.07, 1] }}
                        transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                        className="mt-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-amber-950 shadow-lg shadow-amber-500/40 disabled:opacity-60"
                      >
                        {claiming ? 'Claiming…' : 'Claim Chips'}
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
