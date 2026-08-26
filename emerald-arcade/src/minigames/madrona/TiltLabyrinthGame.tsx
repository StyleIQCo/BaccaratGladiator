// ═══════════════════════════════════════════════════════════════════
//  MADRONA WOOD LABYRINTH — Framer Motion modal wrapper.
//
//  React OWNS this layer: the dusk-grove chrome, the intro screen,
//  the loadout pick, the trailhead HUD, and the end-of-run plaque.
//  The canvas between them runs entirely on refs.
//
//  Beat sheet:
//    1. intro   — drifting madrona leaves, the legend, and the
//                 marble loadout (MarbleInventoryUI). "ROLL OUT!"
//                 primes audio + starts the grove ambience.
//    2. playing — MadronaCanvas mounts and the run starts. The HUD
//                 bar above the canvas re-renders at 4 Hz off
//                 onHudTick; its SWAP button re-opens the inventory
//                 mid-run — the sim and clock FREEZE while it's up,
//                 so browsing marbles never burns time.
//    3. over    — the carved plaque itemizes the run: gems, smashed
//                 barriers, the time bonus, total + pulsing Claim.
//
//  Closing mid-run forfeits the run (daily ticket = one attempt);
//  chips are only granted through onClaim on the plaque.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MadronaCanvas } from './MadronaCanvas';
import { MarbleInventoryUI } from './MarbleInventoryUI';
import { getMarble, DEFAULT_MARBLE_ID, type MarbleId } from './marbleData';
import { primeAudio, sfxClaim, sfxUiTap, startAmbience, stopAllAudio } from './madronaSfx';
import {
  GEM_CHIPS,
  GEMS_TOTAL,
  RUN_SECONDS_DEFAULT,
  SMASH_CHIPS,
  type RunResult,
} from './useTiltPhysics';

export interface TiltLabyrinthGameProps {
  open: boolean;
  onClose: () => void;
  /** Award the chips (server call lives up here — the game never touches the wallet). */
  onClaim: (chips: number) => void | Promise<void>;
  runSeconds?: number; // default 60
}

type Phase = 'intro' | 'playing' | 'over';

/** The trail report, carved by the park ranger. */
function runTitle(r: RunResult): string {
  if (!r.finished && r.gems === 0) return 'LOST IN THE GROVE';
  if (r.finished && r.gems >= GEMS_TOTAL) return 'LABYRINTH LEGEND';
  if (r.finished && r.smashed >= 2) return 'BARRIER BREAKER';
  if (r.finished) return 'TRAIL RUNNER';
  return 'WEEKEND WANDERER';
}

