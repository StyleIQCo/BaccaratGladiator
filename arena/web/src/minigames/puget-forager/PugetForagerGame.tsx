// ═══════════════════════════════════════════════════════════════════
//  THE PUGET SOUND FORAGER — Framer Motion modal wrapper.
//
//  React OWNS this layer, exactly as the spec divides it: the modal
//  chrome, the intro, the 60s timer readout, the 6-slot inventory
//  tracker, the three zone nav buttons, and the results — while the
//  single <canvas> between them runs entirely on refs.
//
//  This file also holds the whole audio pass. 100% Web Audio
//  oscillators + noise buffers (same synth kit as hotdogSfx — kept
//  local so the cabinet stays self-contained): no audio assets, no
//  network fetches, CloudFront's script-src 'self' CSP stays happy.
//    Zone 1 — mud squelches and digging scrapes.
//    Zone 2 — splashes and rope creaks.
//    Zone 3 — reel clacks (cadence rises with tension) and thrashing.
//
//  The payoff: fill the quota and the canvas freezes while a full-
//  screen Framer Motion SEAFOOD BOIL erupts — pot, flying ingredients,
//  steam, and the +25,000 chip BOIL BONANZA. Miss the quota and the
//  tide goes out on a consolation card priced off the actual haul.
//
//  iOS autoplay policy: primeAudio() runs inside the start-button and
//  zone-button taps. Every voice no-ops silently if never primed.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { PugetSoundCanvas } from './PugetSoundCanvas';
import {
  BOIL_BONUS, FLY_SECONDS, RUN_SECONDS_DEFAULT, SEAFOOD_META, SEAFOOD_ORDER,
  useForagerPhysics, makeEmptyInventory,
  type ForagerCue, type ForagerResult, type Inventory, type SeafoodKind, type ZoneId,
} from './useForagerPhysics';

// ═══ Synthesized SFX ═══════════════════════════════════════════════

let actx: AudioContext | null = null;
let master: GainNode | null = null;

