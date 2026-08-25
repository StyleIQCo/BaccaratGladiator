// ═══════════════════════════════════════════════════════════════════
//  MOCKINGBIRD TABLE — "Road to Mockingbird" narrative stage.
//  A Texas underground den built entirely in CSS layers (no image
//  assets → nothing new for the CDN/bundle): oil-black wood planks,
//  a flickering neon roadhouse sign, a hanging bulb over bourbon-
//  leather felt. StageAtmosphere grades the whole room off winStreak.
//
//  The secret: a mockingbird silhouette perched on the sign's power
//  wire, colored ~one shade off the wall so it hides in plain sight.
//  Triple-tap it inside 2s (useSecretUnlock) → jackpot overlay:
//  god-rays, chip rain, gold-gradient "SECRET STASH UNLOCKED" and a
//  counting "+5,000 CHIPS!" (reuses social/useCountUp). Chips are
//  credited on COLLECT, not on unlock — collecting is the dopamine.
//
//  A11y (deliberate — don't "fix"):
//   · The bird is a real <button> with an aria-label and a
//     focus-visible ring, so keyboard/screen-reader players can find
//     the secret too. The ring only shows on keyboard focus, so it
//     spoils nothing for pointer users.
//   · Every tap answers with a wing-flutter + floating ♪ so players
//     know they hit *something* without announcing what.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useMemo, useState, type ReactNode } from 'react';
import { formatChips } from '../i18n/lucky';
import { useCountUp } from '../social/useCountUp';
import StageAtmosphere, { moodForStreak } from './StageAtmosphere';
import { useSecretUnlock } from './useSecretUnlock';

export const SECRET_STASH_BONUS = 5000;

// Stage palette — bourbon/oil/dusk, deliberately warmer + dirtier than
// the arena's abyss/neon scheme so the tier reads "underground Texas."
const WALL = { plank: '#2a170f', gap: '#1c0e08', bird: '#3a221507' };

/** Perched mockingbird silhouette — long tail reads "mockingbird" at a glance. */
function MockingbirdSilhouette({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        d="M6 22 L15 19 C16 12 25 9 29 14 C37 12 46 17 47 26 L59 43 L52 45 L44 33 C41 39 32 42 25 39 C19 36 13 29 14 24 Z"
        fill="currentColor"
      />
      {/* legs onto the wire */}
      <path d="M26 39 L25 48 M33 40 L33 48" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* eye — barely-visible pin of wall color */}
      <circle cx="20" cy="17.5" r="1.4" fill={WALL.plank} opacity="0.9" />
    </svg>
  );
}

/** One falling casino chip in the reward rain. */
function RainingChip({ x, delay, dur, spin }: { x: number; delay: number; dur: number; spin: number }) {
  return (
    <motion.span
      className="absolute top-0 grid h-9 w-9 place-items-center rounded-full border-4 border-dashed border-amber-100/90 text-[0.55rem] font-black text-amber-900 shadow-glow-gold"
      style={{
        left: `${x}%`,
        background: 'radial-gradient(circle at 35% 30%, #ffe9a3, #ffd24a 55%, #c9971d)',
      }}
      initial={{ y: -60, opacity: 0, rotate: 0 }}
      animate={{ y: '110vh', opacity: [0, 1, 1, 0.9], rotate: spin }}
      transition={{ duration: dur, delay, ease: [0.3, 0, 0.8, 1] }}
    >
      5K
    </motion.span>
  );
}

