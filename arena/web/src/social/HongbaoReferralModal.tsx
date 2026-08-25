// ═══════════════════════════════════════════════════════════════════
//  HONGBAO REFERRAL MODAL — 红包. The referral artifact is a red
//  envelope, not a bare link. Maps to Referral.hongbaoValue; codes
//  reuse the BuddyPass share-code plumbing (?hongbao= param).
//
//  The envelope is a 2.5D CSS build — four stacked layers inside a
//  perspective container:
//    back panel (z-0) → gold amount card (z-10, fully hidden behind
//    the pocket) → front pocket (z-20) → flap + wax seal (z-30/40).
//  Tap the seal: seal pops → flap swings up (rotateX, origin top) and
//  tears away → the amount card slides out of the pocket while a
//  shower of square-holed cash coins (铜钱) and sparks erupts.
//
//  Cultural notes (deliberate — don't "fix"):
//   · The envelope stays red/gold in EVERY locale. It's an artifact,
//     not an outcome indicator; the win/loss red↔green flip
//     (i18n/LocaleContext) applies to outcome UI only.
//   · Amounts are 8s, never 4s — i18n/lucky.ts + the DB CHECK.
//   · WeChat has no public web share intent; that button copies the
//     link and tells the user to paste. weixin:// deep links are
//     unreliable and blocked in iOS Safari — don't add one.
//   · WhatsApp/WeChat button greens are BRAND colors, exempt from
//     the outcome-color rule.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { LUCKY_AMOUNTS, formatChips, warnIfUnlucky } from '../i18n/lucky';

export interface HongbaoView {
  code: string;      // share code — same registry as BuddyPass codes
  value: number;     // chips inside (8s only, enforced up and down the stack)
  blessing?: string; // referrer's message, e.g. 恭喜发财
}

type Stage = 'sealed' | 'torn' | 'open';

const inviteUrl = (code: string) => `https://baccaratgladiator.com/?hongbao=${code}`;
const inviteText = (chips: string) =>
  `🧧 I'm sending you luck! Open my red envelope for ${chips} chips at Baccarat Gladiator — 恭喜发财!`;

// Envelope reds — richer and deeper than the loss/alarm red on purpose.
const RED = { deep: '#7a1016', mid: '#b3181f', bright: '#e02430' };

/** Round cash coin (铜钱) with the square hole — instantly reads as money-luck. */
const CashCoin = () => (
  <span
    className="grid h-4 w-4 place-items-center rounded-full border border-yellow-100/70 shadow-glow-gold"
    style={{ background: 'radial-gradient(circle at 35% 30%, #ffe9a3, #ffd24a 55%, #c9971d)' }}
  >
    <span className="h-1.5 w-1.5" style={{ background: '#a67511' }} />
  </span>
);

/** One-shot particle shower from the envelope mouth: rise, hang, rain down. */
function CoinBurst({ count = 24 }: { count?: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        dx: (Math.random() - 0.5) * 270,
        rise: -(70 + Math.random() * 130),
        fall: 240 + Math.random() * 90,
        rot: (Math.random() - 0.5) * 1080,
        dur: 1.05 + Math.random() * 0.55,
        delay: Math.random() * 0.25,
        spark: i % 3 === 2, // every third particle is a spark, not a coin
      })),
    [count],
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-24 z-40">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute -ml-2 -mt-2"
          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
          animate={{
            x: [0, p.dx * 0.6, p.dx],
            y: [0, p.rise, p.fall],
            rotate: p.rot,
            scale: [0, 1.15, 0.9],
            opacity: [1, 1, 0],
          }}
          transition={{ duration: p.dur, delay: p.delay, times: [0, 0.38, 1], ease: ['easeOut', 'easeIn'] }}
        >
          {p.spark ? <span className="text-base">✨</span> : <CashCoin />}
        </motion.span>
      ))}
    </div>
  );
}

