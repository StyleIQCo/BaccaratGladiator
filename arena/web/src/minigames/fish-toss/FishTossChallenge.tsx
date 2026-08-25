// ═══════════════════════════════════════════════════════════════════
//  PIKE PLACE FISH TOSS — Framer Motion modal wrapper.
//
//  React OWNS this layer: the modal chrome, the intro screen, and the
//  results overlay. The canvas between them runs entirely on refs.
//  (Same beat sheet as DailyHotdogChallenge — intro → playing → over.)
//
//  The results card submits the run to the Weekly Fishmonger board via
//  onSubmitScore — live builds pass useFishmonger's submit, the Demo
//  Hub passes a local GT-merge. Closing mid-run forfeits the run;
//  scores only leave through the results screen. No SFX yet — the
//  market chant audio pass rides with the hotdog accordion follow-up.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { FishTossCanvas } from './FishTossCanvas';
import type { GameOverReason, HazardMode } from './useFishTossPhysics';

export interface FishTossChallengeProps {
  open: boolean;
  onClose: () => void;
  /** Log the run on the weekly board (server call lives up here — the game never touches the socket). */
  onSubmitScore: (score: number) => void | Promise<void>;
  /** Fired the instant play begins — live builds wire useFishmonger's
   *  startRun here so the server issues the run proof the submit needs. */
  onRunStart?: () => void;
  hazardMode?: HazardMode;   // default 'end_run': the old boot ends the toss
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

const LEGEND: { swatch: string; name: string; pts: string }[] = [
  { swatch: '#c1272d', name: 'Sockeye', pts: '+50' },
  { swatch: '#cfd8dc', name: 'Herring', pts: '+100' },
  { swatch: '#d98ea4', name: 'Rainbow Trout', pts: '+150' },
  { swatch: '#d24d2a', name: 'Dungeness Crab', pts: '+300' },
  { swatch: '#3f6d7d', name: 'King Salmon (flops!)', pts: '+500' },
  { swatch: '#6b4a2f', name: 'The Old Boot', pts: 'GAME OVER' },
];

export function FishTossChallenge({
  open, onClose, onSubmitScore, onRunStart, hazardMode = 'end_run', runSeconds = 30,
}: FishTossChallengeProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [finalScore, setFinalScore] = useState(0);
  const [reason, setReason] = useState<GameOverReason>('time');
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);   // double-tap guard across the async submit

  // Fresh run every time the modal opens.
  useEffect(() => {
    if (open) {
      setPhase('intro');
      setFinalScore(0);
      setReason('time');
      setSubmitting(false);
      submittedRef.current = false;
    }
  }, [open]);

  const handleGameOver = (score: number, r: GameOverReason) => {
    setFinalScore(score);
    setReason(r);
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
            className="relative flex w-[min(420px,94vw)] flex-col overflow-hidden rounded-3xl border-2 border-cyan-300/40 bg-gradient-to-b from-cyan-950 to-slate-900 shadow-2xl"
            initial={{ scale: 0.6, y: 60, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 40, opacity: 0 }}
            transition={springIn}
          >
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
                    animate={reduceMotion ? undefined : { y: [0, -10, 0], rotate: [-8, 10, -8] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                  >
                    🐟
                  </motion.div>
                  <h2 className="text-2xl font-black uppercase italic tracking-wide text-orange-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
                    Pike Place Fish Toss
                  </h2>
                  <p className="text-sm text-cyan-100/90">
                    Slide the catcher up and down the dock — snag every fish the
                    stall hurls your way. Whatever you do, don't catch the boot.
                    <br />
                    <span className="font-bold text-white">{runSeconds} seconds. Best run counts all week!</span>
                  </p>
                  <div className="w-full space-y-1.5 rounded-2xl bg-black/30 p-3 text-left text-sm">
                    {LEGEND.map(row => (
                      <div key={row.name} className="flex items-center gap-2.5">
                        <span
                          className="inline-block h-3.5 w-6 rounded-full border border-black/40"
                          style={{ background: row.swatch }}
                        />
                        <span className="flex-1 text-cyan-50">{row.name}</span>
                        <span className={`font-black ${row.pts.startsWith('+') ? 'text-orange-300' : 'text-red-400'}`}>
                          {row.pts}
                        </span>
                      </div>
                    ))}
                  </div>
                  <motion.button
                    onClick={() => {
                      onRunStart?.(); // live builds fetch the run proof here
                      setPhase('playing');
                    }}
                    whileTap={{ scale: 0.92 }}
                    className="mt-1 rounded-full bg-gradient-to-b from-orange-300 to-orange-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-orange-950 shadow-lg shadow-orange-500/30"
                  >
                    Toss 'Em!
                  </motion.button>
                </div>
              )}

              {(phase === 'playing' || phase === 'over') && (
                <FishTossCanvas
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
                      className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-orange-300/50 bg-gradient-to-b from-slate-800 to-slate-900 px-6 py-7 text-center shadow-2xl"
                      initial={{ scale: 0.3, y: 90, opacity: 0 }}
                      animate={{ scale: 1, y: 0, opacity: 1 }}
                      transition={reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.55, duration: 0.8 }}
                    >
                      <div className="text-5xl">{reason === 'hazard' ? '🥾' : '🎣'}</div>
                      <h3 className="text-xl font-black uppercase italic tracking-wide text-orange-300">
                        {reason === 'hazard' ? 'The Old Boot!' : "Time! Dock's Closed!"}
                      </h3>
                      <p className="text-sm font-bold uppercase tracking-wide text-cyan-100/80">Your haul</p>
                      <div className="text-4xl font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.5)]">
                        <CountUp to={finalScore} />{' '}
                        <span className="text-2xl text-orange-300">pts</span>
                      </div>
                      <p className="text-xs text-cyan-200/70">
                        Beats your weekly best? It goes straight on the Top Fishmonger board.
                      </p>
                      <motion.button
                        onClick={handleSubmit}
                        disabled={submitting}
                        whileTap={{ scale: 0.92 }}
                        animate={reduceMotion || submitting ? undefined : { scale: [1, 1.07, 1] }}
                        transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                        className="mt-2 rounded-full bg-gradient-to-b from-orange-300 to-orange-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-orange-950 shadow-lg shadow-orange-500/40 disabled:opacity-60"
                      >
                        {submitting ? 'Logging…' : finalScore > 0 ? 'Log the Catch' : 'Done'}
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
