// ═══════════════════════════════════════════════════════════════════
//  TROJAN HORSE side bet — the hidden hold of the Aegean Table.
//  Tap the wooden zone to arm the bet. When the parent flips `won`,
//  the celebration sequence runs:
//    1. RUMBLE (~0.95s) — the horse vibrates hard, belly hatch glowing,
//       with a rising haptic ([20,30]×3 + 90ms slam).
//    2. BURST — the horse flashes out; a full-screen (fixed, z-70,
//       pointer-events-none) spray of drachma coins + sparks erupts
//       from center while "50:1 HIDDEN MULTIPLIER" springs in with an
//       overshoot and a gold drop-shadow glow.
//    3. onCelebrationEnd fires; parent resets `won`.
//  prefers-reduced-motion: no rumble, no coins — the multiplier card
//  simply appears, then the same callback fires.
//
//  Celebration is GOLD on purpose: it's an artifact/jackpot color, not
//  an outcome color, so the win/loss red↔green locale flip
//  (social.css outcome tokens) is untouched — same rule as the
//  Hongbao envelope staying red in every locale.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { GoldChip } from './AegeanTable';

const RUMBLE_MS = 950;
const BURST_MS = 2600;

/** Ship-timber planks: seams, grain, and a lamplit top edge. */
const WOOD: CSSProperties = {
  backgroundColor: '#4a2c17',
  backgroundImage: [
    'linear-gradient(180deg, rgba(255,210,74,0.10), transparent 30%)',
    'repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0 2px, transparent 2px 16px)',
    'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 3px, transparent 3px 8px)',
    'linear-gradient(180deg, #6b4423, #3a2211)',
  ].join(', '),
};

// ── The horse ───────────────────────────────────────────────────────
/** Geometric wooden horse on wheels; the belly hatch telegraphs the
 *  "hidden" multiplier by glowing during the rumble. */
function TrojanHorseSVG({ hatchGlow }: { hatchGlow: boolean }) {
  return (
    <svg viewBox="0 0 120 112" className="h-20 w-24 drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)]" aria-hidden>
      <defs>
        <linearGradient id="thWood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a5a2b" />
          <stop offset="1" stopColor="#4a2c17" />
        </linearGradient>
      </defs>
      <g fill="url(#thWood)" stroke="#ffd24a" strokeWidth="1.6" strokeLinejoin="round">
        {/* rolling platform + wheels */}
        <rect x="10" y="88" width="100" height="8" rx="3" />
        <circle cx="28" cy="102" r="8" />
        <circle cx="92" cy="102" r="8" />
        {/* legs */}
        <rect x="30" y="56" width="9" height="34" rx="3" />
        <rect x="47" y="56" width="9" height="34" rx="3" />
        <rect x="64" y="56" width="9" height="34" rx="3" />
        <rect x="81" y="56" width="9" height="34" rx="3" />
        {/* body */}
        <rect x="22" y="32" width="78" height="30" rx="12" />
        {/* neck + head */}
        <path d="M86 38 L94 12 q2 -7 9 -5 l10 4 q5 2 2.5 7 l-7 4 -4 16 z" />
        {/* mane notches */}
        <path d="M93 12 l-5 9 7 -2 -5 9 7 -2" fill="none" strokeWidth="1.4" />
        {/* tail */}
        <path d="M24 40 q-9 4 -7 16" fill="none" strokeWidth="2" />
      </g>
      {/* belly hatch — the secret door */}
      <motion.rect
        x="49" y="40" width="24" height="17" rx="3"
        fill="#2c1a0c" stroke="#ffd24a" strokeWidth="1.6"
        animate={hatchGlow ? { opacity: [0.7, 1, 0.7], filter: [
          'drop-shadow(0 0 2px rgba(255,210,74,0.4))',
          'drop-shadow(0 0 9px rgba(255,210,74,1))',
          'drop-shadow(0 0 2px rgba(255,210,74,0.4))',
        ] } : { opacity: 0.85 }}
        transition={hatchGlow ? { duration: 0.3, repeat: Infinity } : { duration: 0.2 }}
      />
      <circle cx="69" cy="49" r="1.6" fill="#ffd24a" />
    </svg>
  );
}

// ── Full-screen gold spray ──────────────────────────────────────────
const DrachmaCoin = () => (
  <span
    className="grid h-5 w-5 place-items-center rounded-full border border-yellow-100/70 text-[0.6rem] font-black text-amber-900 shadow-glow-gold"
    style={{ background: 'radial-gradient(circle at 35% 30%, #ffe9a3, #ffd24a 55%, #c9971d)' }}
  >
    Ω
  </span>
);

/** Radial coin explosion from screen center: fly out, hang, rain down.
 *  vmin units so the spray genuinely crosses the screen on any device. */
function CoinSpray({ count = 42 }: { count?: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        dx: (Math.random() - 0.5) * 105,          // vmin
        rise: -(12 + Math.random() * 38),          // vmin
        fall: 58 + Math.random() * 28,             // vmin
        rot: (Math.random() - 0.5) * 1260,
        dur: 1.25 + Math.random() * 0.7,
        delay: Math.random() * 0.22,
        spark: i % 4 === 3,
      })),
    [count],
  );
  return (
    <div className="absolute left-1/2 top-1/2">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute -ml-2 -mt-2"
          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
          animate={{
            x: [0, `${p.dx * 0.65}vmin`, `${p.dx}vmin`],
            y: [0, `${p.rise}vmin`, `${p.fall}vmin`],
            rotate: p.rot,
            scale: [0, 1.2, 0.9],
            opacity: [1, 1, 0],
          }}
          transition={{ duration: p.dur, delay: p.delay, times: [0, 0.36, 1], ease: ['easeOut', 'easeIn'] }}
        >
          {p.spark ? <span className="text-lg">✨</span> : <DrachmaCoin />}
        </motion.span>
      ))}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────