function primeAudio(): void {
  if (!actx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.45;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') void actx.resume();
}

/** Plain beep/sweep. */
function tone(
  freq: number,
  opts: { to?: number; dur?: number; delay?: number; type?: OscillatorType; gain?: number } = {},
): void {
  if (!actx || !master) return;
  const { to = freq, dur = 0.12, delay = 0, type = 'triangle', gain = 0.25 } = opts;
  const t0 = actx.currentTime + delay;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Filtered noise burst — squelches, splashes, scrapes, steam. */
function noise(
  opts: { dur?: number; delay?: number; freq?: number; to?: number; q?: number; gain?: number; type?: BiquadFilterType } = {},
): void {
  if (!actx || !master) return;
  const { dur = 0.15, delay = 0, freq = 2000, to = freq, q = 1, gain = 0.2, type = 'bandpass' } = opts;
  const t0 = actx.currentTime + delay;
  const len = Math.ceil(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource();
  src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (to !== freq) f.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

/** Mechanic cues, one voice per ForagerCue. */
function playCue(cue: ForagerCue): void {
  switch (cue) {
    // ── Mudflats: squish + digging ──
    case 'squish':
      noise({ dur: 0.1, freq: 320, to: 130, q: 1.4, gain: 0.22, type: 'lowpass' });
      tone(95, { to: 70, dur: 0.09, type: 'sine', gain: 0.14 });
      break;
    case 'dig':
      noise({ dur: 0.07, freq: 900, to: 500, q: 0.8, gain: 0.08 });
      noise({ dur: 0.06, delay: 0.07, freq: 700, to: 420, q: 0.8, gain: 0.06 });
      break;
    case 'geoduck_tap':
      noise({ dur: 0.09, freq: 420, to: 180, q: 1.6, gain: 0.24, type: 'lowpass' });
      tone(220, { to: 150, dur: 0.09, type: 'sine', gain: 0.16 });
      break;
    case 'geoduck_slip':
      tone(260, { to: 120, dur: 0.22, type: 'sine', gain: 0.14 });
      noise({ dur: 0.18, freq: 500, to: 200, q: 1.2, gain: 0.12, type: 'lowpass' });
      break;
    // ── The Dock: splash + rope creak ──
    case 'pot_drop':
      noise({ dur: 0.3, freq: 1400, to: 300, q: 0.8, gain: 0.16 });
      break;
    case 'pot_thunk':
      tone(130, { to: 80, dur: 0.14, type: 'triangle', gain: 0.3 });
      noise({ dur: 0.08, freq: 600, q: 1, gain: 0.14 });
      break;
    case 'splash':
      noise({ dur: 0.28, freq: 1200, to: 480, q: 0.9, gain: 0.22 });
      tone(520, { to: 300, dur: 0.1, type: 'sine', gain: 0.08, delay: 0.02 });
      break;
    case 'creak': // two detuned saws bending slowly = a wet rope under load
      tone(84, { to: 66, dur: 0.34, type: 'sawtooth', gain: 0.1 });
      tone(89, { to: 70, dur: 0.34, type: 'sawtooth', gain: 0.08 });
      break;
    case 'squid_jink':
      tone(900, { to: 1500, dur: 0.05, type: 'sine', gain: 0.06 });
      break;
    // ── Deep Water: reel clicks + thrashing ──
    case 'bite':
      tone(620, { to: 210, dur: 0.12, type: 'square', gain: 0.16 });
      tone(120, { dur: 0.1, delay: 0.05, type: 'triangle', gain: 0.24 });
      break;
    case 'reel_tick':
      noise({ dur: 0.02, freq: 5200, q: 0.7, gain: 0.1, type: 'highpass' });
      tone(1900, { dur: 0.018, type: 'sine', gain: 0.05 });
      break;
    case 'thrash':
      noise({ dur: 0.32, freq: 800, to: 1600, q: 1, gain: 0.24 });
      tone(160, { to: 110, dur: 0.24, type: 'sawtooth', gain: 0.12 });
      break;
    case 'line_break':
      noise({ dur: 0.05, freq: 6000, q: 0.6, gain: 0.34, type: 'highpass' }); // the SNAP
      tone(420, { to: 70, dur: 0.5, delay: 0.05, type: 'sawtooth', gain: 0.2 });
      break;
    case 'zone_switch':
      noise({ dur: 0.22, freq: 420, to: 1900, q: 0.8, gain: 0.12 });
      break;
  }
}

/** Catch chimes scale with the prize. */
function playCatch(kind: SeafoodKind): void {
  switch (kind) {
    case 'clam':
      tone(523, { dur: 0.09, type: 'sine', gain: 0.14 });
      tone(659, { dur: 0.12, delay: 0.07, type: 'sine', gain: 0.14 });
      break;
    case 'oyster':
      tone(587, { dur: 0.09, type: 'sine', gain: 0.15 });
      tone(880, { dur: 0.16, delay: 0.08, type: 'sine', gain: 0.15 });
      break;
    case 'geoduck': // the great comedic SLURP, then a fanfare
      tone(110, { to: 520, dur: 0.28, type: 'sawtooth', gain: 0.18 });
      noise({ dur: 0.2, freq: 300, to: 1400, q: 1.4, gain: 0.18, type: 'lowpass' });
      [523, 659, 784, 1047].forEach((f, i) => tone(f, { dur: 0.1, delay: 0.3 + i * 0.07, type: 'triangle', gain: 0.16 }));
      break;
    case 'crab':
      tone(392, { dur: 0.08, type: 'square', gain: 0.1 });
      tone(523, { dur: 0.08, delay: 0.07, type: 'square', gain: 0.1 });
      tone(659, { dur: 0.14, delay: 0.14, type: 'square', gain: 0.1 });
      break;
    case 'squid':
      [740, 932, 1109].forEach((f, i) => tone(f, { dur: 0.07, delay: i * 0.05, type: 'sine', gain: 0.12 }));
      break;
    case 'salmon': // the king gets trumpets
      [523, 659, 784].forEach((f, i) => tone(f, { dur: 0.1, delay: i * 0.08, type: 'triangle', gain: 0.18 }));
      tone(1047, { dur: 0.45, delay: 0.26, type: 'triangle', gain: 0.2 });
      noise({ dur: 0.4, freq: 1100, to: 500, q: 0.9, gain: 0.16 });
      break;
  }
}

/** BOIL BONANZA: rolling bubbles + a rising major fanfare + coin rain. */
function sfxBoil(): void {
  for (let i = 0; i < 6; i++) {
    noise({ dur: 0.22, delay: i * 0.13, freq: 300 + i * 90, to: 700 + i * 120, q: 2, gain: 0.1, type: 'lowpass' });
  }
  [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) =>
    tone(f, { dur: 0.14, delay: 0.3 + i * 0.09, type: 'triangle', gain: 0.18 }),
  );
  [988, 1319, 1568, 1976, 2637].forEach((f, i) =>
    tone(f, { dur: 0.09, delay: 1.0 + i * 0.06, type: 'sine', gain: 0.16 }),
  );
}

function sfxTideOut(): void {
  noise({ dur: 0.7, freq: 900, to: 250, q: 0.7, gain: 0.16 });
  tone(330, { dur: 0.22, type: 'sine', gain: 0.12 });
  tone(262, { dur: 0.4, delay: 0.2, type: 'sine', gain: 0.12 });
}

function sfxClaim(): void {
  [988, 1319, 1568, 1976, 2637].forEach((f, i) =>
    tone(f, { dur: 0.09, delay: i * 0.06, type: 'sine', gain: 0.16 }),
  );
}

// ═══ UI bits ═══════════════════════════════════════════════════════

export interface PugetForagerGameProps {
  open: boolean;
  onClose: () => void;
  /** Credit the run: chips = haul value + BOIL_BONUS when the boil fired. */
  onFinish?: (totalChips: number, result: ForagerResult) => void;
  runSeconds?: number;   // default 60; smoke tests shorten it
}

type Phase = 'intro' | 'playing' | 'over';

const ZONES: Array<{ id: ZoneId; label: string; emoji: string }> = [
  { id: 1, label: 'MUDFLATS', emoji: '🏖️' },
  { id: 2, label: 'THE DOCK', emoji: '⚓' },
  { id: 3, label: 'DEEP WATER', emoji: '🎣' },
];

/** Eased count-up for reward reveals. Post-game, so setState is fair game. */
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

/** One HUD inventory slot. Remounts its count on change → pop animation. */
function InvSlot({ kind, count }: { kind: SeafoodKind; count: number }) {
  const meta = SEAFOOD_META[kind];
  const done = count >= meta.quota;
  return (
    <div
      className={`flex flex-1 flex-col items-center rounded-xl border px-0.5 py-1 ${
        done ? 'border-amber-300/80 bg-amber-300/15' : 'border-white/15 bg-black/30'
      }`}
    >
      <div className="text-base leading-none">{meta.emoji}</div>
      <motion.div
        key={count}
        initial={{ scale: 1.5 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', bounce: 0.6, duration: 0.4 }}
        className={`text-[0.65rem] font-black leading-tight ${done ? 'text-amber-300' : 'text-cyan-50'}`}
      >
        {Math.min(count, 99)}/{meta.quota}
      </motion.div>
    </div>
  );
}

/** The full-screen Ultimate Seafood Boil cinematic. */
function BoilCinematic({ haul, onClaim }: { haul: number; onClaim: () => void }) {
  const reduceMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(!!reduceMotion);
  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setTimeout(() => setRevealed(true), 1500);
    return () => window.clearTimeout(id);
  }, [reduceMotion]);

  // Ingredients dive in from the screen edges, corn included — it's a boil.
  const ingredients: Array<{ emoji: string; x: number; y: number; delay: number }> = [
    { emoji: '🦀', x: -170, y: -240, delay: 0.0 },
    { emoji: '🦪', x: 170, y: -260, delay: 0.12 },
    { emoji: '🌽', x: -200, y: -120, delay: 0.24 },
    { emoji: '🐚', x: 200, y: -150, delay: 0.36 },
    { emoji: '🦑', x: -150, y: -300, delay: 0.48 },
    { emoji: '🌽', x: 150, y: -100, delay: 0.6 },
    { emoji: '🐟', x: 0, y: -320, delay: 0.72 },
  ];

  return (
    <motion.div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden bg-slate-950/85 p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="relative flex h-64 w-full items-end justify-center">
        {/* Steam */}
        {!reduceMotion && [0, 1, 2, 3, 4].map(i => (
          <motion.div
            key={i}
            className="absolute bottom-36 h-8 w-8 rounded-full bg-white/25 blur-md"
            style={{ left: `calc(50% + ${(i - 2) * 26}px)` }}
            animate={{ y: [-10, -90], opacity: [0, 0.8, 0], scale: [0.7, 1.6] }}
            transition={{ repeat: Infinity, duration: 1.6, delay: i * 0.3, ease: 'easeOut' }}
          />
        ))}
        {/* The pot */}
        <motion.div
          className="relative z-10"
          animate={reduceMotion ? undefined : { rotate: [-1.5, 1.5, -1.5] }}
          transition={{ repeat: Infinity, duration: 0.7 }}
        >
          <div className="h-7 w-56 rounded-full bg-gradient-to-b from-slate-200 to-slate-400 shadow-lg" />
          <div className="-mt-2 h-32 w-56 rounded-b-[3.5rem] bg-gradient-to-b from-slate-400 via-slate-500 to-slate-700 shadow-2xl" />
          <div className="absolute -left-6 top-8 h-4 w-8 rounded-full border-4 border-slate-400" />
          <div className="absolute -right-6 top-8 h-4 w-8 rounded-full border-4 border-slate-400" />
          {/* Rolling boil at the rim */}
          <div className="absolute left-4 right-4 top-4 h-5 overflow-hidden rounded-full bg-orange-200/90">
            {!reduceMotion && [0, 1, 2, 3, 4, 5].map(i => (
              <motion.div
                key={i}
                className="absolute top-1 h-3 w-3 rounded-full bg-white/80"
                style={{ left: `${8 + i * 16}%` }}
                animate={{ y: [2, -4, 2] }}
                transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.09 }}
              />
            ))}
          </div>
        </motion.div>
        {/* Ingredients flying in */}
        {ingredients.map((ing, i) => (
          <motion.div
            key={i}
            className="absolute bottom-40 z-20 text-4xl"
            initial={reduceMotion ? { opacity: 0 } : { x: ing.x, y: ing.y, opacity: 1, rotate: -40 }}
            animate={reduceMotion ? { opacity: 0 } : { x: 0, y: 40, opacity: 0, rotate: 30, scale: 0.5 }}
            transition={{ delay: ing.delay, duration: 0.55, ease: 'easeIn' }}
          >
            {ing.emoji}
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {revealed && (
          <motion.div
            className="flex flex-col items-center gap-2 text-center"
            initial={{ scale: 0.3, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.55, duration: 0.8 }}
          >
            <div className="text-4xl font-black italic tracking-tight text-amber-300 drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]">
              +{BOIL_BONUS.toLocaleString()} CHIPS
            </div>
            <div className="text-2xl font-black uppercase tracking-widest text-orange-400">
              BOIL BONANZA!
            </div>
            <p className="text-xs text-cyan-200/80">
              Quota filled — the Ultimate Seafood Boil is ON. Haul value adds{' '}
              <span className="font-bold text-white">+{haul.toLocaleString()}</span> more.
            </p>
            <motion.button
              onClick={onClaim}
              whileTap={{ scale: 0.92 }}
              className="mt-3 rounded-full bg-gradient-to-b from-amber-300 to-orange-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-orange-950 shadow-lg shadow-orange-500/40"
            >
              Claim the Feast
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══ The cabinet ═══════════════════════════════════════════════════

export function PugetForagerGame({
  open, onClose, onFinish, runSeconds = RUN_SECONDS_DEFAULT,
}: PugetForagerGameProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [secondsLeft, setSecondsLeft] = useState(runSeconds);
  const [zone, setZone] = useState<ZoneId>(1);
  const [inv, setInv] = useState<Inventory>(makeEmptyInventory);
  const [result, setResult] = useState<ForagerResult | null>(null);
  const claimedRef = useRef(false);
  const landTimersRef = useRef<number[]>([]);

  const physics = useForagerPhysics({
    runSeconds,
    onSecond: setSecondsLeft,
    onCue: playCue,
    onCatch: kind => {
      playCatch(kind);
      // The canvas flyer takes FLY_SECONDS to reach the HUD slot — bump
      // the DOM count exactly when the icon lands.
      const id = window.setTimeout(() => {
        setInv(prev => ({ ...prev, [kind]: prev[kind] + 1 }));
      }, FLY_SECONDS * 1000);
      landTimersRef.current.push(id);
    },
    onGameOver: res => {
      setResult(res);
      setPhase('over');
      if (res.boil) sfxBoil(); else sfxTideOut();
    },
  });

  // Fresh run every time the modal opens.
  useEffect(() => {
    if (open) {
      setPhase('intro');
      setSecondsLeft(runSeconds);
      setZone(1);
      setInv(makeEmptyInventory());
      setResult(null);
      claimedRef.current = false;
    } else {
      for (const id of landTimersRef.current) window.clearTimeout(id);
      landTimersRef.current.length = 0;
    }
  }, [open, runSeconds]);
  useEffect(() => () => {
    for (const id of landTimersRef.current) window.clearTimeout(id);
  }, []);

  const switchZone = (z: ZoneId) => {
    primeAudio();
    physics.setActiveZone(z);
    setZone(z);
  };

  const handleClaim = () => {
    if (claimedRef.current || !result) return;
    claimedRef.current = true;
    sfxClaim();
    onFinish?.(result.chips + result.bonus, result);
    onClose();
  };

  const springIn = reduceMotion
    ? { duration: 0.01 }
    : { type: 'spring' as const, bounce: 0.5, duration: 0.7 };
  const urgent = phase === 'playing' && secondsLeft <= 10;

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
            className="relative flex w-[min(420px,94vw)] flex-col overflow-hidden rounded-3xl border-2 border-teal-300/40 bg-gradient-to-b from-teal-950 to-slate-900 shadow-2xl"
            initial={{ scale: 0.6, y: 60, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 40, opacity: 0 }}
            transition={springIn}
          >
            {/* ✕ — mid-run this forfeits; the tide waits for no one */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-sm font-bold text-white/80 hover:bg-black/60"
            >
              ✕
            </button>

            <div className="relative flex h-[min(600px,74vh)] w-full flex-col">
              {phase === 'intro' && (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                  <motion.div
                    className="text-6xl"
                    animate={reduceMotion ? undefined : { y: [0, -10, 0], rotate: [-6, 8, -6] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                  >
                    🦪
                  </motion.div>
                  <h2 className="text-2xl font-black uppercase italic tracking-wide text-amber-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
                    The Puget Sound Forager
                  </h2>
                  <p className="text-sm text-cyan-100/90">
                    {runSeconds} seconds, three spots, ONE pot. Fill the boil quota
                    before the tide turns:{' '}
                    <span className="font-bold text-white">
                      tap the mudflats, drop the crab pot, reel the king
                    </span>
                    — and the Ultimate Seafood Boil pays{' '}
                    <span className="font-bold text-amber-300">+{BOIL_BONUS.toLocaleString()} chips</span>.
                  </p>
                  <div className="w-full space-y-1.5 rounded-2xl bg-black/30 p-3 text-left text-sm">
                    {SEAFOOD_ORDER.map(kind => {
                      const m = SEAFOOD_META[kind];
                      return (
                        <div key={kind} className="flex items-center gap-2.5">
                          <span className="w-6 text-center">{m.emoji}</span>
                          <span className="flex-1 text-cyan-50">{m.label}</span>
                          <span className="text-[0.7rem] text-white/50">{ZONES[m.zone - 1].label}</span>
                          <span className="w-10 text-right font-black text-amber-300">×{m.quota}</span>
                        </div>
                      );
                    })}
                  </div>
                  <motion.button
                    onClick={() => { primeAudio(); setPhase('playing'); }}
                    whileTap={{ scale: 0.92 }}
                    className="mt-1 rounded-full bg-gradient-to-b from-amber-300 to-orange-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-orange-950 shadow-lg shadow-orange-500/30"
                  >
                    Low Tide — Go!
                  </motion.button>
                </div>
              )}

              {(phase === 'playing' || phase === 'over') && (
                <>
                  {/* ── HUD: clock + 6-slot quota tracker (React DOM) ──
                      pr-12 keeps the last slot clear of the absolute ✕. */}
                  <div className="flex items-center gap-2 pb-1 pl-2 pr-12 pt-2">
                    <div
                      className={`min-w-[3.2rem] rounded-xl border px-2 py-1 text-center text-lg font-black tabular-nums ${
                        urgent
                          ? 'animate-pulse border-red-400/70 bg-red-500/20 text-red-300'
                          : 'border-white/15 bg-black/30 text-cyan-50'
                      }`}
                    >
                      {secondsLeft}s
                    </div>
                    {/* Slot order MUST match SEAFOOD_ORDER — canvas flyers aim at slot i/6. */}
                    <div className="flex flex-1 gap-1">
                      {SEAFOOD_ORDER.map(kind => (
                        <InvSlot key={kind} kind={kind} count={inv[kind]} />
                      ))}
                    </div>
                  </div>

                  {/* ── THE single canvas: all three zones live here ── */}
                  <div className="relative min-h-0 flex-1">
                    <PugetSoundCanvas physics={physics} className="h-full w-full" />
                  </div>

                  {/* ── Zone nav (React DOM buttons) ── */}
                  <div className="flex gap-1.5 p-2">
                    {ZONES.map(z => (
                      <motion.button
                        key={z.id}
                        onClick={() => switchZone(z.id)}
                        whileTap={{ scale: 0.94 }}
                        disabled={phase !== 'playing'}
                        className={`flex flex-1 flex-col items-center rounded-2xl border-2 py-2 text-[0.68rem] font-black tracking-wider transition-colors ${
                          zone === z.id
                            ? 'border-amber-300 bg-amber-300/20 text-amber-200'
                            : 'border-white/15 bg-black/30 text-cyan-100/70'
                        } disabled:opacity-50`}
                      >
                        <span className="text-xl leading-tight">{z.emoji}</span>
                        {z.label}
                      </motion.button>
                    ))}
                  </div>
                </>
              )}

              {/* ── Results: boil bonanza, or the tide goes out ── */}
              <AnimatePresence>
                {phase === 'over' && result && (
                  result.boil ? (
                    <BoilCinematic haul={result.chips} onClaim={handleClaim} />
                  ) : (
                    <motion.div
                      className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/60 p-5"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <motion.div
                        className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-teal-300/50 bg-gradient-to-b from-slate-800 to-slate-900 px-6 py-7 text-center shadow-2xl"
                        initial={{ scale: 0.3, y: 90, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        transition={reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.55, duration: 0.8 }}
                      >
                        <div className="text-5xl">🌊</div>
                        <h3 className="text-xl font-black uppercase italic tracking-wide text-teal-300">
                          Tide's Out!
                        </h3>
                        <div className="grid w-full grid-cols-3 gap-1.5 text-sm">
                          {SEAFOOD_ORDER.map(kind => {
                            const m = SEAFOOD_META[kind];
                            const got = result.inventory[kind];
                            return (
                              <div key={kind} className="rounded-xl bg-black/30 py-1.5">
                                <span className="mr-1">{m.emoji}</span>
                                <span className={got >= m.quota ? 'font-black text-amber-300' : 'text-cyan-100/80'}>
                                  {got}/{m.quota}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-sm font-bold uppercase tracking-wide text-cyan-100/80">
                          Your haul still sells
                        </p>
                        <div className="text-4xl font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.5)]">
                          +<CountUp to={result.chips} />{' '}
                          <span className="text-2xl text-teal-300">chips</span>
                        </div>
                        <motion.button
                          onClick={handleClaim}
                          whileTap={{ scale: 0.92 }}
                          className="mt-2 rounded-full bg-gradient-to-b from-teal-300 to-cyan-500 px-10 py-3 text-lg font-black uppercase tracking-wider text-teal-950 shadow-lg shadow-cyan-500/40"
                        >
                          {result.chips > 0 ? 'Sell the Haul' : 'Done'}
                        </motion.button>
                      </motion.div>
                    </motion.div>
                  )
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
