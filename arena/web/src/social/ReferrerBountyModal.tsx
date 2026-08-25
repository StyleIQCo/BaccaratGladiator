'use client'; // no-op under Vite; required if this file moves into a Next.js app
// ═══════════════════════════════════════════════════════════════════
//  REFERRER BOUNTY MODAL — the payoff theatre.
//  Fires when an invite clears Stage 1 (/api/referrals/validate →
//  rewarded: true, or the gateway's referral:qualified push). The
//  sequence: card springs in → chest rattles → lid blows open on a
//  spring (perspective rotateX) → light column + coin particles erupt
//  → "+50,000 CHIPS" slams in → the CTA pulses until tapped.
//  The card uses framer `layout` so it grows smoothly under the reveal.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useCountUp } from './useCountUp';

type Phase = 'shaking' | 'open';

// Deterministic pseudo-random (shader fract-hash trick): stable across
// re-renders and SSR/hydration, so the burst never "re-rolls".
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const PARTICLE_GLYPHS = ['🪙', '✦', '💰', '🪙', '✦'];
const PARTICLE_COUNT = 16;

export default function ReferrerBountyModal({
  open,
  onClose,
  onInviteMore,
  amount = 50_000,
  refereeHandle,
}: {
  open: boolean;
  onClose: () => void;
  onInviteMore?: () => void; // CTA action (open BuddyPassModal); falls back to onClose
  amount?: number;
  refereeHandle?: string; // the recruit who cleared Stage 1
}) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('shaking');
  const opened = phase === 'open';
  const shown = useCountUp(amount, open && opened, 0.15);

  // Rattle for ~0.9s, then blow the lid. Reduced motion skips the tease.
  useEffect(() => {
    if (!open) return;
    setPhase(reduceMotion ? 'open' : 'shaking');
    if (reduceMotion) return;
    const t = setTimeout(() => setPhase('open'), 900);
    return () => clearTimeout(t);
  }, [open, reduceMotion]);

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const angle = 0.45 + rand(i, 1) * 2.25; // ~26°..155° fan above the chest
        const dist = 90 + rand(i, 2) * 90;
        return {
          glyph: PARTICLE_GLYPHS[i % PARTICLE_GLYPHS.length],
          x: Math.cos(angle) * dist,
          y: -(Math.sin(angle) * dist + 40),
          spin: (rand(i, 3) - 0.5) * 720,
          duration: 0.9 + rand(i, 4) * 0.5,
          delay: 0.04 * (i % 5),
          size: 0.8 + rand(i, 5) * 0.6,
        };
      }),
    [],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-abyss-900/80 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* Gradient border wrapper; `layout` lets the card grow under the reveal */}
          <motion.div
            layout
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 100, scale: 0.75, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 60, scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            className="w-full max-w-sm rounded-3xl bg-gradient-to-br from-neon-gold via-neon-pink to-neon-violet p-[2px] shadow-glow-gold animate-pulse-glow"
          >
            <motion.div layout className="relative overflow-hidden rounded-[22px] bg-abyss-800 p-6 text-center text-white">
              <button
                onClick={onClose}
                className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/60 hover:bg-white/20"
                aria-label="Close"
              >
                ✕
              </button>

              <motion.div layout="position" className="mb-1 text-[0.7rem] tracking-[0.25em] text-white/50">
                REFERRAL BOUNTY
              </motion.div>
              <motion.h2
                layout="position"
                className="font-display text-3xl font-black tracking-wide text-neon-gold drop-shadow-[0_0_16px_rgba(255,210,74,0.5)]"
              >
                BOUNTY SECURED!
              </motion.h2>
              <motion.div layout="position" className="mt-1 text-[0.72rem] text-white/55">
                {refereeHandle ? `@${refereeHandle} cleared Stage 1` : 'Your recruit cleared Stage 1'} — the
                cut is yours.
              </motion.div>

              {/* ── THE CHEST ─────────────────────────────────────── */}
              <motion.div
                layout="position"
                className="relative mx-auto mt-6 h-40 w-48"
                animate={
                  phase === 'shaking' && !reduceMotion
                    ? { rotate: [0, -3, 3, -4, 4, -2, 2, 0], x: [0, -2, 2, -3, 3, -1, 1, 0] }
                    : { rotate: 0, x: 0 }
                }
                transition={phase === 'shaking' ? { duration: 0.85, ease: 'easeInOut' } : undefined}
              >
                {/* Light column erupting from the mouth */}
                <motion.div
                  initial={false}
                  animate={opened ? { opacity: [0, 1, 0.65], scaleY: [0.2, 1.15, 1] } : { opacity: 0, scaleY: 0.2 }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                  style={{ transformOrigin: 'bottom center' }}
                  className="absolute bottom-16 left-0 right-0 mx-auto h-28 w-24 rounded-t-full bg-gradient-to-t from-neon-gold/70 via-neon-gold/25 to-transparent blur-md"
                />

                {/* Particle burst — anchored at the chest mouth */}
                <div className="pointer-events-none absolute bottom-24 left-0 right-0 mx-auto h-0 w-0">
                  {!reduceMotion &&
                    particles.map((p, i) => (
                      <motion.span
                        key={i}
                        initial={false}
                        animate={
                          opened
                            ? { x: p.x, y: p.y, rotate: p.spin, opacity: [0, 1, 1, 0], scale: p.size }
                            : { x: 0, y: 0, rotate: 0, opacity: 0, scale: 0.4 }
                        }
                        transition={opened ? { duration: p.duration, delay: p.delay, ease: 'easeOut' } : { duration: 0 }}
                        className="absolute text-xl"
                        style={{ textShadow: '0 0 12px rgba(255,210,74,0.8)' }}
                      >
                        {p.glyph}
                      </motion.span>
                    ))}
                </div>

                {/* Lid — swings back on a creaky spring */}
                <div className="absolute bottom-[76px] left-0 right-0 mx-auto h-16 w-44" style={{ perspective: 500 }}>
                  <motion.div
                    initial={false}
                    animate={{ rotateX: opened ? -112 : 0 }}
                    transition={{ type: 'spring', stiffness: 170, damping: 13 }}
                    style={{ transformOrigin: 'bottom center' }}
                    className="absolute bottom-0 h-14 w-full rounded-t-[26px] border-2 border-amber-900 bg-gradient-to-b from-amber-500 via-amber-700 to-amber-800 shadow-chunky-sm"
                  >
                    <div className="absolute left-0 right-0 top-0 mx-auto h-full w-8 rounded-t-[20px] bg-gradient-to-b from-neon-gold/90 to-amber-500/70" />
                  </motion.div>
                </div>

                {/* Base */}
                <div className="absolute bottom-0 left-0 right-0 mx-auto h-[84px] w-44 rounded-b-2xl rounded-t-md border-2 border-amber-900 bg-gradient-to-b from-amber-700 via-amber-800 to-amber-950 shadow-chunky">
                  <div className="absolute left-0 right-0 top-0 mx-auto h-full w-8 bg-gradient-to-b from-neon-gold/80 to-amber-600/60" />
                  {/* Lock plate */}
                  <div className="absolute -top-3 left-0 right-0 z-10 mx-auto grid h-9 w-8 place-items-center rounded-md border border-amber-900 bg-gradient-to-b from-neon-gold to-amber-600 shadow-chunky-sm">
                    <div className="h-2.5 w-2.5 rounded-full bg-amber-950" />
                  </div>
                </div>
              </motion.div>

              {/* ── THE NUMBER — slams in once the lid is off ─────── */}
              {opened && (
                <motion.div
                  layout="position"
                  initial={reduceMotion ? { opacity: 0 } : { scale: 2.6, opacity: 0, y: -12 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 16, delay: 0.12 }}
                  className="mt-4 font-display text-5xl font-black tracking-wide text-neon-gold drop-shadow-[0_0_24px_rgba(255,210,74,0.7)]"
                >
                  +{shown.toLocaleString()}
                  <span className="ml-1 text-2xl text-neon-gold/80">CHIPS</span>
                </motion.div>
              )}

              <motion.button
                layout="position"
                onClick={onInviteMore ?? onClose}
                animate={reduceMotion ? undefined : { scale: [1, 1.05, 1] }}
                transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
                whileHover={{ scale: 1.07 }}
                whileTap={{ scale: 0.94 }}
                className="btn-chunky mt-5 w-full bg-gradient-to-r from-neon-gold to-amber-500 py-3 text-lg text-abyss-900 shadow-glow-gold"
              >
                CLAIM &amp; INVITE MORE 🎟
              </motion.button>
              <motion.div layout="position" className="mt-2 text-[0.62rem] tracking-wider text-white/40">
                EVERY RECRUIT WHO CLEARS STAGE 1 = ANOTHER {amount.toLocaleString()}-CHIP BOUNTY
              </motion.div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
