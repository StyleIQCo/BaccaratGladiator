// ═══════════════════════════════════════════════════════════════════
//  COLLECTIBLE UNLOCK CINEMATIC — "the badge drifts in from the dust."
//  Mounts when a `lore:unlock` socket push (or getUnseenLore on session
//  bootstrap) hands the client a newly unlocked lore item. Maps to
//  UserCollectible: dismissing acks via markLoreSeen(unlockId), so a
//  killed app replays the moment next session instead of losing it.
//
//  Beat sheet (full-motion path):
//    1. dim      — the table fades behind an abyss scrim.
//    2. drift    — the relic tumbles in from the top-left edge,
//                  spinning slowly, out of focus.
//    3. snap     — spring to full scale, focus pulls sharp, gold ring
//                  + star-burst, haptic tick; the headline tracks in.
//    4. lore     — the character's backstory fades up beneath it with
//                  the completionist bar ("Wild West Backstory: 3/5").
//  Reduced motion: skip straight to the fully-assembled card.
//
//  Everything below the overlay stays mounted the whole time (opacity/
//  transform only) so the relic never jumps when the card appears.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLayoutEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';

export interface LoreUnlockView {
  unlockId: string;      // UserCollectible.id — ack target for markLoreSeen
  title: string;         // "Lone Star Sheriff's Badge"
  characterName: string; // "Sheriff Rosa 'Lone Star' Delgado"
  loreText: string;      // the backstory fragment
  icon: string;          // emoji relic, e.g. '⭐' — swap for an asset key later
  stageName: string;     // display name of the stage, e.g. "Wild West"
  progress: { collected: number; total: number };
}

type Beat = 'drift' | 'snap' | 'lore';

/** One-shot star-burst from the relic at the snap — CoinBurst's sibling. */
function StarBurst({ count = 18 }: { count?: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        dx: (Math.random() - 0.5) * 300,
        dy: (Math.random() - 0.5) * 240,
        rot: (Math.random() - 0.5) * 720,
        dur: 0.8 + Math.random() * 0.5,
        delay: Math.random() * 0.12,
        glyph: ['✨', '⭐', '💫'][i % 3],
      })),
    [count],
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-30">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute -ml-2 -mt-2 text-base"
          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
          animate={{ x: p.dx, y: p.dy, rotate: p.rot, scale: [0, 1.2, 0.7], opacity: [1, 1, 0] }}
          transition={{ duration: p.dur, delay: p.delay, ease: 'easeOut' }}
        >
          {p.glyph}
        </motion.span>
      ))}
    </div>
  );
}

