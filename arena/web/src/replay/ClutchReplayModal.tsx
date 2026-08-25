// ═══════════════════════════════════════════════════════════════════
//  CLUTCH MOMENT REPLAY — the viral engine.
//  Auto-pops after a qualifying win (feed settled hands through
//  detectClutch). A 9:16 TikTok-style stage replays the hand as a
//  step-directed cinematic:
//    intro → deal → standoff ("DOWN 3–7") → pivot (slow-mo third
//    card, spotlight + shake) → result (headline slam, payout pop)
//  The share button records a REAL WebM of the branded canvas replay
//  and hands it to the OS share sheet (TikTok/Reels live there).
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { DEMO_CLUTCH, type ClutchMoment } from './clutch';
import { recordClutchVideo, shareClutch, type ShareOutcome } from './capture';

type Step = 'intro' | 'deal' | 'standoff' | 'pivot' | 'result';
const SCRIPT: Array<[Step, number]> = [
  ['intro', 900], ['deal', 1700], ['standoff', 1300], ['pivot', 1400], ['result', 99_999],
];

function useReplayDirector(active: boolean, runId: number) {
  const [step, setStep] = useState<Step>('intro');
  useEffect(() => {
    if (!active) return;
    setStep('intro');
    let t = 0;
    const timers = SCRIPT.slice(0, -1).map(([, dur], i) => {
      t += dur;
      return setTimeout(() => setStep(SCRIPT[i + 1][0]), t);
    });
    return () => timers.forEach(clearTimeout);
  }, [active, runId]);
  return step;
}

const stepIndex = (s: Step) => SCRIPT.findIndex(([k]) => k === s);

function ReplayCard({ rank, suit, delay, pivot, shown }: {
  rank: string; suit: string; delay: number; pivot?: boolean; shown: boolean;
}) {
  const red = suit === '♥' || suit === '♦';
  if (!shown) return <div className={`rounded-lg border border-dashed border-white/10 ${pivot ? 'h-28 w-[76px]' : 'h-24 w-16'}`} />;
  return (
    <motion.div
      initial={pivot ? { scale: 3, y: -140, rotate: 14, opacity: 0 } : { y: -40, rotateY: 180, opacity: 0 }}
      animate={pivot ? { scale: 1.12, y: 0, rotate: -3, opacity: 1 } : { y: 0, rotateY: 0, opacity: 1 }}
      transition={pivot
        ? { type: 'spring', stiffness: 240, damping: 15, delay: 0.15 }
        : { duration: 0.55, delay, ease: 'easeOut' }}
      className={`flex flex-col items-center justify-center rounded-lg bg-[#fffef8] shadow-chunky-sm ${pivot ? 'h-28 w-[76px] ring-4 ring-neon-gold shadow-glow-gold' : 'h-24 w-16'}`}
    >
      <span className={`font-display text-2xl font-black ${red ? 'text-red-600' : 'text-slate-900'}`}>{rank}</span>
      <span className={`text-xl leading-none ${red ? 'text-red-600' : 'text-slate-900'}`}>{suit}</span>
    </motion.div>
  );
}