const fmtTime = (s: number) => {
  const whole = Math.ceil(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

const LEGEND: { icon: string; name: string; hint: string }[] = [
  { icon: '🫳', name: 'TILT', hint: 'Touch & drag — the board leans toward your finger' },
  { icon: '💎', name: 'GEMS', hint: `${GEM_CHIPS} chips each; the emerald ends the run with a time bonus` },
  { icon: '🪨', name: 'BARRIERS', hint: 'Cracked planks — only the Iron ball at speed crashes through' },
  { icon: '🕳️', name: 'KNOT-HOLES', hint: 'Swallow your marble: back to the start, 3 seconds gone' },
];

export function TiltLabyrinthGame({
  open,
  onClose,
  onClaim,
  runSeconds = RUN_SECONDS_DEFAULT,
}: TiltLabyrinthGameProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [marbleId, setMarbleId] = useState<MarbleId>(DEFAULT_MARBLE_ID);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [hud, setHud] = useState({ timeLeft: RUN_SECONDS_DEFAULT, score: 0, gems: 0 });
  const [result, setResult] = useState<RunResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  const claimedRef = useRef(false); // double-tap guard across the async claim

  // Fresh run every time the modal opens; silence on the way out.
  useEffect(() => {
    if (open) {
      setPhase('intro');
      setMarbleId(DEFAULT_MARBLE_ID);
      setInventoryOpen(false);
      setHud({ timeLeft: runSeconds, score: 0, gems: 0 });
      setResult(null);
      setClaiming(false);
      claimedRef.current = false;
    } else {
      stopAllAudio();
    }
  }, [open, runSeconds]);
  useEffect(() => () => stopAllAudio(), []);

  // Drifting madrona leaves: fixed field, randomized per mount. Pure CSS after that.
  const leaves = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        left: `${(i * 10.7 + Math.random() * 6) % 100}%`,
        delay: `${(Math.random() * 6).toFixed(2)}s`,
        dur: `${(7 + Math.random() * 6).toFixed(2)}s`,
        size: 8 + Math.round(Math.random() * 8),
        o: 0.25 + Math.random() * 0.3,
      })),
    [],
  );

  const activeSpec = getMarble(marbleId);

  const handleGameOver = (r: RunResult) => {
    setResult(r);
    setInventoryOpen(false);
    setPhase('over');
  };

  const handleClaim = async () => {
    if (claimedRef.current || !result) return;
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

  // Plaque breakdown: score already includes everything — split it back
  // out so the itemized lines always sum to the total.
  const gemChips = (result?.gems ?? 0) * GEM_CHIPS;
  const smashChips = (result?.smashed ?? 0) * SMASH_CHIPS;
  const bonusChips = Math.max(0, (result?.score ?? 0) - gemChips - smashChips);

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
              @keyframes mwl-leaf-fall {
                0%   { transform: translateY(-8vh) rotate(0deg); }
                100% { transform: translateY(108vh) rotate(340deg); }
              }
            `}</style>
          )}
          <motion.div
            className="relative flex w-[min(420px,94vw)] flex-col overflow-hidden rounded-3xl border-2 border-orange-300/30 bg-gradient-to-b from-emerald-950 via-stone-900 to-stone-950 shadow-2xl"
            initial={{ scale: 0.6, y: 60, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 40, opacity: 0 }}
            transition={springIn}
          >
            {/* ── The dusk grove behind everything ── */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -left-8 top-8 h-40 w-40 rounded-full bg-emerald-400/10 blur-2xl" />
              <div className="absolute right-0 top-40 h-32 w-32 rounded-full bg-orange-400/10 blur-2xl" />
              <div className="absolute bottom-8 left-1/4 h-36 w-36 rounded-full bg-red-400/5 blur-2xl" />
              {!reduceMotion &&
                leaves.map((d, i) => (
                  <span
                    key={i}
                    className="absolute top-0 rounded-[40%_60%_55%_45%] bg-gradient-to-br from-orange-400 to-red-700"
                    style={{
                      left: d.left,
                      width: d.size,
                      height: d.size * 0.7,
                      opacity: d.o,
                      animation: `mwl-leaf-fall ${d.dur} linear ${d.delay} infinite`,
                    }}
                  />
                ))}
            </div>

            {/* ✕ — mid-run this forfeits; the daily ticket is spent either way */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 z-40 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-sm font-bold text-white/80 hover:bg-black/60"
            >
              ✕
            </button>

            {/* ── Trailhead HUD: lives above the canvas, 4 Hz ── */}
            {(phase === 'playing' || phase === 'over') && (
              <div className="relative z-10 mx-auto mt-3 flex w-[88%] items-center justify-between rounded-xl border border-orange-200/20 bg-black/40 px-3 py-1.5 font-mono text-[11px] font-bold text-orange-100">
                <span data-testid="hud-time">⏱ {fmtTime(hud.timeLeft)}</span>
                <span data-testid="hud-score">🪙 {hud.score.toLocaleString()}</span>
                <span data-testid="hud-gems">💎 {hud.gems}/{GEMS_TOTAL}</span>
                <button
                  onClick={() => {
                    sfxUiTap();
                    setInventoryOpen(true);
                  }}
                  disabled={phase !== 'playing'}
                  data-testid="madrona-swap"
                  className="rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider text-stone-900 disabled:opacity-40"
                  style={{ background: activeSpec.accent }}
                >
                  ● SWAP
                </button>
              </div>
            )}

            <div className="relative h-[min(560px,68vh)] w-full">
              {phase === 'intro' && (
                <div className="relative z-10 flex h-full flex-col items-center justify-center gap-3.5 px-6 text-center">
                  <motion.div
                    className="text-6xl"
                    animate={reduceMotion ? undefined : { rotate: [-6, 6, -6], y: [0, -6, 0] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                  >
                    🪵
                  </motion.div>
                  <h2 className="text-2xl font-black uppercase italic tracking-wide text-orange-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
                    Madrona Wood Labyrinth
                  </h2>
                  <p className="text-sm text-orange-50/90">
                    A hand-carved maze, five gems, one emerald.
                    <br />
                    <span className="font-bold text-white">{runSeconds} seconds on the clock — pick your marble wisely.</span>
                  </p>
                  <div className="w-full space-y-1.5 rounded-2xl bg-black/30 p-3 text-left text-sm">
                    {LEGEND.map((row) => (
                      <div key={row.name} className="flex items-start gap-2.5">
                        <span className="text-base leading-5">{row.icon}</span>
                        <span className="flex-1 text-orange-50">
                          <span className="font-black text-orange-300">{row.name}</span>
                          <span className="block text-xs text-orange-100/70">{row.hint}</span>
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* The equipped marble + loadout door */}
                  <button
                    onClick={() => {
                      sfxUiTap();
                      setInventoryOpen(true);
                    }}
                    data-testid="madrona-choose"
                    className="flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-black uppercase tracking-wider text-white"
                    style={{ borderColor: activeSpec.accent, background: `${activeSpec.accent}22` }}
                  >
                    <span
                      className="inline-block h-4 w-4 rounded-full"
                      style={{
                        background: `radial-gradient(circle at 32% 28%, ${activeSpec.render.body[0]}, ${activeSpec.render.body[1]} 55%, ${activeSpec.render.body[2]})`,
                      }}
                    />
                    {activeSpec.name} · Change
                  </button>

                  <motion.button
                    onClick={() => {
                      primeAudio(); // MUST happen inside this tap — iOS unlocks audio only on a user gesture
                      startAmbience();
                      setPhase('playing');
                    }}
                    whileTap={{ scale: 0.92 }}
                    data-testid="madrona-start"
                    className="mt-1 rounded-full bg-gradient-to-b from-orange-300 to-orange-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-stone-900 shadow-lg shadow-orange-500/30"
                  >
                    🪵 Roll Out!
                  </motion.button>
                </div>
              )}

              {(phase === 'playing' || phase === 'over') && (
                <MadronaCanvas
                  marbleId={marbleId}
                  paused={inventoryOpen}
                  onGameOver={handleGameOver}
                  onHudTick={(timeLeft, score, gems) => setHud({ timeLeft, score, gems })}
                  runSeconds={runSeconds}
                  className="h-full w-full"
                />
              )}

              {/* ── The loadout sheet (intro pick AND mid-run swap) ── */}
              <MarbleInventoryUI
                open={inventoryOpen}
                activeId={marbleId}
                onSelect={setMarbleId}
                onClose={() => setInventoryOpen(false)}
                title={phase === 'playing' ? 'Swap Marble — Clock Frozen' : 'Choose Your Marble'}
              />

              {/* ── The carved plaque over the frozen final frame ── */}
              <AnimatePresence>
                {phase === 'over' && result && (
                  <motion.div
                    className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-stone-950/60 p-5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: reduceMotion ? 0 : 0.6 }}
                  >
                    <motion.div
                      data-testid="madrona-results"
                      className="w-full max-w-[300px] rounded-xl border-4 border-[#5c3221] bg-gradient-to-b from-[#9a5232] to-[#6d3a24] px-5 pb-5 pt-4 text-orange-50 shadow-2xl"
                      initial={reduceMotion ? { opacity: 0 } : { scale: 0.7, rotate: -4, opacity: 0 }}
                      animate={{ scale: 1, rotate: 0, opacity: 1 }}
                      transition={reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.45, duration: 0.6, delay: 0.6 }}
                    >
                      <div className="text-center">
                        <div className="text-xs font-bold tracking-[0.3em] text-orange-200/70">TRAIL REPORT</div>
                        <div className="mt-1 text-lg font-black uppercase tracking-wider">
                          {result.finished ? '💚 Emerald Claimed!' : '⏱ Out of Time'}
                        </div>
                        <div className="mt-1 border-b border-orange-200/30" />
                      </div>

                      <div className="mt-3 space-y-1.5 font-mono text-[12px]">
                        <div className="flex justify-between">
                          <span>💎 Gems {result.gems}/{result.gemsTotal}</span>
                          <span className="font-bold">{gemChips.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>💥 Barriers smashed ×{result.smashed}</span>
                          <span className="font-bold">{smashChips.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>🏁 Time bonus</span>
                          <span className="font-bold">{bonusChips.toLocaleString()}</span>
                        </div>
                        {result.falls > 0 && (
                          <div className="flex justify-between text-orange-200/60">
                            <span>🕳️ Knot-hole falls</span>
                            <span>×{result.falls}</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 border-b border-orange-200/30" />
                      <div className="mt-2 flex items-end justify-between">
                        <span className="text-sm font-black">TOTAL CHIPS</span>
                        <span data-testid="madrona-total" className="text-xl font-black text-yellow-200">
                          {result.score.toLocaleString()}
                        </span>
                      </div>

                      <div className="mt-2 text-center text-[10px] font-bold tracking-[0.25em] text-orange-200/80">
                        «{runTitle(result)}»
                      </div>

                      <motion.button
                        onClick={handleClaim}
                        disabled={claiming}
                        whileTap={{ scale: 0.92 }}
                        animate={reduceMotion || claiming ? undefined : { scale: [1, 1.05, 1] }}
                        transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                        data-testid="madrona-claim"
                        className="mt-3 w-full rounded-full bg-gradient-to-b from-yellow-300 to-amber-500 px-6 py-2.5 text-sm font-black uppercase tracking-wider text-stone-900 shadow-lg shadow-amber-500/40 disabled:opacity-60"
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