export default function CollectibleUnlockModal({
  unlock,
  onClose,
}: {
  /** The freshly unlocked item, or null when nothing is queued. */
  unlock: LoreUnlockView | null;
  /** Fires on "ADD TO CODEX" — POST the markLoreSeen ack here. */
  onClose: () => void;
}) {
  const { isZh } = useLocale();
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState<Beat>('drift');

  // Replay the beat sheet for every queued unlock. Layout effect, not
  // effect: `beat` is stale ('lore') after a dismissal, and a plain
  // effect would let the browser paint one frame of the fully-assembled
  // card before the reset lands — back-to-back queue unlocks would
  // flash the ending before the drift begins.
  useLayoutEffect(() => {
    if (!unlock) return;
    if (reduced) { setBeat('lore'); return; }
    setBeat('drift');
    const snap = setTimeout(() => {
      setBeat('snap');
      if ('vibrate' in navigator) navigator.vibrate?.([8, 45, 16]); // the "click" of the badge seating
    }, 1700);
    const lore = setTimeout(() => setBeat('lore'), 2300);
    return () => { clearTimeout(snap); clearTimeout(lore); };
  }, [unlock, reduced]);

  const total = Math.max(1, unlock?.progress.total ?? 1);
  const collected = Math.min(unlock?.progress.collected ?? 0, total);
  const pct = (collected / total) * 100;
  const prevPct = (Math.max(0, collected - 1) / total) * 100; // bar animates the newest fragment in

  return (
    <AnimatePresence>
      {unlock && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={unlock.title}
          className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-abyss-900/85 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => { if (beat === 'lore') onClose(); }}
        >
          <div className="flex w-full max-w-sm flex-col items-center" onClick={e => e.stopPropagation()}>
            {/* Headline zone — height reserved so the relic never shifts */}
            <div className="flex h-14 items-center">
              <AnimatePresence>
                {beat !== 'drift' && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, letterSpacing: '0.5em' }}
                    animate={{ opacity: 1, y: 0, letterSpacing: '0.18em' }}
                    exit={{ opacity: 0 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                    className="whitespace-nowrap text-center font-display text-base font-black text-neon-gold [text-shadow:0_0_18px_rgba(255,210,74,0.6)]"
                  >
                    {isZh ? '✦ 发现新藏品! ✦' : '✦ NEW COLLECTIBLE UNLOCKED! ✦'}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── THE RELIC ─────────────────────────────────────── */}
            <div className="relative grid h-44 w-44 place-items-center">
              {/* Ambient halo, breathes in at the snap */}
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(255,210,74,0.28) 0%, rgba(46,230,255,0.10) 45%, transparent 70%)' }}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={beat === 'drift' ? { opacity: 0 } : { opacity: 1, scale: 1.25 }}
                transition={reduced ? { duration: 0 } : { duration: 0.6 }}
              />
              {/* Focus ring that cracks outward on the snap */}
              {beat !== 'drift' && !reduced && (
                <motion.div
                  className="absolute inset-4 rounded-full border-2 border-neon-gold"
                  initial={{ scale: 0.55, opacity: 0.9 }}
                  animate={{ scale: 2.1, opacity: 0 }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                />
              )}

              {/* The relic itself: drifts in blurred + slowly tumbling,
                  then SNAPS to scale and sharp focus. */}
              <motion.div
                className="relative z-20 select-none text-7xl"
                initial={
                  reduced
                    ? { x: '0vw', y: '0vh', rotate: 0, scale: 1, opacity: 1, filter: 'blur(0px)' }
                    : { x: '-58vw', y: '-26vh', rotate: -560, scale: 0.4, opacity: 0, filter: 'blur(10px)' }
                }
                animate={
                  beat === 'drift'
                    ? { x: '0vw', y: '0vh', rotate: -18, scale: 0.72, opacity: 1, filter: 'blur(5px)' }
                    : { x: '0vw', y: '0vh', rotate: 0, scale: 1, opacity: 1, filter: 'blur(0px)' }
                }
                transition={
                  reduced ? { duration: 0 }
                    : beat === 'drift'
                      ? { duration: 1.7, ease: [0.22, 1, 0.36, 1] } // long lazy tumble
                      : { type: 'spring', stiffness: 380, damping: 16 } // the snap
                }
                style={{ textShadow: '0 0 32px rgba(255,210,74,0.65), 0 0 64px rgba(46,230,255,0.3)' }}
              >
                {unlock.icon}
              </motion.div>

              {beat !== 'drift' && !reduced && <StarBurst />}
            </div>

            {/* ── LORE CARD — mounted throughout, revealed at 'lore' ── */}
            <motion.div
              className="mt-4 w-full rounded-2xl bg-gradient-to-br from-neon-gold via-neon-violet to-neon-blue p-[2px] shadow-glow-gold"
              initial={false}
              animate={beat === 'lore' ? { opacity: 1, y: 0 } : { opacity: 0, y: 28 }}
              transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              style={{ pointerEvents: beat === 'lore' ? 'auto' : 'none' }}
            >
              <div className="rounded-[14px] bg-abyss-800 p-5 text-white">
                <div className="font-display text-2xl font-black leading-tight text-neon-gold">
                  {unlock.title}
                </div>
                <div className="mt-1 text-[0.68rem] font-bold uppercase tracking-[0.3em] text-neon-blue">
                  {unlock.characterName}
                </div>

                <div className="my-3 border-t-2 border-dashed border-white/15" />

                <p className="text-sm italic leading-relaxed text-white/75">{unlock.loreText}</p>

                {/* Completionist bar: this character's fragment set */}
                <div className="mt-4">
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-white/55">
                      {unlock.stageName} {isZh ? '背景故事' : 'Backstory'}
                    </span>
                    <span className="font-display text-sm font-black text-neon-gold">
                      {collected}/{total} {isZh ? '已收集' : 'COLLECTED'}
                    </span>
                  </div>
                  <div className="relative h-2.5 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-neon-gold to-neon-blue shadow-glow-gold"
                      initial={false}
                      animate={{ width: beat === 'lore' ? `${pct}%` : `${prevPct}%` }}
                      transition={reduced ? { duration: 0 } : { delay: 0.35, type: 'spring', stiffness: 120, damping: 20 }}
                    />
                    {/* Fragment dividers — the set is discrete, show it */}
                    {Array.from({ length: total - 1 }, (_, i) => (
                      <span
                        key={i}
                        className="absolute inset-y-0 w-px bg-abyss-900/70"
                        style={{ left: `${((i + 1) / total) * 100}%` }}
                      />
                    ))}
                  </div>
                </div>

                <motion.button
                  onClick={onClose}
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                  className="btn-chunky mt-4 w-full bg-neon-gold py-2.5 text-sm text-abyss-900"
                >
                  {isZh ? '收入图鉴 ✦' : 'ADD TO CODEX ✦'}
                </motion.button>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
