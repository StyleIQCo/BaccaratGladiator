// ═══════════════════════════════════════════════════════════════════
//  RAINIER SUMMIT SCRAMBLE — Framer Motion modal wrapper.
//
//  React OWNS this layer: the modal chrome, the base-camp intro, and
//  the EXPEDITION COMPLETE results overlay. The canvas between them
//  runs entirely on refs. (Same beat sheet as FishTossChallenge —
//  intro → playing → over.)
//
//  Audio contract: the "Begin Ascent" tap is the iOS gesture that
//  primes Web Audio, bleats the goat, and starts the BGM (howling
//  wind + tribal drums, rainierSfx.ts). BGM stops the moment the run
//  ends — the canvas has already played the game-over cue by then —
//  and on close/unmount so no wind howls over the Demo Hub.
//
//  The results card submits the run via onSubmitScore — live builds
//  pass the server submit, the Demo Hub passes a local GT-merge.
//  Closing mid-run forfeits the run; scores only leave through the
//  results screen.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { RainierCanvas } from './RainierCanvas';
import { BASE_ALT_M, SUMMIT_ALT_M, type GameOverReason } from './useRainierPhysics';
import { primeAudio, sfxClaim, startBgm, stopBgm } from './rainierSfx';

export interface RainierSummitGameProps {
  open: boolean;
  onClose: () => void;
  /** Log the run on the arcade board (server call lives up here — the game never touches the socket). */
  onSubmitScore: (score: number) => void | Promise<void>;
  /** Fired the instant play begins — live builds wire the run-proof fetch here. */
  onRunStart?: () => void;
  runSeconds?: number;   // default 30 — the summit clock
}

type Phase = 'intro' | 'playing' | 'over';

/** Eased count-up for the final reveal. Post-game, so setState is fair game again. */
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

const LEGEND: { icon: string; name: string; pts: string; good: boolean }[] = [
  { icon: '🧗', name: 'Golden Carabiner', pts: '+100', good: true },
  { icon: '🏔', name: 'Reach the Summit', pts: '+5,000', good: true },
  { icon: '🧊', name: 'Falling Serac', pts: 'GAME OVER', good: false },
  { icon: '🌨', name: 'Whiteout — hold your line!', pts: '3s BLIND', good: false },
];

const OVER_COPY: Record<GameOverReason, { icon: string; title: string; blurb: string }> = {
  summit: { icon: '🏔', title: 'Summit Reached!', blurb: 'The flag flies at 4,392 m. The whole arcade heard the bleat.' },
  fell:   { icon: '🐐', title: 'Long Way Down…', blurb: 'The mountain scrolled on without you. Base camp keeps the kettle warm.' },
  hazard: { icon: '🧊', title: 'Crushed by a Serac!', blurb: 'The icefall always gets a vote. Duck faster next expedition.' },
};

