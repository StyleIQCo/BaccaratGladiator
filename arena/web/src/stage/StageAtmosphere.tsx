// ═══════════════════════════════════════════════════════════════════
//  StageAtmosphere — mood-reactive wrapper for stage environments.
//  Listens to winStreak and grades the whole scene like a colorist:
//    · COLD  (streak < 0)  — sepia/desaturate, dim, drifting dust-fog
//    · NEUTRAL (0..2)      — clean vibrant lighting
//    · HOT   (streak >= 3) — screen-shake on entry AND on every extra
//                            win while hot, brightness/contrast punch,
//                            rising gold embers + neon flare sweeps
//  Implementation notes:
//    · Every mood's filter lists the SAME functions in the SAME order
//      so Framer can tween between them instead of hard-cutting.
//    · Lighting is three stacked gradient layers cross-faded by
//      opacity — gradient strings don't interpolate, opacity does.
//    · Respects prefers-reduced-motion: filters snap, no shake, and
//      particles render as a static wash instead of animating.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';

export type StageMood = 'cold' | 'neutral' | 'hot';

export const HOT_STREAK_THRESHOLD = 3;

export const moodForStreak = (streak: number): StageMood =>
  streak < 0 ? 'cold' : streak >= HOT_STREAK_THRESHOLD ? 'hot' : 'neutral';

// Same function list per mood — see header note on tweenability.
const MOOD_FILTER: Record<StageMood, string> = {
  cold:    'sepia(0.45) grayscale(0.35) brightness(0.62) contrast(1.06) saturate(0.6)',
  neutral: 'sepia(0) grayscale(0) brightness(1) contrast(1) saturate(1)',
  hot:     'sepia(0) grayscale(0) brightness(1.14) contrast(1.1) saturate(1.4)',
};

// Cross-faded lighting layers: heavy blue-grey vignette when cold,
// gentle table vignette when neutral, molten edge-glow when hot.
const LIGHT_LAYER: Record<StageMood, CSSProperties> = {
  cold: {
    background: 'linear-gradient(180deg, rgba(46,56,78,0.28), rgba(8,10,22,0.5))',
    boxShadow: 'inset 0 0 140px 60px rgba(5,7,18,0.9)',
  },
  neutral: {
    background: 'transparent',
    boxShadow: 'inset 0 0 90px 24px rgba(5,7,18,0.4)',
  },
  hot: {
    background: 'radial-gradient(120% 90% at 50% 100%, rgba(255,160,40,0.16), transparent 60%)',
    boxShadow: 'inset 0 0 120px 30px rgba(255,140,30,0.22)',
  },
};

