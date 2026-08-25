// ═══════════════════════════════════════════════════════════════════
//  RPG BOSS BATTLE MODE — Player vs. Stage Boss over a real shoe.
//  Theatrics inventory:
//   • Fighting-game HP bars: front bar snaps with a spring, a red
//     "ghost" layer drains behind it a beat later
//   • 3D card squeezes: rotateY flip with a pinch-and-peek dwell
//   • Card strike: the winning hand's key card flies into the loser's
//     avatar, impact particles radiate, floating damage number pops
//   • CRITICAL HIT (natural 8/9): full-screen flash, text slam,
//     heavy screen shake on the whole battle stage
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion } from 'framer-motion';
import { useBaccaratBattle, type BattleCard } from './useBaccaratBattle';
import { BOSSES, type BossConfig } from './bosses';

/* ── HP BAR — two layers: instant front + delayed ghost drain ────── */
function HealthBar({ hp, maxHp, color, mirror, label }: {
  hp: number; maxHp: number; color: string; mirror?: boolean; label: string;
}) {
  const pct = (hp / maxHp) * 100;
  return (
    <div className="flex-1">
      <div className={`mb-1 flex items-baseline gap-2 text-[0.68rem] tracking-widest ${mirror ? 'flex-row-reverse' : ''}`}>
        <span className="font-display font-black text-white/90">{label}</span>
        <span className="tabular-nums text-white/50">{hp}/{maxHp}</span>
      </div>
      <div className={`relative h-5 overflow-hidden rounded-full border border-white/15 bg-black/60 ${mirror ? 'scale-x-[-1]' : ''}`}>
        {/* ghost drain — trails the real bar so damage reads as a chunk */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-red-500/70"
          animate={{ width: `${pct}%` }}
          transition={{ type: 'tween', duration: 0.6, delay: 0.4, ease: 'easeOut' }}
        />
        {/* live bar — snaps on hit */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, ${color}cc)`, boxShadow: `0 0 12px ${color}88` }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
        {/* gloss */}
        <div className="absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-white/15" />
      </div>
    </div>
  );
}

/* ── CARD — 3D squeeze reveal ────────────────────────────────────── */
function SqueezeCard({ card, revealed, index }: { card: BattleCard; revealed: boolean; index: number }) {
  const red = card.suit === '♥' || card.suit === '♦';
  return (
    <div style={{ perspective: 700 }}>
      <motion.div
        className="relative h-24 w-16 rounded-lg"
        style={{ transformStyle: 'preserve-3d' }}
        initial={{ y: -60, opacity: 0, rotateY: 180 }}
        animate={{
          y: 0, opacity: 1,
          // squeeze: flip in, pinch at the edge, dwell (the peek), snap open
          rotateY: revealed ? [180, 96, 92, 96, 24, -8, 0] : 180,
        }}
        transition={{
          y: { type: 'spring', stiffness: 400, damping: 26, delay: index * 0.12 },
          opacity: { duration: 0.2, delay: index * 0.12 },
          rotateY: revealed
            ? { duration: 1.0, times: [0, 0.3, 0.45, 0.55, 0.8, 0.92, 1], ease: 'easeInOut' }
            : { duration: 0 },
        }}
      >
        {/* back */}
        <div
          className="absolute inset-0 rounded-lg border-2 border-neon-gold/40"
          style={{
            backfaceVisibility: 'hidden', transform: 'rotateY(180deg)',
            background: 'repeating-linear-gradient(45deg, #241857 0 6px, #1a1145 6px 12px)',
          }}
        />
        {/* face */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-[#fffef8] shadow-chunky-sm"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <span className={`font-display text-xl font-black ${red ? 'text-red-600' : 'text-slate-900'}`}>
            {card.rank}
          </span>
          <span className={`text-lg leading-none ${red ? 'text-red-600' : 'text-slate-900'}`}>{card.suit}</span>
        </div>
      </motion.div>
    </div>
  );
}

/* ── IMPACT PARTICLES — radial burst at the struck avatar ────────── */
function ImpactBurst({ color }: { color: string }) {
  return (
    <>
      {Array.from({ length: 10 }, (_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full"
            style={{ background: color, boxShadow: `0 0 8px ${color}` }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(angle) * (36 + (i % 3) * 14),
              y: Math.sin(angle) * (36 + (i % 3) * 14),
              opacity: 0, scale: 0.3,
            }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          />
        );
      })}
    </>
  );
}

/* ── AVATAR — shakes + flashes when struck ───────────────────────── */
function Avatar({ emoji, gradient, accent, struck, damage, big }: {
  emoji: string; gradient: string; accent: string;
  struck: boolean; damage: number; big?: boolean;
}) {
  const size = big ? 'h-20 w-20 text-4xl' : 'h-16 w-16 text-3xl';
  return (
    <div className="relative">
      <motion.div
        className={`grid place-items-center rounded-2xl border-2 ${size}`}
        style={{ background: gradient, borderColor: `${accent}88` }}
        animate={struck
          ? { x: [0, -7, 8, -5, 4, 0], filter: ['brightness(1)', 'brightness(2.4)', 'brightness(1)'] }
          : { x: 0, filter: 'brightness(1)' }}
        transition={{ duration: 0.5 }}
      >
        {emoji}
      </motion.div>
      <AnimatePresence>
        {struck && (
          <>
            <ImpactBurst color={accent} />
            <motion.div
              key="dmg"
              className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 font-display text-xl font-black"
              style={{ color: accent, textShadow: `0 0 12px ${accent}` }}
              initial={{ y: 0, opacity: 0, scale: 0.5 }}
              animate={{ y: -42, opacity: 1, scale: 1.15 }}
              exit={{ y: -60, opacity: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            >
              −{damage}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── MAIN ────────────────────────────────────────────────────────── */
export default function BossBattle({ boss = BOSSES.emperor }: { boss?: BossConfig }) {
  const { state, deal, reset, canDeal } = useBaccaratBattle({ bossName: boss.name, taunts: boss.taunts });
  const s = state;
  const striking = s.phase === 'striking';
  const r = s.lastResult;
  const bossStruck = striking && r?.winner === 'user';
  const userStruck = striking && r?.winner === 'boss';
  const crit = striking && !!r?.crit;
  const over = s.phase === 'victory' || s.phase === 'defeat';

  // The card that "flies" into the opponent: winner's highest-value card.
  const strikeCard = r && r.winner !== 'tie'
    ? [...(r.winner === 'user' ? s.userHand : s.bossHand)].sort((a, b) => b.value - a.value)[0]
    : null;

  return (
    <motion.div
      className="glass relative w-full max-w-md overflow-hidden p-4 text-white"
      // whole-stage screen shake — heavy on crit, light on any strike
      animate={striking
        ? crit
          ? { x: [0, -10, 12, -8, 9, -5, 3, 0], y: [0, 5, -6, 4, -3, 2, 0, 0] }
          : { x: [0, -4, 5, -3, 2, 0] }
        : { x: 0, y: 0 }}
      transition={{ duration: crit ? 0.6 : 0.35 }}
    >
      {/* header: HP bars + avatars */}
      <div className="mb-4 flex items-center gap-3">
        <Avatar emoji="🛡" gradient="radial-gradient(circle at 35% 30%, #1a3a6e 0%, #0e1c3d 60%, #060a16 100%)"
          accent="#2ee6ff" struck={!!userStruck} damage={r?.damage ?? 0} />
        <HealthBar hp={s.userHp} maxHp={s.maxHp} color="#2ee6ff" label="YOU" />
        <div className="px-1 font-display text-lg font-black text-white/40">VS</div>
        <HealthBar hp={s.bossHp} maxHp={s.maxHp} color={boss.accent} mirror label={boss.name.toUpperCase()} />
        <Avatar emoji={boss.emoji} gradient={boss.gradient} accent={boss.accent}
          struck={!!bossStruck} damage={r?.damage ?? 0} big />
      </div>

      <div className="mb-3 text-center text-[0.62rem] tracking-[0.3em] text-white/40">
        STAGE {boss.stage} · {boss.title.toUpperCase()} · ROUND {s.round}
      </div>

      {/* table: two hands */}
      <div className="mb-4 grid grid-cols-2 gap-4">
        {(['user', 'boss'] as const).map(side => {
          const hand = side === 'user' ? s.userHand : s.bossHand;
          const revealed = side === 'user' ? s.userRevealed : s.bossRevealed;
          const totalShown = side === 'user' ? r?.userTotal : r?.bossTotal;
          return (
            <div key={side} className="flex flex-col items-center gap-2">
              <div className="flex gap-1.5">
                {hand.map((c, i) => (
                  <SqueezeCard key={`${s.round}-${side}-${i}`} card={c} revealed={i < revealed} index={i} />
                ))}
                {hand.length === 0 && <div className="h-24 w-16 rounded-lg border-2 border-dashed border-white/10" />}
              </div>
              <AnimatePresence>
                {(s.phase === 'striking' || s.phase === 'settled' || over) && totalShown !== undefined && (
                  <motion.div
                    initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                    className="rounded-full border border-white/20 bg-black/50 px-3 py-0.5 font-display text-sm font-black"
                    style={{ color: side === 'user' ? '#2ee6ff' : boss.accent }}
                  >
                    {totalShown}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* flying strike card */}
      <AnimatePresence>
        {striking && strikeCard && r && r.winner !== 'tie' && (
          <motion.div
            key={r.ts}
            className="pointer-events-none absolute left-1/2 top-1/2 z-20 grid h-20 w-14 place-items-center rounded-lg bg-[#fffef8] font-display text-lg font-black shadow-chunky"
            style={{ color: strikeCard.suit === '♥' || strikeCard.suit === '♦' ? '#dc2626' : '#0f172a' }}
            initial={{ x: '-50%', y: '-20%', rotate: 0, scale: 0.9, opacity: 0 }}
            animate={{
              x: r.winner === 'user' ? 'calc(-50% + 150px)' : 'calc(-50% - 150px)',
              y: '-190%', rotate: r.winner === 'user' ? 30 : -30, scale: 0.55, opacity: [0, 1, 1, 0],
            }}
            transition={{ duration: 0.55, ease: [0.3, 0, 0.7, 0.4] }}
          >
            {strikeCard.rank}{strikeCard.suit}
          </motion.div>
        )}
      </AnimatePresence>

      {/* CRITICAL HIT overlay */}
      <AnimatePresence>
        {crit && (
          <motion.div
            key={`crit-${r?.ts}`}
            className="pointer-events-none absolute inset-0 z-30 grid place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, backgroundColor: ['rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            <motion.div
              className="font-display text-4xl font-black tracking-widest"
              style={{
                color: boss.accent,
                textShadow: `0 0 24px ${boss.accent}, 0 0 60px ${boss.accent2}`,
              }}
              initial={{ scale: 3.2, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: -4, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            >
              CRITICAL HIT!
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* victory / defeat */}
      <AnimatePresence>
        {over && (
          <motion.div
            className="absolute inset-0 z-40 grid place-items-center bg-abyss-900/85 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          >
            <div className="text-center">
              <motion.div
                className="mb-2 font-display text-4xl font-black"
                style={{ color: s.phase === 'victory' ? '#ffd24a' : '#ff2e88' }}
                initial={{ y: -60, scale: 0.5 }} animate={{ y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 16 }}
              >
                {s.phase === 'victory' ? '🏆 VICTORY' : '💀 DEFEATED'}
              </motion.div>
              <div className="mb-4 text-sm text-white/60">
                {s.phase === 'victory'
                  ? `${boss.name} falls in ${s.round} rounds. Stage ${boss.stage} cleared!`
                  : `${boss.name} holds the arena. Sharpen up and rematch.`}
              </div>
              <motion.button
                onClick={reset}
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.94 }}
                className="btn-chunky bg-gradient-to-r from-neon-gold to-neon-pink px-8 py-3 text-sm text-abyss-900"
              >
                ⚔️ REMATCH
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* battle log */}
      <div className="mb-3 h-16 overflow-hidden rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-[0.68rem] leading-relaxed">
        {s.log.map((line, i) => (
          <div key={`${s.round}-${i}`} className={i === 0 ? 'text-white/90' : 'text-white/35'}>{line}</div>
        ))}
      </div>

      {/* deal */}
      <motion.button
        onClick={deal}
        disabled={!canDeal}
        whileHover={canDeal ? { scale: 1.03 } : undefined}
        whileTap={canDeal ? { scale: 0.95 } : undefined}
        className={`btn-chunky w-full py-3 text-sm ${
          canDeal
            ? 'bg-gradient-to-r from-neon-blue to-neon-violet text-white animate-pulse-glow'
            : 'cursor-not-allowed bg-white/10 text-white/30 shadow-none'
        }`}
      >
        {canDeal ? '⚔️ DEAL & STRIKE' : '…'}
      </motion.button>
    </motion.div>
  );
}