/** Jackpot overlay: scrim flash → god-rays → chip rain → counting payout. */
function SecretStashOverlay({ onCollect }: { onCollect: () => void }) {
  const reduceMotion = useReducedMotion();
  const chipsWon = useCountUp(SECRET_STASH_BONUS, true, 0.5);
  const rain = useMemo(
    () =>
      Array.from({ length: 26 }, () => ({
        x: Math.random() * 96,
        delay: Math.random() * 1.6,
        dur: 1.4 + Math.random() * 1.2,
        spin: (Math.random() - 0.5) * 900,
      })),
    [],
  );

  return (
    <motion.div
      className="absolute inset-0 z-50 cursor-pointer overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      onPointerDown={onCollect}
      role="dialog"
      aria-label={`Secret stash unlocked: ${SECRET_STASH_BONUS} chips`}
    >
      {/* scrim + opening white flash */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      {!reduceMotion && (
        <motion.div
          className="absolute inset-0 bg-white"
          initial={{ opacity: 0.9 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      )}

      {/* rotating god-rays */}
      {!reduceMotion && (
        <motion.div
          className="absolute left-1/2 top-1/2 h-[180%] w-[180%] -translate-x-1/2 -translate-y-1/2 mix-blend-screen"
          style={{
            background:
              'repeating-conic-gradient(from 0deg, rgba(255,210,74,0.22) 0deg 9deg, transparent 9deg 24deg)',
            maskImage: 'radial-gradient(circle, black 20%, transparent 68%)',
            WebkitMaskImage: 'radial-gradient(circle, black 20%, transparent 68%)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* chip rain */}
      {!reduceMotion && (
        <div className="pointer-events-none absolute inset-0">
          {rain.map((c, i) => (
            <RainingChip key={i} {...c} />
          ))}
        </div>
      )}

      {/* the bird, revealed in gold, flies off with its secret spent */}
      <motion.div
        className="absolute left-1/2 top-[26%] -translate-x-1/2 text-neon-gold drop-shadow-[0_0_18px_rgba(255,210,74,0.9)]"
        initial={{ scale: 0.4, opacity: 0, y: 20 }}
        animate={
          reduceMotion
            ? { scale: 1, opacity: 1, y: 0 }
            : { scale: [0.4, 1.15, 1], opacity: [0, 1, 1, 0], y: [20, 0, -90], rotate: [0, -6, 8, -4] }
        }
        transition={{ duration: 2.2, times: [0, 0.25, 0.8, 1] }}
      >
        <MockingbirdSilhouette className="h-14 w-14" />
      </motion.div>

      {/* headline + payout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <motion.div
          className="font-display text-3xl font-black leading-tight tracking-[0.14em] sm:text-4xl"
          style={{
            background: 'linear-gradient(180deg, #fff7d6 8%, #ffd24a 40%, #b8860b 70%, #ffe9a3 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            filter: 'drop-shadow(0 2px 0 rgba(0,0,0,0.6)) drop-shadow(0 0 22px rgba(255,210,74,0.55))',
          }}
          initial={{ scale: reduceMotion ? 1 : 0.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 14, delay: 0.15 }}
        >
          SECRET STASH
          <br />
          UNLOCKED
        </motion.div>

        <motion.div
          className="mt-3 font-display text-4xl font-black text-neon-gold sm:text-5xl"
          style={{ textShadow: '0 0 24px rgba(255,210,74,0.8), 0 3px 0 rgba(0,0,0,0.6)' }}
          initial={{ opacity: 0, y: 14 }}
          animate={
            reduceMotion
              ? { opacity: 1, y: 0 }
              : { opacity: 1, y: 0, scale: [1, 1.06, 1] }
          }
          transition={{
            delay: 0.4,
            scale: { duration: 0.7, repeat: Infinity, ease: 'easeInOut' },
          }}
        >
          +{formatChips(chipsWon)} CHIPS!
        </motion.div>

        <motion.div
          className="mt-6 text-[0.65rem] font-bold tracking-[0.35em] text-white/70"
          initial={{ opacity: 0 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: [0, 1, 0.35, 1] }}
          transition={{ delay: 1.2, duration: 1.6, repeat: Infinity }}
        >
          TAP TO COLLECT
        </motion.div>
      </div>
    </motion.div>
  );
}

export interface MockingbirdTableProps {
  /** Positive = consecutive wins, negative = consecutive losses. */
  winStreak: number;
  /** Credited when the player COLLECTS the secret stash. */
  onSecretUnlock?: (bonusChips: number) => void;
  /** Game UI (bet controls, cards) rendered onto the felt. */
  children?: ReactNode;
}

export default function MockingbirdTable({ winStreak, onSecretUnlock, children }: MockingbirdTableProps) {
  const reduceMotion = useReducedMotion();
  const [showReward, setShowReward] = useState(false);
  // Keys a one-shot flutter animation per registered tap.
  const [flutter, setFlutter] = useState(0);

  const secret = useSecretUnlock({
    taps: 3,
    windowMs: 2000,
    onUnlock: () => setShowReward(true),
  });

  const collect = () => {
    setShowReward(false);
    onSecretUnlock?.(SECRET_STASH_BONUS);
  };

  return (
    <StageAtmosphere
      winStreak={winStreak}
      className="rounded-3xl border border-white/10 shadow-chunky"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden sm:aspect-[16/10]" style={{ background: '#140b07' }}>
        {/* ── back wall: dusk glow bleeding through plank gaps ── */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(90% 55% at 50% 8%, rgba(255,140,50,0.16), transparent 65%),
              repeating-linear-gradient(180deg, ${WALL.plank} 0 44px, ${WALL.gap} 44px 47px)`,
          }}
        />
        {/* wood grain streaks */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              'repeating-linear-gradient(92deg, transparent 0 18px, rgba(0,0,0,0.22) 18px 19px, transparent 19px 41px)',
          }}
        />

        {/* ── neon roadhouse sign ── */}
        <div className="absolute left-1/2 top-[7%] -translate-x-1/2 -rotate-1">
          <motion.div
            className="rounded-xl border-2 border-amber-200/25 bg-black/45 px-4 py-2 text-center"
            style={{ boxShadow: '0 0 30px rgba(255,170,60,0.28), inset 0 0 18px rgba(0,0,0,0.7)' }}
            animate={
              reduceMotion
                ? undefined
                : { opacity: [1, 1, 0.92, 1, 0.45, 1, 1] }
            }
            transition={{ duration: 4.6, times: [0, 0.55, 0.6, 0.64, 0.66, 0.7, 1], repeat: Infinity }}
          >
            <div
              className="font-display text-[0.6rem] font-black tracking-[0.3em] text-amber-100 sm:text-xs"
              style={{ textShadow: '0 0 10px rgba(255,190,80,0.95), 0 0 26px rgba(255,140,40,0.6)' }}
            >
              ROAD TO
            </div>
            <div
              className="font-display text-base font-black tracking-[0.22em] text-neon-gold sm:text-xl"
              style={{ textShadow: '0 0 12px rgba(255,210,74,0.95), 0 0 32px rgba(255,150,40,0.65)' }}
            >
              MOCKINGBIRD
            </div>
          </motion.div>
          {/* lone star */}
          <div
            className="absolute -right-5 -top-3 text-lg text-neon-pink"
            style={{ textShadow: '0 0 10px rgba(255,46,136,0.9), 0 0 24px rgba(255,46,136,0.5)' }}
          >
            ★
          </div>
        </div>

        {/* ── power wire + THE SECRET ── */}
        <svg className="pointer-events-none absolute left-0 top-[24%] w-full" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 8 Q200 34 400 4" stroke="rgba(0,0,0,0.55)" strokeWidth="1.5" fill="none" />
        </svg>
        <motion.button
          type="button"
          aria-label="A quiet mockingbird on the wire"
          onPointerDown={secret.registerTap}
          onPointerUp={() => setFlutter(f => f + 1)}
          className="absolute right-[16%] top-[17.5%] z-20 cursor-default rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-gold/80"
          style={{ color: '#31201288', filter: `drop-shadow(0 0 ${6 * secret.progress}px rgba(255,210,74,${0.55 * secret.progress}))` }}
          key={flutter}
          animate={
            flutter && !reduceMotion
              ? { rotate: [0, -8, 6, 0], scale: [1, 1.12, 1], transition: { duration: 0.35 } }
              : undefined
          }
        >
          <MockingbirdSilhouette className="h-7 w-7 sm:h-8 sm:w-8" />
          {/* per-tap chirp note — feedback without a spoiler */}
          <AnimatePresence>
            {secret.tapCount > 0 && (
              <motion.span
                key={`note-${secret.tapCount}`}
                className="absolute -right-2 -top-3 text-[0.6rem] text-amber-200/80"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: [0, 1, 0], y: -14 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9 }}
              >
                ♪
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        {/* ── hanging bulb + light cone ── */}
        <div className="absolute left-1/2 top-0 h-[30%] w-px -translate-x-1/2 bg-black/60" />
        <div
          className="absolute left-1/2 top-[30%] h-3 w-3 -translate-x-1/2 rounded-full"
          style={{ background: '#ffe9b0', boxShadow: '0 0 18px 6px rgba(255,220,150,0.75)' }}
        />
        <div
          className="absolute left-1/2 top-[31%] h-[45%] w-[72%] -translate-x-1/2"
          style={{
            clipPath: 'polygon(46% 0, 54% 0, 100% 100%, 0 100%)',
            background: 'linear-gradient(180deg, rgba(255,224,160,0.32), rgba(255,210,140,0.05) 80%, transparent)',
          }}
        />

        {/* ── bourbon-leather felt ── */}
        <div className="absolute inset-x-0 bottom-0 h-[46%]">
          <div className="h-1 w-full bg-gradient-to-r from-transparent via-yellow-600/70 to-transparent" />
          <div
            className="h-full w-full"
            style={{
              background: 'radial-gradient(130% 100% at 50% 0%, #56231331, transparent), radial-gradient(120% 130% at 50% 20%, #4a1d12, #2a0f09 75%)',
            }}
          >
            {/* betting arc */}
            <div className="absolute left-1/2 top-[24%] h-[130%] w-[86%] -translate-x-1/2 rounded-[50%] border-2 border-yellow-200/15" />
            <div className="absolute left-1/2 top-[34%] -translate-x-1/2 whitespace-nowrap font-display text-[0.55rem] tracking-[0.5em] text-yellow-100/20">
              MOCKINGBIRD · NO LIMITS
            </div>
            {/* game UI slot */}
            {children && <div className="absolute inset-x-4 bottom-4 z-10">{children}</div>}
          </div>
        </div>

        {/* ── the payoff ── */}
        <AnimatePresence>
          {showReward && <SecretStashOverlay key="stash" onCollect={collect} />}
        </AnimatePresence>
      </div>
    </StageAtmosphere>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MockingbirdDemo — mock-driven DemoHub harness (no backend), same
//  pattern as ClutchDemo: WIN/LOSE buttons walk the streak through
//  cold → neutral → hot so testers can feel every atmosphere state.
// ═══════════════════════════════════════════════════════════════════
const MOOD_BADGE = {
  cold: { label: '❄️ RUNNING COLD', cls: 'text-neon-blue' },
  neutral: { label: '🎲 NEUTRAL', cls: 'text-white/60' },
  hot: { label: '🔥 RUNNING HOT', cls: 'text-neon-gold' },
} as const;

export function MockingbirdDemo() {
  const [streak, setStreak] = useState(0);
  const [chips, setChips] = useState(12_500);
  const mood = MOOD_BADGE[moodForStreak(streak)];

  return (
    <div className="flex flex-col gap-3">
      <MockingbirdTable
        winStreak={streak}
        onSecretUnlock={bonus => setChips(c => c + bonus)}
      />

      <div className="glass flex items-center justify-between px-4 py-3 text-xs">
        <div>
          <span className="text-white/45">CHIPS </span>
          <span className="font-display font-black text-neon-gold">{formatChips(chips)}</span>
        </div>
        <div className={`font-bold tracking-widest ${mood.cls}`}>
          {mood.label}
          {streak !== 0 && <span className="ml-1 text-white/50">×{Math.abs(streak)}</span>}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setStreak(s => (s < 0 ? 1 : s + 1))}
          className="btn-chunky flex-1 bg-win/90 py-2 text-[0.65rem] text-abyss-900"
        >
          SIMULATE WIN
        </button>
        <button
          onClick={() => setStreak(s => (s > 0 ? -1 : s - 1))}
          className="btn-chunky flex-1 bg-loss/80 py-2 text-[0.65rem] text-white"
        >
          SIMULATE LOSS
        </button>
        <button
          onClick={() => setStreak(0)}
          className="btn-chunky bg-white/[0.07] px-4 py-2 text-[0.65rem] text-white/70"
        >
          RESET
        </button>
      </div>

      <div className="text-center text-[0.6rem] italic tracking-wide text-white/30">
        Roadhouse rumor: tap what sings — three times, quick.
      </div>
    </div>
  );
}
