// ═══════════════════════════════════════════════════════════════════
//  SALISH SEA WHALE WATCH — Framer Motion modal wrapper.
//
//  React OWNS this layer: the carved-wood modal chrome, the intro
//  screen, and the GOLDEN HOUR results overlay. The canvas between
//  them runs entirely on refs. (Same beat sheet as FishTossChallenge —
//  intro → playing → over.)
//
//  Audio lifecycle lives here: "Push Off" primes Web Audio inside the
//  user gesture (iOS requirement) and starts the ocean-ambience BGM;
//  game over and every close path stop it. Closing mid-run forfeits
//  the run; scores only leave through the results screen.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { SalishSeaCanvas } from './SalishSeaCanvas';
import { RUN_SECONDS_DEFAULT, type RunStats } from './useWhaleWatchPhysics';
import { primeAudio, startBgm, stopBgm, sfxSunset } from './whaleWatchSfx';

export interface WhaleWatchGameProps {
  open: boolean;
  onClose: () => void;
  /** Log the run on the board (server call lives up here — the game never touches the socket). */
  onSubmitScore: (score: number) => void | Promise<void>;
  /** Fired the instant play begins — live builds wire the run-proof fetch here. */
  onRunStart?: () => void;
  runSeconds?: number;       // default 45 — sunset ends the watch
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

const LEGEND: { swatch: string; name: string; pts: string }[] = [
  { swatch: '#2c353d', name: "Dall's Porpoise (fast & low)", pts: '+100' },
  { swatch: '#0b1015', name: 'Orca (big arc)', pts: '+500' },
  { swatch: '#243642', name: 'Humpback Tail Slap (hangs)', pts: '+1,000' },
];

const EMPTY_STATS: RunStats = { perfects: 0, goods: 0, misses: 0, missedSightings: 0 };

export function WhaleWatchGame({
  open, onClose, onSubmitScore, onRunStart, runSeconds = RUN_SECONDS_DEFAULT,
}: WhaleWatchGameProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [finalScore, setFinalScore] = useState(0);
  const [stats, setStats] = useState<RunStats>(EMPTY_STATS);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);   // double-tap guard across the async submit

  // Fresh run every time the modal opens; the sea goes quiet whenever
  // it closes (any path) or the component unmounts.
  useEffect(() => {
    if (open) {
      setPhase('intro');
      setFinalScore(0);
      setStats(EMPTY_STATS);
      setSubmitting(false);
      submittedRef.current = false;
    } else {
      stopBgm();
    }
    return stopBgm;
  }, [open]);

  const handleGameOver = (score: number, runStats: RunStats) => {
    stopBgm();
    sfxSunset();
    setFinalScore(score);
    setStats(runStats);
    setPhase('over');
  };

