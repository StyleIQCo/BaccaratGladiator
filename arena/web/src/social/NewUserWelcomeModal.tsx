'use client'; // no-op under Vite; required if this file moves into a Next.js app
// ═══════════════════════════════════════════════════════════════════
//  NEW-USER WELCOME MODAL — the referee's instant Welcome Gift.
//  Shown on first login after signing up with a referral code: chips
//  rain onto a stack one by one, the counter spins up to +10,000, and
//  the only exit is the big green START PLAYING button. Copy + amount
//  mirror the /api/auth/register response (welcomeGift.chips).
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCountUp } from './useCountUp';

// Bottom-up paint order: mostly gold with two accent chips in the pile.
const CHIP_STACK = [
  'bg-gradient-to-b from-yellow-200 via-neon-gold to-amber-600 border-yellow-100/80',
  'bg-gradient-to-b from-pink-300 via-neon-pink to-rose-700 border-pink-100/80',
  'bg-gradient-to-b from-yellow-200 via-neon-gold to-amber-600 border-yellow-100/80',
  'bg-gradient-to-b from-cyan-200 via-neon-blue to-sky-600 border-cyan-100/80',
  'bg-gradient-to-b from-yellow-200 via-neon-gold to-amber-600 border-yellow-100/80',
  'bg-gradient-to-b from-yellow-200 via-neon-gold to-amber-600 border-yellow-100/80',
];

export default function NewUserWelcomeModal({
  open,
  onClose,
  onStart,
  amount = 10_000,
  friendHandle,
}: {
  open: boolean;
  onClose: () => void;
  onStart?: () => void; // CTA action; falls back to onClose
  amount?: number;
  friendHandle?: string; // referrer's handle, when known
}) {
  const reduceMotion = useReducedMotion();
  const shown = useCountUp(amount, open, 0.55);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-abyss-900/75 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* Animated gradient border wrapper = the glow */}
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 90, scale: 0.8, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 60, scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="w-full max-w-sm rounded-3xl bg-gradient-to-br from-neon-gold via-neon-green to-neon-blue p-[2px] shadow-glow-gold animate-pulse-glow"
          >
            <div className="relative overflow-hidden rounded-[22px] bg-abyss-800 p-6 text-center text-white">
              {/* Ambient sparkles */}
              <span className="pointer-events-none absolute left-5 top-8 animate-pulse text-neon-gold/70">✦</span>
              <span className="pointer-events-none absolute right-7 top-16 animate-pulse text-neon-blue/60 [animation-delay:400ms]">✦</span>
              <span className="pointer-events-none absolute left-9 bottom-24 animate-pulse text-neon-pink/50 [animation-delay:800ms]">✦</span>

              <button
                onClick={onClose}
                className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/60 hover:bg-white/20"
                aria-label="Close"
              >
                ✕
              </button>

              <div className="mb-1 text-[0.7rem] tracking-[0.25em] text-white/50">WELCOME GIFT</div>
              <h2 className="font-display text-2xl font-black leading-tight tracking-wide text-neon-gold">
                YOUR FRIEND
                <br />
                HOOKED YOU UP!
              </h2>
              <div className="mt-1 text-[0.72rem] text-white/55">
                {friendHandle ? `@${friendHandle} saved you a seat` : 'A gladiator saved you a seat'} at the table
              </div>

              {/* The glowing chip stack — chips drop in one by one */}
              <div className="relative mx-auto mt-5 h-28 w-40">
                <div className="absolute inset-x-6 bottom-0 h-16 rounded-full bg-neon-gold/25 blur-2xl" />
                {CHIP_STACK.map((chipClass, i) => (
                  <motion.div
                    key={i}
                    initial={reduceMotion ? false : { y: -110, opacity: 0, scale: 1.2 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 480, damping: 26, delay: 0.35 + i * 0.09 }}
                    className={`absolute left-0 right-0 mx-auto h-[18px] w-24 rounded-[50%] border-2 border-dashed shadow-chunky-sm ${chipClass}`}
                    style={{ bottom: i * 13 }}
                  />
                ))}
              </div>

              {/* Odometer */}
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.5 }}
                className="mt-3 font-display text-4xl font-black tracking-wide text-neon-gold drop-shadow-[0_0_18px_rgba(255,210,74,0.6)]"
              >
                +{shown.toLocaleString()}
                <span className="ml-1 text-xl text-neon-gold/80">CHIPS</span>
              </motion.div>
              <div className="mt-1 text-[0.62rem] tracking-wider text-white/40">
                ALREADY IN YOUR STACK — NO STRINGS
              </div>

              <motion.button
                onClick={onStart ?? onClose}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.94 }}
                className="btn-chunky mt-5 w-full bg-neon-green py-3 text-lg text-abyss-900"
              >
                START PLAYING ▶
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
