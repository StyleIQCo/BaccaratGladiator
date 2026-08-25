// ═══════════════════════════════════════════════════════════════════
//  VIPGate — the visual half of useVIPAccess. Wrap the stage in it:
//  with access the children render untouched (plus a small "how you
//  boarded" laurel); without, the stage stays MOUNTED but heavily
//  blurred as a teaser behind a glowing lock and the referral CTA —
//  locked players should see the waves rolling and want in.
//
//  The blurred layer is aria-hidden + pointer-events-none so screen
//  readers and stray taps can't reach the locked content.
//
//  Bounty copy mirrors referral-engine/lib/referral.ts economics
//  (WELCOME_GIFT_CHIPS 10k / REFERRER_BOUNTY_CHIPS 50k) — that package
//  is server-side (node:crypto), so the numbers are restated here, not
//  imported. If the economics change, change both.
// ═══════════════════════════════════════════════════════════════════
import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useVIPAccess, type VIPProfile } from './useVIPAccess';

/** Gold padlock, drawn inline so the glow can live on the strokes. */
const LockIcon = () => (
  <svg viewBox="0 0 24 24" className="h-11 w-11" aria-hidden
    fill="none" stroke="url(#vipLockGold)" strokeWidth={1.8} strokeLinecap="round">
    <defs>
      <linearGradient id="vipLockGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffe9a3" />
        <stop offset="1" stopColor="#c9971d" />
      </linearGradient>
    </defs>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" fill="rgba(255,210,74,0.14)" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    <circle cx="12" cy="15" r="1.4" fill="#ffd24a" stroke="none" />
  </svg>
);

export default function VIPGate({
  children,
  onReferFriend,
  profileOverride,
}: {
  children: ReactNode;
  /** CTA tap — open the referral flow (demo wires the Hongbao modal). */
  onReferFriend: () => void;
  /** Bypass the mock store; pass the real session profile when wired. */
  profileOverride?: VIPProfile;
}) {
  const { hasAccess, reason } = useVIPAccess(profileOverride);
  const reduced = useReducedMotion();

  if (hasAccess) {
    return (
      <div className="relative">
        {children}
        {/* How this player boarded — earned (referrer) vs gifted (referee) */}
        <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-neon-gold/40 bg-abyss-900/70 px-3 py-1 text-[0.55rem] font-bold tracking-[0.25em] text-neon-gold backdrop-blur-sm">
          {reason === 'referrer' ? '🏛 BOARDED · CREW CAPTAIN' : '🏛 BOARDED · INVITED CREW'}
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[2rem]">
      {/* The stage itself, heavily blurred — a living teaser, not a screenshot */}
      <div aria-hidden className="pointer-events-none select-none blur-lg brightness-[0.55] saturate-[0.85]">
        {children}
      </div>

      {/* The gate */}
      <div className="absolute inset-0 z-20 grid place-items-center bg-gradient-to-b from-slate-950/60 via-blue-950/40 to-slate-950/70 p-6">
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="flex max-w-xs flex-col items-center text-center"
        >
          <motion.div
            className="grid h-20 w-20 place-items-center rounded-full border border-neon-gold/50 bg-abyss-900/80"
            animate={reduced ? undefined : {
              boxShadow: [
                '0 0 14px rgba(255,210,74,0.35), 0 0 34px rgba(255,210,74,0.12)',
                '0 0 30px rgba(255,210,74,0.75), 0 0 70px rgba(255,210,74,0.28)',
                '0 0 14px rgba(255,210,74,0.35), 0 0 34px rgba(255,210,74,0.12)',
              ],
            }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            style={reduced ? { boxShadow: '0 0 24px rgba(255,210,74,0.55)' } : undefined}
          >
            <LockIcon />
          </motion.div>

          <div className="mt-4 font-display text-xl font-black tracking-[0.2em] text-white">
            THE ODYSSEY AWAITS
          </div>
          <div className="mt-2 text-[0.72rem] leading-relaxed tracking-wider text-white/60">
            This voyage is referral-only. Bring one shipmate aboard and the
            wine-dark sea — and its 50:1 Trojan Horse — opens to you both.
          </div>

          <motion.button
            onClick={onReferFriend}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            className="btn-chunky mt-5 bg-gradient-to-r from-yellow-200 via-neon-gold to-amber-500 px-6 py-3 text-[0.78rem] text-abyss-900 shadow-glow-gold"
          >
            ⚓ REFER A FRIEND TO BOARD THE SHIP
          </motion.button>

          <div className="mt-3 text-[0.58rem] tracking-[0.2em] text-neon-gold/70">
            THEY GET 10,000 CHIPS · YOU GET 50,000 ON THEIR STAGE-1 CLEAR
          </div>
        </motion.div>
      </div>
    </div>
  );
}