export default function ClutchReplayModal({ moment, open, onClose }: {
  moment: ClutchMoment; open: boolean; onClose: () => void;
}) {
  const [runId, setRunId] = useState(0);
  const step = useReplayDirector(open, runId);
  const idx = stepIndex(step);
  const [shareState, setShareState] = useState<'idle' | 'rendering' | ShareOutcome>('idle');
  const videoRef = useRef<Blob | null>(null);

  // Pre-record the share video in the background while the user watches.
  useEffect(() => {
    if (!open) { videoRef.current = null; setShareState('idle'); return; }
    let cancelled = false;
    recordClutchVideo(moment).then(v => { if (!cancelled) videoRef.current = v; });
    return () => { cancelled = true; };
  }, [open, moment]);

  async function onShare() {
    if (shareState === 'rendering') return;
    setShareState('rendering');
    setShareState(await shareClutch(moment, videoRef.current));
  }

  const m = moment;
  const shareLabel =
    shareState === 'rendering' ? '⏳ RENDERING…'
    : shareState === 'shared' ? '✅ SHARED'
    : shareState === 'downloaded' ? '✅ SAVED + CAPTION COPIED'
    : shareState === 'copied' ? '✅ CAPTION COPIED'
    : '⬆ SHARE TO TIKTOK / REELS';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/85 backdrop-blur-md p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ scale: 0.85, y: 60 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="w-full max-w-[340px]"
          >
            {/* ── 9:16 REPLAY STAGE ─────────────────────────────── */}
            <motion.div
              className="relative aspect-[9/16] w-full overflow-hidden rounded-3xl border-2 border-white/15"
              style={{ background: 'linear-gradient(180deg, #0a0618, #1a1145 50%, #0a0618)' }}
              animate={step === 'pivot' ? { x: [0, -6, 7, -4, 3, 0] } : { x: 0 }}
              transition={{ duration: 0.45, delay: 0.5 }}
            >
              {/* neon streak backdrop */}
              <div className="absolute inset-0 opacity-15"
                style={{ background: 'repeating-linear-gradient(115deg, transparent 0 60px, #2ee6ff 60px 68px, transparent 68px 140px, #ff2e88 140px 148px)' }} />
              {/* pivot spotlight */}
              <AnimatePresence>
                {idx >= 3 && (
                  <motion.div
                    className="absolute inset-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{ background: 'radial-gradient(ellipse at 50% 42%, rgba(255,210,74,0.22) 0%, rgba(0,0,0,0.55) 65%)' }}
                  />
                )}
              </AnimatePresence>

              {/* header */}
              <div className="relative z-10 pt-4 text-center">
                <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
                  className="font-display text-sm font-black tracking-[0.2em] text-neon-gold">
                  ⚔ BACCARAT GLADIATOR
                </motion.div>
                <div className="mt-0.5 text-[0.55rem] tracking-[0.3em] text-white/45">{m.stage}</div>
                <motion.div
                  className="mx-auto mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2 py-0.5 text-[0.55rem] font-black tracking-widest"
                  animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
                >
                  ● INSTANT REPLAY
                </motion.div>
              </div>

              {/* hands */}
              <div className="relative z-10 mt-4 flex flex-col items-center gap-3">
                {(['player', 'banker'] as const).map(side => {
                  const hand = side === 'player' ? m.playerHand : m.bankerHand;
                  const beforeT = side === 'player' ? m.before.p : m.before.b;
                  const afterT = side === 'player' ? m.after.p : m.after.b;
                  return (
                    <div key={side} className="flex flex-col items-center gap-1">
                      <span className={`text-[0.55rem] font-bold tracking-[0.3em] ${side === 'player' ? 'text-blue-300' : 'text-red-300'}`}>
                        {side.toUpperCase()}
                        {idx >= 2 && (
                          <span className="ml-2 text-white/80">
                            {idx >= 4 ? afterT : beforeT}
                          </span>
                        )}
                      </span>
                      <div className="flex items-end gap-1.5">
                        {hand.map((c, i) => {
                          const isPivot = i === 2 && m.pivotHand === side;
                          return (
                            <ReplayCard
                              key={i} rank={c.rank} suit={c.suit}
                              delay={0.15 + i * 0.35} pivot={isPivot}
                              shown={isPivot ? idx >= 3 : idx >= 1}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* standoff caption */}
              <AnimatePresence>
                {step === 'standoff' && (
                  <motion.div
                    className="absolute inset-x-0 bottom-[26%] z-10 text-center font-display text-base font-black tracking-widest text-white/90"
                    initial={{ opacity: 0, scale: 1.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                  >
                    {m.sub}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* result slam */}
              <AnimatePresence>
                {idx >= 4 && (
                  <motion.div className="absolute inset-x-0 bottom-[10%] z-10 text-center">
                    <motion.div
                      initial={{ scale: 3, opacity: 0, rotate: -8 }}
                      animate={{ scale: 1, opacity: 1, rotate: -3 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 16 }}
                      className="font-display text-3xl font-black text-neon-gold"
                      style={{ textShadow: '0 0 24px #ffd24a, 0 0 70px #ff8a2a' }}
                    >
                      {m.headline}
                    </motion.div>
                    <motion.div
                      initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.35 }}
                      className="mt-1 font-display text-xl font-black text-neon-green"
                      style={{ textShadow: '0 0 18px #3dff8f' }}
                    >
                      +{m.payout.toLocaleString()} CHIPS
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* replay + close */}
              <div className="absolute right-2.5 top-2.5 z-20 flex gap-1.5">
                <button onClick={() => setRunId(r => r + 1)}
                  className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-xs text-white/70 hover:bg-white/20" title="Replay">↺</button>
                <button onClick={onClose}
                  className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-xs text-white/70 hover:bg-white/20" title="Close">✕</button>
              </div>
            </motion.div>

            {/* ── SHARE CTA ─────────────────────────────────────── */}
            <motion.button
              onClick={onShare}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
              animate={idx >= 4 && shareState === 'idle' ? { scale: [1, 1.05, 1] } : {}}
              transition={idx >= 4 && shareState === 'idle' ? { duration: 1.1, repeat: Infinity } : {}}
              className="btn-chunky mt-3 w-full bg-gradient-to-r from-neon-pink via-neon-violet to-neon-blue py-3.5 text-sm text-white shadow-glow-pink animate-pulse-glow"
            >
              {shareLabel}
            </motion.button>
            <div className="mt-1.5 text-center text-[0.6rem] text-white/40">
              records a 4.5s vertical clip · caption auto-copied
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Demo harness: a button that triggers the modal with the scripted comeback. */
export function ClutchDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.95 }}
        className="btn-chunky w-full bg-gradient-to-r from-neon-violet to-neon-pink py-3 text-sm text-white"
      >
        🎬 SIMULATE CLUTCH WIN
      </motion.button>
      <ClutchReplayModal moment={DEMO_CLUTCH} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