  const handleSubmit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      if (finalScore > 0) await onSubmitScore(finalScore);
    } finally {
      onClose();
    }
  };

  const attempts = stats.perfects + stats.goods + stats.misses + stats.missedSightings;
  const accuracy = attempts > 0 ? Math.round(((stats.perfects + stats.goods) / attempts) * 100) : null;

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
          {/* Carved-wood frame: cedar gradient shell around the sea. */}
          <motion.div
            className="relative w-[min(420px,94vw)] rounded-[30px] bg-gradient-to-b from-amber-700 via-amber-900 to-amber-950 p-2 shadow-2xl"
            initial={{ scale: 0.6, y: 60, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 40, opacity: 0 }}
            transition={springIn}
          >
            <div className="relative flex flex-col overflow-hidden rounded-3xl border-2 border-amber-500/25 bg-gradient-to-b from-slate-900 to-cyan-950 shadow-[inset_0_0_28px_rgba(0,0,0,0.65)]">
              {/* ✕ — mid-run this forfeits; the run is spent either way */}
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
                      animate={reduceMotion ? undefined : { y: [0, -10, 0], rotate: [-6, 8, -6] }}
                      transition={{ repeat: Infinity, duration: 2.6, ease: 'easeInOut' }}
                    >
                      🐋
                    </motion.div>
                    <h2 className="text-2xl font-black uppercase italic tracking-wide text-cyan-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
                      Salish Sea Whale Watch
                    </h2>
                    <p className="text-sm text-cyan-100/90">
                      Paddle the canoe under the shadow. Hold to raise your
                      spotting ring — release at the very top of the breach.
                      <br />
                      <span className="font-bold text-white">
                        Nail the apex for a PERFECT ×2. {runSeconds} seconds until sunset.
                      </span>
                    </p>
                    <div className="w-full space-y-1.5 rounded-2xl bg-black/30 p-3 text-left text-sm">
                      {LEGEND.map(row => (
                        <div key={row.name} className="flex items-center gap-2.5">
                          <span
                            className="inline-block h-3.5 w-6 rounded-full border border-cyan-200/30"
                            style={{ background: row.swatch }}
                          />
                          <span className="flex-1 text-cyan-50">{row.name}</span>
                          <span className="font-black text-cyan-300">{row.pts}</span>
                        </div>
                      ))}
                      <div className="pt-1 text-center text-xs text-cyan-200/60">
                        Too soon or too late scores nothing — patience is the game.
                      </div>
                    </div>
                    <motion.button
                      onClick={() => {
                        primeAudio();     // MUST happen inside this tap (iOS)
                        startBgm();
                        onRunStart?.();   // live builds fetch the run proof here
                        setPhase('playing');
                      }}
                      whileTap={{ scale: 0.92 }}
                      className="mt-1 rounded-full bg-gradient-to-b from-cyan-300 to-teal-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-slate-950 shadow-lg shadow-cyan-500/30"
                    >
                      Push Off
                    </motion.button>
                  </div>
                )}

                {(phase === 'playing' || phase === 'over') && (
                  <SalishSeaCanvas
                    onGameOver={handleGameOver}
                    runSeconds={runSeconds}
                    className="h-full w-full"
                  />
                )}

                {/* ── GOLDEN HOUR: bounces in over the frozen dusk frame ── */}
                <AnimatePresence>
                  {phase === 'over' && (
                    <motion.div
                      className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/60 p-5"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <motion.div
                        className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-cyan-300/50 bg-gradient-to-b from-slate-800 to-slate-900 px-6 py-7 text-center shadow-2xl"
                        initial={{ scale: 0.3, y: 90, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        transition={reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.55, duration: 0.8 }}
                      >
                        <div className="text-5xl">🌅</div>
                        <h3 className="text-xl font-black uppercase italic tracking-wide text-amber-300">
                          Golden Hour
                        </h3>
                        <p className="text-sm font-bold uppercase tracking-wide text-cyan-100/80">
                          The sun's down — paddle in.
                        </p>
                        <div className="text-4xl font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.5)]">
                          <CountUp to={finalScore} />{' '}
                          <span className="text-2xl text-cyan-300">chips</span>
                        </div>
                        <div className="flex w-full justify-center gap-4 rounded-2xl bg-black/30 px-4 py-2.5 text-sm">
                          <span className="font-bold text-cyan-300">⭐ ×{stats.perfects}</span>
                          <span className="font-bold text-cyan-50">👍 ×{stats.goods}</span>
                          <span className="font-bold text-red-300">💨 ×{stats.misses + stats.missedSightings}</span>
                          {accuracy !== null && (
                            <span className="font-black text-amber-300">{accuracy}%</span>
                          )}
                        </div>
                        <motion.button
                          onClick={handleSubmit}
                          disabled={submitting}
                          whileTap={{ scale: 0.92 }}
                          animate={reduceMotion || submitting ? undefined : { scale: [1, 1.07, 1] }}
                          transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                          className="mt-2 rounded-full bg-gradient-to-b from-cyan-300 to-teal-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-slate-950 shadow-lg shadow-cyan-500/40 disabled:opacity-60"
                        >
                          {submitting ? 'Logging…' : finalScore > 0 ? 'Log the Voyage' : 'Done'}
                        </motion.button>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
