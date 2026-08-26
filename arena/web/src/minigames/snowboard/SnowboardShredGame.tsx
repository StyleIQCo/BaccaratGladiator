// ═══════════════════════════════════════════════════════════════════
//  SNOQUALMIE NIGHT SHRED — Framer Motion modal wrapper.
//
//  React OWNS this layer: the modal chrome, the intro screen, the
//  Tailwind HUD overlay, and the results card. The canvas between
//  them runs entirely on refs.
//
//  HUD contract: SnoqualmieCanvas quantizes + dedups its onHud sample
//  (integer MPH, whole seconds, combo, 5%-stepped gauge), so setState
//  here fires a handful of times per second — never per frame — and
//  the modal subtree it re-renders is a few dozen cheap nodes.
//
//  Audio beats:
//    1. intro   — silent until the SHRED tap primes WebAudio (the iOS
//                 gesture rule) and kicks the 126 BPM synthwave loop.
//    2. playing — the canvas owns the wind/carve bed + event SFX; the
//                 BGM loop keeps driving underneath from up here.
//    3. over    — canvas freezes its final frame + fires the lodge
//                 cadence; BGM keeps rolling under the results card
//                 and stops when the modal closes.
//
//  Payoff math (shown verbatim on the card):
//      BASE SCORE × MAX COMBO = TOTAL CHIPS
//  Closing mid-run forfeits the run; chips are only granted through
//  onClaim on the results screen.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SnoqualmieCanvas, type HudSample } from './SnoqualmieCanvas';
import { primeAudio, startBgm, stopBgm, sfxClaim } from './snowboardSfx';
import type { RunSummary } from './useSnowboardPhysics';

export interface SnowboardShredGameProps {
  open: boolean;
  onClose: () => void;
  /** Award the chips (server call lives up here — the game never touches the wallet). */
  onClaim: (chips: number) => void | Promise<void>;
  runSeconds?: number;   // default 45 — the distance to the lodge
}

type Phase = 'intro' | 'playing' | 'over';