export function RainierSummitGame({
  open, onClose, onSubmitScore, onRunStart, runSeconds = 30,
}: RainierSummitGameProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [finalScore, setFinalScore] = useState(0);
  const [altitude, setAltitude] = useState(BASE_ALT_M);
  const [reason, setReason] = useState<GameOverReason>('summit');
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);   // double-tap guard across the async submit

  // Fresh expedition every time the modal opens.
  useEffect(() => {
    if (open) {
      setPhase('intro');
      setFinalScore(0);
      setAltitude(BASE_ALT_M);
      setReason('summit');
      setSubmitting(false);
      submittedRef.current = false;
    } else {
      stopBgm();   // close mid-run: kill the wind with the modal
    }
  }, [open]);
  useEffect(() => () => stopBgm(), []);   // unmount safety net

  const handleGameOver = (score: number, r: GameOverReason, altitudeM: number) => {
    stopBgm();     // the canvas already played the game-over cue
    setFinalScore(score);
    setAltitude(altitudeM);
    setReason(r);
    setPhase('over');
  };

  const handleSubmit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    sfxClaim();
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
            className="relative flex w-[min(420px,94vw)] flex-col overflow-hidden rounded-3xl border-2 border-sky-300/40 bg-gradient-to-b from-indigo-950 to-slate-950 shadow-2xl"
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

            <div className="relative h-[min(560px,72vh)] w-full">
              {phase === 'intro' && (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                  <motion.div
                    className="text-6xl"
                    animate={reduceMotion ? undefined : { y: [0, -14, 0], rotate: [-6, 8, -6] }}
                    transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                  >
                    🐐
                  </motion.div>
                  <h2 className="text-2xl font-black uppercase italic tracking-wide text-amber-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
                    Rainier Summit Scramble
                  </h2>
                  <p className="text-sm text-sky-100/90">
                    The mountain scrolls, the goat bounces — drag left and right
                    to land every icy ledge. Snag carabiners, dodge the icefall,
                    and don't let the screen leave you behind.
                    <br />
                    <span className="font-bold text-white">
                      Survive {runSeconds} seconds to plant the flag at {SUMMIT_ALT_M.toLocaleString()} m!
                    </span>
                  </p>
                  <div className="w-full space-y-1.5 rounded-2xl bg-black/30 p-3 text-left text-sm">
                    {LEGEND.map(row => (
                      <div key={row.name} className="flex items-center gap-2.5">
                        <span className="w-6 text-center text-base">{row.icon}</span>
                        <span className="flex-1 text-sky-50">{row.name}</span>
                        <span className={`font-black ${row.good ? 'text-amber-300' : 'text-red-400'}`}>
                          {row.pts}
                        </span>
                      </div>
                    ))}
                  </div>
                  <motion.button
                    onClick={() => {
                      primeAudio();   // MUST happen inside this tap — iOS unlocks audio only on a user gesture
                      startBgm();     // wind + drums for the whole climb; the canvas bleats the start cue
                      onRunStart?.(); // live builds fetch the run proof here
                      setPhase('playing');
                    }}
                    whileTap={{ scale: 0.92 }}
                    className="mt-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-amber-950 shadow-lg shadow-amber-500/30"
                  >
                    Begin Ascent
                  </motion.button>
                </div>
              )}

              {(phase === 'playing' || phase === 'over') && (
                <RainierCanvas
                  onGameOver={handleGameOver}
                  runSeconds={runSeconds}
                  className="h-full w-full"
                />
              )}

              {/* ── EXPEDITION COMPLETE: fades in over the frozen final frame ── */}
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
                      <div className="text-5xl">{OVER_COPY[reason].icon}</div>
                      <p className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-sky-200/70">
                        Expedition Complete
                      </p>
                      <h3 className="text-xl font-black uppercase italic tracking-wide text-amber-300">
                        {OVER_COPY[reason].title}
                      </h3>
                      <div className="flex w-full items-stretch gap-2">
                        <div className="flex-1 rounded-2xl bg-black/30 px-3 py-3">
                          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-sky-100/70">Altitude</p>
                          <div className="text-2xl font-black text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.5)]">
                            <CountUp to={altitude} />
                            <span className="text-sm text-sky-200/80"> m</span>
                          </div>
                        </div>
                        <div className="flex-1 rounded-2xl bg-black/30 px-3 py-3">
                          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-sky-100/70">Chips</p>
                          <div className="text-2xl font-black text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.5)]">
                            <CountUp to={finalScore} />
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-sky-200/70">{OVER_COPY[reason].blurb}</p>
                      <motion.button
                        onClick={handleSubmit}
                        disabled={submitting}
                        whileTap={{ scale: 0.92 }}
                        animate={reduceMotion || submitting ? undefined : { scale: [1, 1.07, 1] }}
                        transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                        className="mt-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-amber-950 shadow-lg shadow-amber-500/40 disabled:opacity-60"
                      >
                        {submitting ? 'Logging…' : finalScore > 0 ? 'Claim Chips' : 'Done'}
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