export default function HongbaoReferralModal({
  open,
  onClose,
  onOpened,
  hongbao = { code: 'GLAD-7F3K', value: LUCKY_AMOUNTS.HONGBAO_DEFAULT, blessing: '恭喜发财' },
}: {
  open: boolean;
  onClose: () => void;
  /** Fires once when the envelope is torn — wire the ledger credit here
   *  (server-side: social-store.openHongbao, idemKey `hongbao:{id}`). */
  onOpened?: () => void;
  hongbao?: HongbaoView;
}) {
  const { isZh } = useLocale();
  const reduced = useReducedMotion();
  const [stage, setStage] = useState<Stage>('sealed');
  const [wechatLabel, setWechatLabel] = useState('WECHAT 微信');
  const chips = formatChips(hongbao.value);
  warnIfUnlucky(hongbao.value, 'HongbaoReferralModal');

  // Re-seal whenever the modal is re-opened so the ritual replays.
  useEffect(() => { if (open) setStage('sealed'); }, [open]);

  function tear() {
    if (stage !== 'sealed') return;
    if ('vibrate' in navigator) navigator.vibrate?.([12, 50, 20]); // paper-rip haptic
    setStage('torn');
    // Card + coins fire once the flap has swung clear of the mouth.
    setTimeout(() => setStage('open'), reduced ? 0 : 450);
    onOpened?.();
  }

  function onWhatsApp() {
    const msg = encodeURIComponent(`${inviteText(chips)}\n${inviteUrl(hongbao.code)}`);
    window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
  }

  async function onWeChat() {
    try {
      await navigator.clipboard.writeText(`${inviteText(chips)}\n${inviteUrl(hongbao.code)}`);
      setWechatLabel('✅ 已复制 · PASTE IN WECHAT');
      setTimeout(() => setWechatLabel('WECHAT 微信'), 2200);
    } catch { /* clipboard denied — leave label unchanged */ }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-abyss-900/75 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* Gold-glow border wrapper, same idiom as BuddyPassModal */}
          <motion.div
            onClick={e => e.stopPropagation()}
            initial={{ y: 90, rotate: 5, scale: 0.8, opacity: 0 }}
            animate={{ y: 0, rotate: 0, scale: 1, opacity: 1 }}
            exit={{ y: 60, scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="w-full max-w-sm rounded-3xl bg-gradient-to-br from-neon-gold via-[#e02430] to-[#7a1016] p-[2px] shadow-glow-gold animate-pulse-glow"
          >
            <div className="relative overflow-hidden rounded-[22px] bg-abyss-800 p-5 text-white">
              <button
                onClick={onClose}
                className="absolute right-3 top-3 z-50 grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/60 hover:bg-white/20"
                aria-label="Close"
              >
                ✕
              </button>

              {/* Header — zh-primary ordering when the locale is East */}
              <div className="mb-1 font-display text-xl font-black tracking-widest text-neon-gold">
                {isZh ? '🧧 送福给好友' : '🧧 SEND LUCK TO A FRIEND'}
              </div>
              <div className="mb-4 text-[0.72rem] tracking-wider text-white/55">
                {isZh ? 'Send Luck to a Friend · 红包referral' : 'Hongbao referral · 送福给好友'}
              </div>

              {/* ── THE ENVELOPE (2.5D stack) ─────────────────────── */}
              <div className="relative mx-auto mb-4 h-72 w-64" style={{ perspective: 900 }}>
                {/* Back panel */}
                <div
                  className="absolute inset-0 z-0 rounded-2xl"
                  style={{ background: `linear-gradient(180deg, ${RED.deep}, ${RED.mid})` }}
                />

                {/* Gold amount card — hidden in the pocket until the tear */}
                <motion.div
                  className="absolute inset-x-3 bottom-2 z-10 h-48 rounded-xl p-4 text-center"
                  style={{ background: 'linear-gradient(170deg, #fff3cf, #ffd24a 70%, #eab63b)' }}
                  animate={stage === 'open' ? { y: -120 } : { y: 0 }}
                  transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 210, damping: 20 }}
                >
                  <div className="text-[0.62rem] font-bold tracking-[0.25em]" style={{ color: RED.deep }}>
                    {isZh ? '好友红包' : 'LUCKY MONEY'}
                  </div>
                  <div className="font-display text-4xl font-black leading-tight" style={{ color: RED.bright }}>
                    {chips}
                  </div>
                  <div className="text-[0.68rem] font-bold tracking-[0.3em]" style={{ color: RED.deep }}>
                    CHIPS 筹码
                  </div>
                  <div className="mt-2 text-sm font-bold" style={{ color: RED.mid }}>
                    {hongbao.blessing ?? '恭喜发财'}
                  </div>
                  <div className="text-[0.6rem] italic" style={{ color: `${RED.deep}99` }}>
                    May fortune find you
                  </div>
                </motion.div>

                {/* Front pocket with an auspicious scallop-cloud pattern */}
                <div
                  className="absolute inset-x-0 bottom-0 top-20 z-20 rounded-b-2xl border-t border-yellow-200/25"
                  style={{
                    background: `linear-gradient(180deg, ${RED.bright}, ${RED.mid} 60%, ${RED.deep})`,
                    backgroundImage: `radial-gradient(circle at 50% 0, rgba(255,210,74,0.13) 0 6px, transparent 7px), linear-gradient(180deg, ${RED.bright}, ${RED.mid} 60%, ${RED.deep})`,
                    backgroundSize: '28px 22px, 100% 100%',
                  }}
                />

                {/* Flap — swings up on tear, then tears away entirely */}
                <motion.div
                  className="absolute inset-x-0 top-0 z-30 h-24"
                  style={{
                    transformOrigin: 'top center',
                    clipPath: 'polygon(0 0, 100% 0, 100% 45%, 50% 100%, 0 45%)',
                    background: `linear-gradient(180deg, ${RED.mid}, ${RED.deep})`,
                  }}
                  animate={
                    stage === 'sealed'
                      ? { rotateX: 0, y: 0, opacity: 1 }
                      : { rotateX: -150, y: [0, -4, -10], opacity: [1, 1, 0] }
                  }
                  transition={reduced ? { duration: 0 } : { duration: 0.55, times: [0, 0.6, 1], ease: 'easeInOut' }}
                />

                {/* Wax seal — the tap target. 福 = fortune. */}
                <AnimatePresence>
                  {stage === 'sealed' && (
                    <motion.button
                      onClick={tear}
                      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}
                      exit={{ scale: [1, 1.25, 0], rotate: 15, opacity: 0, transition: { duration: 0.3 } }}
                      className="absolute left-1/2 top-16 z-40 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full font-display text-2xl font-black shadow-glow-gold"
                      style={{
                        background: 'radial-gradient(circle at 35% 30%, #ffe9a3, #ffd24a 55%, #c9971d)',
                        color: RED.deep,
                      }}
                      aria-label={isZh ? '开红包' : 'Open the red envelope'}
                    >
                      福
                    </motion.button>
                  )}
                </AnimatePresence>

                {/* Gold rain — mounts once, only on the full-motion path */}
                {stage === 'open' && !reduced && <CoinBurst />}
              </div>

              {/* Under-envelope line: prompt → claim confirmation */}
              <div className="mb-3 text-center text-[0.72rem] tracking-wider text-white/60">
                {stage === 'sealed' ? (
                  isZh ? '点封口开红包 · Tap the seal to open' : 'Tap the seal to open · 点封口开红包'
                ) : (
                  <span className="font-display text-sm font-black text-neon-gold">
                    +{chips} CHIPS 🧧 {isZh ? '恭喜发财!' : 'GOOD FORTUNE!'}
                  </span>
                )}
              </div>

              {/* Dashed tear line above actions, matching the Buddy Pass */}
              <div className="my-3 border-t-2 border-dashed border-white/15" />

              {/* Quick-share row — brand greens, exempt from outcome tokens */}
              <div className="flex gap-2">
                <motion.button
                  onClick={onWhatsApp}
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                  className="btn-chunky flex-1 bg-[#25D366] py-2.5 text-sm text-abyss-900"
                >
                  WHATSAPP
                </motion.button>
                <motion.button
                  onClick={onWeChat}
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                  className="btn-chunky flex-1 bg-[#07C160] py-2.5 text-[0.78rem] text-abyss-900"
                >
                  {wechatLabel}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