/** COLD: slow fog banks drifting sideways + falling dust motes. */
function DustDrift() {
  const reduceMotion = useReducedMotion();
  const motes = useMemo(
    () =>
      Array.from({ length: 14 }, () => ({
        x: Math.random() * 100,
        size: 1.5 + Math.random() * 2.5,
        dur: 7 + Math.random() * 7,
        delay: Math.random() * 6,
        sway: (Math.random() - 0.5) * 40,
      })),
    [],
  );

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.2 }}
    >
      {[0, 1, 2].map(i => (
        <motion.div
          key={`fog-${i}`}
          className="absolute h-[45%] w-[80%] rounded-full blur-3xl"
          style={{
            top: `${12 + i * 28}%`,
            background:
              'radial-gradient(ellipse at center, rgba(148,160,184,0.13), transparent 70%)',
          }}
          initial={{ x: i % 2 ? '60%' : '-30%' }}
          animate={reduceMotion ? undefined : { x: i % 2 ? ['60%', '-30%', '60%'] : ['-30%', '60%', '-30%'] }}
          transition={{ duration: 26 + i * 9, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      {!reduceMotion &&
        motes.map((m, i) => (
          <motion.span
            key={`mote-${i}`}
            className="absolute rounded-full bg-slate-300/25"
            style={{ left: `${m.x}%`, top: -8, width: m.size, height: m.size }}
            animate={{ y: [0, 520], x: [0, m.sway], opacity: [0, 0.7, 0.5, 0] }}
            transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: 'linear' }}
          />
        ))}
    </motion.div>
  );
}

/** HOT: gold embers rising off the table like the room itself is cooking. */
function EmberField({ streak }: { streak: number }) {
  const reduceMotion = useReducedMotion();
  // More heat, more embers — capped so a 20-streak doesn't melt the GPU.
  const count = Math.min(30, 14 + (streak - HOT_STREAK_THRESHOLD) * 4);
  const embers = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: Math.random() * 100,
        size: 2 + Math.random() * 4,
        rise: 280 + Math.random() * 260,
        drift: (Math.random() - 0.5) * 70,
        dur: 2.1 + Math.random() * 1.9,
        delay: Math.random() * 2.4,
      })),
    [count],
  );

  if (reduceMotion) {
    return (
      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
        style={{ background: 'linear-gradient(0deg, rgba(255,190,60,0.14), transparent)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
    );
  }

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      {embers.map((e, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full shadow-glow-gold"
          style={{
            left: `${e.x}%`,
            bottom: -10,
            width: e.size,
            height: e.size,
            background: 'radial-gradient(circle at 35% 30%, #fff3c4, #ffd24a 60%, #ff9d2e)',
          }}
          animate={{
            y: [0, -e.rise],
            x: [0, e.drift],
            opacity: [0, 1, 1, 0],
            scale: [1, 1.15, 0.6],
          }}
          transition={{ duration: e.dur, delay: e.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}
    </motion.div>
  );
}

/** HOT: periodic diagonal neon flare sweeping the scene, casino-marquee style. */
function NeonFlares() {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 overflow-hidden mix-blend-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute -inset-y-8 w-1/4 blur-md"
        style={{
          background:
            'linear-gradient(100deg, transparent, rgba(255,224,138,0.32) 45%, rgba(255,46,136,0.18) 60%, transparent)',
          transform: 'skewX(-14deg)',
        }}
        animate={{ x: ['-60%', '460%'] }}
        transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 2.2, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(60% 40% at 50% 0%, rgba(255,210,74,0.14), transparent 70%)',
        }}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.div>
  );
}

export interface StageAtmosphereProps {
  /** Positive = consecutive wins, negative = consecutive losses. */
  winStreak: number;
  children: ReactNode;
  className?: string;
}

export default function StageAtmosphere({ winStreak, children, className = '' }: StageAtmosphereProps) {
  const mood = moodForStreak(winStreak);
  const reduceMotion = useReducedMotion();
  const shake = useAnimationControls();
  const prevStreak = useRef(winStreak);

  useEffect(() => {
    const wasHot = moodForStreak(prevStreak.current) === 'hot';
    const escalated = mood === 'hot' && (!wasHot || winStreak > prevStreak.current);
    prevStreak.current = winStreak;
    if (!escalated || reduceMotion) return;
    shake.start({
      x: [0, -8, 9, -6, 5, -2, 0],
      y: [0, 5, -7, 4, -3, 1, 0],
      transition: { duration: 0.45, ease: 'easeOut' },
    });
  }, [winStreak, mood, reduceMotion, shake]);

  return (
    <motion.div animate={shake} className={`relative overflow-hidden ${className}`}>
      {/* The graded scene itself */}
      <motion.div
        className="relative"
        animate={{ filter: MOOD_FILTER[mood] }}
        transition={{ duration: reduceMotion ? 0 : 1.4, ease: 'easeInOut' }}
      >
        {children}
      </motion.div>

      {/* Lighting rig: all three layers always mounted, opacity cross-fade */}
      {(Object.keys(LIGHT_LAYER) as StageMood[]).map(m => (
        <motion.div
          key={m}
          className="pointer-events-none absolute inset-0"
          style={LIGHT_LAYER[m]}
          initial={false}
          animate={{ opacity: mood === m ? 1 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 1.2, ease: 'easeInOut' }}
        />
      ))}

      {/* Weather */}
      <AnimatePresence>
        {mood === 'cold' && <DustDrift key="dust" />}
        {mood === 'hot' && <EmberField key="embers" streak={winStreak} />}
        {mood === 'hot' && <NeonFlares key="flares" />}
      </AnimatePresence>
    </motion.div>
  );
}
