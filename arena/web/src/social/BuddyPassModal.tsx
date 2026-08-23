// ═══════════════════════════════════════════════════════════════════
//  BUDDY PASS MODAL — the glowing VIP ticket.
//  Maps 1:1 to the BuddyPass row (code / maxUses / uses); the reward
//  copy mirrors the Referral QUALIFIED bar. Ticket drops in with a
//  rotation spring, wears an animated gradient border, and has real
//  perforation notches + punch-marks for used invites.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { shareOrCopy } from './share';

export interface BuddyPassView {
  code: string;
  maxUses: number;
  uses: number;
}

const INVITE_TEXT = '🎟 I saved you a seat at the baccarat table — my Buddy Pass gets us BOTH 5,000 chips + 5 gems. Claim it:';
const inviteUrl = (code: string) => `https://baccaratgladiator.com/?buddy=${code}`;

export default function BuddyPassModal({
  open,
  onClose,
  pass = { code: 'GLAD-7F3K', maxUses: 5, uses: 2 },
}: {
  open: boolean;
  onClose: () => void;
  pass?: BuddyPassView;
}) {
  const [copyLabel, setCopyLabel] = useState('COPY LINK');
  const [shareLabel, setShareLabel] = useState('SHARE 🎟');
  const remaining = pass.maxUses - pass.uses;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl(pass.code));
      setCopyLabel('✅ COPIED');
      setTimeout(() => setCopyLabel('COPY LINK'), 1800);
    } catch { /* clipboard denied — leave label unchanged */ }
  }

  async function onShare() {
    const result = await shareOrCopy(INVITE_TEXT, inviteUrl(pass.code));
    if (result !== 'failed') {
      setShareLabel(result === 'shared' ? '✅ SHARED' : '✅ COPIED');
      setTimeout(() => setShareLabel('SHARE 🎟'), 1800);
    }
  }

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
            onClick={e => e.stopPropagation()}
            initial={{ y: 90, rotate: -7, scale: 0.8, opacity: 0 }}
            animate={{ y: 0, rotate: 0, scale: 1, opacity: 1 }}
            exit={{ y: 60, scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="w-full max-w-sm rounded-3xl bg-gradient-to-br from-neon-gold via-neon-pink to-neon-violet p-[2px] shadow-glow-pink animate-pulse-glow"
          >
            <div className="relative overflow-hidden rounded-[22px] bg-abyss-800 p-5 text-white">
              {/* Perforation notches */}
              <div className="pointer-events-none absolute -left-3 top-[58%] h-6 w-6 rounded-full bg-abyss-900" />
              <div className="pointer-events-none absolute -right-3 top-[58%] h-6 w-6 rounded-full bg-abyss-900" />

              <button
                onClick={onClose}
                className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/60 hover:bg-white/20"
                aria-label="Close"
              >
                ✕
              </button>

              {/* Ticket header */}
              <div className="mb-1 font-display text-xl font-black tracking-widest text-neon-gold">
                🎟 BUDDY PASS
              </div>
              <div className="mb-4 text-[0.72rem] tracking-wider text-white/55">
                VIP INVITE · Bring a friend to the arena
              </div>

              {/* Reward — mirrors the Referral QUALIFIED bar */}
              <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.05] p-3 text-center">
                <div className="text-[0.7rem] tracking-widest text-white/50">YOU BOTH GET</div>
                <div className="font-display text-lg font-black text-neon-green">
                  💰 5,000 CHIPS <span className="text-white/40">+</span> 💎 5 GEMS
                </div>
                <div className="mt-1 text-[0.62rem] text-white/40">
                  paid when your buddy clears Tier 1
                </div>
              </div>

              {/* The code */}
              <div className="mb-2 rounded-xl border-2 border-dotted border-neon-blue/50 bg-black/40 py-2.5 text-center">
                <span className="font-display text-2xl font-black tracking-[0.3em] text-neon-blue">
                  {pass.code}
                </span>
              </div>

              {/* Punch marks: one hole per used invite */}
              <div className="mb-1 flex items-center justify-center gap-2 text-[0.8rem]">
                {Array.from({ length: pass.maxUses }, (_, i) => (
                  <span key={i} className={i < pass.uses ? 'text-white/25' : 'text-neon-gold'}>
                    {i < pass.uses ? '◉' : '○'}
                  </span>
                ))}
                <span className="ml-1 text-[0.62rem] tracking-wider text-white/45">
                  {remaining} INVITE{remaining === 1 ? '' : 'S'} LEFT
                </span>
              </div>

              {/* Dashed tear line above actions */}
              <div className="my-3 border-t-2 border-dashed border-white/15" />

              <div className="flex gap-2">
                <motion.button
                  onClick={onCopy}
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                  className="btn-chunky flex-1 bg-neon-blue py-2.5 text-sm text-abyss-900"
                >
                  {copyLabel}
                </motion.button>
                <motion.button
                  onClick={onShare}
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                  className="btn-chunky flex-1 bg-gradient-to-r from-neon-pink to-neon-violet py-2.5 text-sm text-white"
                >
                  {shareLabel}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