type Celebration = 'none' | 'rumble' | 'burst';

export default function TrojanHorseBet({
  won,
  onCelebrationEnd,
  onArmedChange,
}: {
  /** Flip true when the side bet hits; the sequence runs, then
   *  onCelebrationEnd fires so the parent can reset. */
  won: boolean;
  onCelebrationEnd?: () => void;
  /** Bet placed/cleared on the zone (mock — no chips move in demo). */
  onArmedChange?: (armed: boolean) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const [armed, setArmed] = useState(false);
  const [celebration, setCelebration] = useState<Celebration>('none');

  useEffect(() => {
    if (!won) { setCelebration('none'); return; }
    if (reduced) {
      setCelebration('burst'); // multiplier card only — no rumble, no spray
      const done = setTimeout(() => onCelebrationEnd?.(), 2200);
      return () => clearTimeout(done);
    }
    setCelebration('rumble');
    navigator.vibrate?.([20, 30, 20, 30, 20, 30, 90]);
    const toBurst = setTimeout(() => setCelebration('burst'), RUMBLE_MS);
    const done = setTimeout(() => onCelebrationEnd?.(), RUMBLE_MS + BURST_MS);
    return () => { clearTimeout(toBurst); clearTimeout(done); };
  }, [won, reduced, onCelebrationEnd]);

  function toggleArmed() {
    if (celebration !== 'none') return;
    const next = !armed;
    setArmed(next);
    onArmedChange?.(next);
  }

  return (
    <>
      <motion.button
        onClick={toggleArmed}
        whileHover={{ scale: 1.015 }}
        whileTap={{ scale: 0.97 }}
        aria-pressed={armed}
        className={`relative flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-shadow duration-200 ${
          armed ? 'border-neon-gold shadow-glow-gold' : 'border-amber-700/60'
        }`}
        style={WOOD}
      >
        <AnimatePresence>{armed && <GoldChip label="50" />}</AnimatePresence>

        <motion.div
          animate={
            celebration === 'rumble'
              ? {
                  x: [0, -2, 3, -4, 5, -5, 5, -4, 4, -3, 3, -2, 2, 0],
                  rotate: [0, -1.2, 1.6, -2, 2.2, -2.4, 2.4, -2, 1.6, -1.2, 0.8, 0],
                  scale: [1, 1.02, 1.04, 1.07, 1.1],
                }
              : celebration === 'burst'
                ? { scale: 1.6, opacity: 0 }
                : { x: 0, rotate: 0, scale: 1, opacity: 1 }
          }
          transition={
            celebration === 'rumble'
              ? { duration: RUMBLE_MS / 1000, ease: 'easeIn' }
              : { duration: 0.3, ease: 'easeOut' }
          }
        >
          <TrojanHorseSVG hatchGlow={celebration === 'rumble'} />
        </motion.div>

        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-black tracking-[0.18em] text-neon-gold"
            style={{ textShadow: '0 0 14px rgba(255,210,74,0.45)' }}>
            TROJAN HORSE
          </div>
          <div className="text-[0.52rem] tracking-[0.32em] text-amber-200/50">ΔΟΥΡΕΙΟΣ ΙΠΠΟΣ</div>
          <div className="mt-1 text-[0.62rem] leading-snug tracking-wider text-amber-100/70">
            Wins when the ambush lands — a natural 9 out of the hollow belly.
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-display text-xl font-black text-neon-gold"
            style={{ textShadow: '0 0 16px rgba(255,210,74,0.5)' }}>
            50:1
          </div>
          <div className="text-[0.5rem] tracking-[0.25em] text-amber-200/60">
            {armed ? 'ARMED ⚔' : 'TAP TO ARM'}
          </div>
        </div>
      </motion.button>

      {/* ── Full-screen burst: flash → coin spray → multiplier reveal ── */}
      <AnimatePresence>
        {celebration === 'burst' && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.35 } }}
            aria-live="polite"
          >
            {!reduced && (
              <>
                <motion.div
                  className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(255,233,163,0.95), rgba(255,210,74,0.5) 45%, transparent 70%)' }}
                  initial={{ scale: 0, opacity: 1 }}
                  animate={{ scale: 5, opacity: 0 }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                />
                <CoinSpray />
              </>
            )}

            <div className="absolute inset-0 grid place-items-center">
              <motion.div
                initial={reduced ? { opacity: 0 } : { scale: 0, rotate: -8, opacity: 0 }}
                animate={reduced
                  ? { opacity: 1 }
                  : { scale: [0, 1.35, 1], rotate: [-8, 2, 0], opacity: 1 }}
                transition={reduced
                  ? { duration: 0.2 }
                  : { duration: 0.55, times: [0, 0.65, 1], ease: 'easeOut', delay: 0.1 }}
                className="text-center"
              >
                <div
                  className="bg-gradient-to-b from-yellow-100 via-neon-gold to-amber-500 bg-clip-text font-display text-7xl font-black text-transparent sm:text-8xl"
                  style={{ filter: 'drop-shadow(0 0 20px rgba(255,210,74,0.7)) drop-shadow(0 4px 2px rgba(0,0,0,0.4))' }}
                >
                  50:1
                </div>
                <div
                  className="mt-1 font-display text-lg font-black tracking-[0.45em] text-neon-gold sm:text-xl"
                  style={{ textShadow: '0 0 18px rgba(255,210,74,0.65), 0 2px 3px rgba(0,0,0,0.5)' }}
                >
                  HIDDEN MULTIPLIER
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