/** Eased count-up for the payoff reveal. Post-game, so setState is fair game again. */
function CountUp({ to, duration = 1.1 }: { to: number; duration?: number }) {
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

const LEGEND: { swatch: string; name: string; note: string; good: boolean }[] = [
  { swatch: 'linear-gradient(90deg, #ff4fd8, #29e6ff)', name: 'Neon slalom gate', note: '+100 × combo', good: true },
  { swatch: '#c7d6f2', name: 'Kicker ramp — SICK AIR', note: '+1,000', good: true },
  { swatch: '#0d3b24', name: 'Pine tree', note: 'WIPEOUT −500', good: false },
  { swatch: '#3c4258', name: 'Rock', note: 'WIPEOUT −500', good: false },
];

const HUD_ZERO: HudSample = { mph: 0, combo: 0, time: 45, speedFrac: 0, score: 0 };

export function SnowboardShredGame({ open, onClose, onClaim, runSeconds = 45 }: SnowboardShredGameProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [hud, setHud] = useState<HudSample>({ ...HUD_ZERO, time: runSeconds });
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [claiming, setClaiming] = useState(false);
  const claimedRef = useRef(false);   // double-tap guard across the async claim

  // Fresh run every time the modal opens; kill the band when it closes.
  useEffect(() => {
    if (open) {
      setPhase('intro');
      setHud({ ...HUD_ZERO, time: runSeconds });
      setSummary(null);
      setClaiming(false);
      claimedRef.current = false;
    } else {
      stopBgm();
    }
    return stopBgm;
  }, [open, runSeconds]);

  // Stable identity — the canvas effect mounts once and keeps this.
  const handleHud = useCallback((sample: HudSample) => setHud(sample), []);

  const handleGameOver = useCallback((s: RunSummary) => {
    setSummary(s);
    setPhase('over');
  }, []);

  const handleClaim = async () => {
    if (claimedRef.current || !summary) return;
    claimedRef.current = true;
    setClaiming(true);
    sfxClaim();
    try {
      await onClaim(summary.totalChips);
    } finally {
      onClose();
    }
  };

  const springIn = reduceMotion
    ? { duration: 0.01 }
    : { type: 'spring' as const, bounce: 0.5, duration: 0.7 };

  const comboHot = hud.combo >= 2;

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
            className="relative flex w-[min(420px,94vw)] flex-col overflow-hidden rounded-3xl border-2 border-fuchsia-400/40 bg-gradient-to-b from-indigo-950 to-slate-950 shadow-2xl"
            initial={{ scale: 0.6, y: 60, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 40, opacity: 0 }}
            transition={springIn}
          >
            {/* ✕ — mid-run this forfeits; the night session is one attempt */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-sm font-bold text-white/80 hover:bg-black/60"
            >
              ✕
            </button>

            <div className="relative h-[min(560px,70vh)] w-full">
              {phase === 'intro' && (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                  <motion.div
                    className="text-6xl"
                    animate={reduceMotion ? undefined : { y: [0, -10, 0], rotate: [-8, 8, -8] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                  >
                    🏂
                  </motion.div>
                  <h2 className="text-2xl font-black uppercase italic tracking-wide text-cyan-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
                    Snoqualmie{' '}
                    <span className="text-fuchsia-400">Night Shred</span>
                  </h2>
                  <p className="text-sm text-indigo-100/90">
                    Drag to carve. Thread the neon gates, launch the kickers,
                    respect the trees.
                    <br />
                    <span className="font-bold text-white">{runSeconds} seconds down to the lodge.</span>
                    <br />
                    <span className="text-xs text-indigo-200/70">🔊 Sound on — the night session has a soundtrack</span>
                  </p>
                  <div className="w-full space-y-1.5 rounded-2xl bg-black/30 p-3 text-left text-sm">
                    {LEGEND.map(row => (
                      <div key={row.name} className="flex items-center gap-2.5">
                        <span
                          className="inline-block h-3.5 w-6 rounded-full border border-black/40"
                          style={{ background: row.swatch }}
                        />
                        <span className="flex-1 text-indigo-50">{row.name}</span>
                        <span className={`font-black ${row.good ? 'text-cyan-300' : 'text-red-400'}`}>
                          {row.note}
                        </span>
                      </div>
                    ))}
                    <div className="pt-1 text-center text-xs font-bold uppercase tracking-wider text-fuchsia-300/90">
                      Payoff: base score × max combo
                    </div>
                  </div>
                  <motion.button
                    onClick={() => {
                      primeAudio();   // MUST happen inside this tap — iOS unlocks audio only on a user gesture
                      startBgm();
                      setPhase('playing');
                    }}
                    whileTap={{ scale: 0.92 }}
                    className="mt-1 rounded-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 px-12 py-3 text-lg font-black uppercase tracking-wider text-slate-950 shadow-lg shadow-fuchsia-500/30"
                  >
                    Shred ▼
                  </motion.button>
                </div>
              )}

              {(phase === 'playing' || phase === 'over') && (
                <>
                  <SnoqualmieCanvas
                    onGameOver={handleGameOver}
                    onHud={handleHud}
                    runSeconds={runSeconds}
                    className="h-full w-full"
                  />

                  {/* ── Tailwind HUD overlay — pointer-events-none so every
                        touch falls through to the canvas underneath ── */}
                  <div className="pointer-events-none absolute inset-0 z-10">
                    {/* Speed gauge, top-left */}
                    <div className="absolute left-3 top-3 rounded-xl bg-black/35 px-3 py-2 backdrop-blur-[2px]">
                      <div className="flex items-baseline gap-1">
                        <span className="font-mono text-2xl font-black tabular-nums text-cyan-300 drop-shadow-[0_0_6px_rgba(41,230,255,0.8)]">
                          {hud.mph}
                        </span>
                        <span className="text-[0.6rem] font-bold tracking-widest text-cyan-200/70">MPH</span>
                      </div>
                      <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 transition-[width] duration-200"
                          style={{ width: `${Math.round(hud.speedFrac * 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Combo multiplier, top-right — glows once a streak is live */}
                    <div className="absolute right-3 top-12 rounded-xl bg-black/35 px-3 py-2 text-right backdrop-blur-[2px]">
                      <motion.div
                        key={hud.combo}   /* remount per change = pop on every gate */
                        initial={reduceMotion || !comboHot ? false : { scale: 1.6 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', bounce: 0.6, duration: 0.4 }}
                        className={`font-mono text-2xl font-black tabular-nums ${
                          comboHot
                            ? 'text-fuchsia-400 drop-shadow-[0_0_8px_rgba(255,79,216,0.9)]'
                            : 'text-white/40'
                        }`}
                      >
                        {Math.max(hud.combo, 1)}×
                      </motion.div>
                      <div className={`text-[0.6rem] font-bold tracking-widest ${comboHot ? 'text-fuchsia-200/80' : 'text-white/30'}`}>
                        COMBO
                      </div>
                    </div>

                    {/* Clock, top-centre */}
                    <div
                      className={`absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/35 px-4 py-1 font-mono text-lg font-black tabular-nums backdrop-blur-[2px] ${
                        hud.time <= 10 && phase === 'playing' ? 'animate-pulse text-red-400' : 'text-white/90'
                      }`}
                    >
                      {hud.time}s
                    </div>
                  </div>
                </>
              )}

              {/* ── Results: fades in over the frozen final frame ── */}
              <AnimatePresence>
                {phase === 'over' && summary && (
                  <motion.div
                    className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60 p-5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0.01 : 0.45 }}
                  >
                    <motion.div
                      className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-cyan-300/50 bg-gradient-to-b from-indigo-900 to-slate-950 px-6 py-7 text-center shadow-2xl"
                      initial={{ scale: 0.3, y: 90, opacity: 0 }}
                      animate={{ scale: 1, y: 0, opacity: 1 }}
                      transition={reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.55, duration: 0.8 }}
                    >
                      <div className="text-5xl">🏔️</div>
                      <h3 className="text-xl font-black uppercase italic tracking-wide text-cyan-300">
                        Run Complete!
                      </h3>
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-200/70">
                        You made the lodge · {summary.distanceM.toLocaleString()} m shredded
                        {summary.wipeouts > 0 && ` · ${summary.wipeouts} wipeout${summary.wipeouts > 1 ? 's' : ''}`}
                      </p>

                      {/* The payoff math, spelled out */}
                      <div className="flex items-center gap-2 rounded-2xl bg-black/30 px-5 py-3 font-mono font-black tabular-nums">
                        <div className="text-lg text-white">{summary.baseScore.toLocaleString()}</div>
                        <div className="text-sm text-indigo-300/70">×</div>
                        <div className="text-lg text-fuchsia-400">{summary.maxCombo}</div>
                        <div className="text-sm text-indigo-300/70">=</div>
                      </div>
                      <div className="text-4xl font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.5)]">
                        <CountUp to={summary.totalChips} />{' '}
                        <span className="text-2xl text-cyan-300">chips!</span>
                      </div>

                      <motion.button
                        onClick={handleClaim}
                        disabled={claiming}
                        whileTap={{ scale: 0.92 }}
                        animate={reduceMotion || claiming ? undefined : { scale: [1, 1.07, 1] }}
                        transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                        className="mt-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 px-10 py-3 text-lg font-black uppercase tracking-wider text-slate-950 shadow-lg shadow-cyan-400/40 disabled:opacity-60"
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
