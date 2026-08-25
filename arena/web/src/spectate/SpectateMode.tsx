// ═══════════════════════════════════════════════════════════════════
//  BET-BEHIND SPECTATOR MODE — Twitch-style bet-behind stream.
//  • Stream panel: high-roller avatar with pulsing LIVE ring, tier
//    badge, win-streak flames, viewer count — hype emojis float up
//    over it like Twitch bits
//  • Compact table view with staged card reveals + outcome flash
//  • Auto-scrolling reaction chat
//  • "RIDE WITH…" quick-bet bar racing the betting-window timer
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useSpectateSession } from './useSpectateSession';
import type { BattleCard } from '../battle/useBaccaratBattle';

const BET_SECONDS = 8;

function MiniCard({ card, revealed, index }: { card: BattleCard; revealed: boolean; index: number }) {
  const red = card.suit === '♥' || card.suit === '♦';
  return (
    <div style={{ perspective: 500 }}>
      <motion.div
        className="relative h-14 w-10 rounded-md"
        style={{ transformStyle: 'preserve-3d' }}
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1, rotateY: revealed ? 0 : 180 }}
        transition={{
          y: { type: 'spring', stiffness: 400, damping: 26, delay: index * 0.08 },
          rotateY: { duration: 0.45, ease: 'easeInOut' },
        }}
      >
        <div
          className="absolute inset-0 rounded-md border border-neon-gold/40"
          style={{
            backfaceVisibility: 'hidden', transform: 'rotateY(180deg)',
            background: 'repeating-linear-gradient(45deg, #241857 0 4px, #1a1145 4px 8px)',
          }}
        />
        <div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-md bg-[#fffef8]"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <span className={`font-display text-sm font-black leading-none ${red ? 'text-red-600' : 'text-slate-900'}`}>
            {card.rank}
          </span>
          <span className={`text-xs leading-none ${red ? 'text-red-600' : 'text-slate-900'}`}>{card.suit}</span>
        </div>
      </motion.div>
    </div>
  );
}

export default function SpectateMode() {
  const { state: s, ride, sendHype, HYPE_EMOJIS } = useSpectateSession();
  const chatRef = useRef<HTMLDivElement>(null);
  const hr = s.highRoller;

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.chat]);

  const outcomeColor =
    s.result?.outcome === 'player' ? '#5588ff' : s.result?.outcome === 'banker' ? '#ff5555' : '#3dff8f';

  return (
    <div className="glass w-full max-w-md overflow-hidden p-0 text-white">
      {/* ── STREAM PANEL ─────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden p-4 pb-3"
        style={{ background: 'linear-gradient(160deg, rgba(46,230,255,0.10), rgba(255,46,136,0.08) 60%, transparent)' }}
      >
        {/* floating hype emojis */}
        <AnimatePresence>
          {s.hype.map(h => (
            <motion.span
              key={h.id}
              className="pointer-events-none absolute bottom-0 z-10 text-2xl"
              style={{ left: `${h.x}%` }}
              initial={{ y: 10, opacity: 0, scale: 0.6 }}
              animate={{ y: -120, opacity: [0, 1, 1, 0], scale: 1.2, x: [0, 8, -8, 4, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2, ease: 'easeOut' }}
            >
              {h.emoji}
            </motion.span>
          ))}
        </AnimatePresence>

        <div className="flex items-center gap-3">
          {/* avatar + pulsing live ring */}
          <div className="relative">
            <motion.div
              className="absolute -inset-1 rounded-full"
              style={{ border: '2px solid #ff2e88' }}
              animate={{ scale: [1, 1.12, 1], opacity: [0.9, 0.3, 0.9] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
            <div
              className="grid h-14 w-14 place-items-center rounded-full border-2 border-white/30 font-display text-xl font-black"
              style={{ background: `radial-gradient(circle at 32% 30%, hsl(${hr.hue} 90% 60%), hsl(${hr.hue} 85% 28%))` }}
            >
              {hr.name[0]}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-display font-black text-white">{hr.name}</span>
              <span className="rounded-full bg-neon-gold/20 border border-neon-gold/50 px-2 py-0.5 text-[0.58rem] font-bold tracking-widest text-neon-gold">
                TIER {hr.tier}
              </span>
            </div>
            <div className="text-[0.68rem] text-white/50">
              {hr.stage} · {hr.streak >= 2 && <span className="text-neon-gold">🔥×{hr.streak} streak · </span>}
              high-stakes table
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-0.5 text-[0.6rem] font-black tracking-widest">
              <span className="h-1.5 w-1.5 animate-live-dot rounded-full bg-white" /> LIVE
            </span>
            <span className="text-[0.65rem] text-white/50">👁 {s.viewers}</span>
          </div>
        </div>

        {/* HR bet chip */}
        <AnimatePresence>
          {s.hrBet && (
            <motion.div
              key={`${s.round}-bet`}
              initial={{ y: 14, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-neon-gold/50 bg-black/50 px-3 py-1 text-[0.72rem] font-bold"
            >
              💰 ${s.hrBet.amount.toLocaleString()} on{' '}
              <span style={{ color: s.hrBet.side === 'banker' ? '#ff5555' : s.hrBet.side === 'player' ? '#5588ff' : '#3dff8f' }}>
                {s.hrBet.side.toUpperCase()}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── TABLE VIEW ───────────────────────────────────────────── */}
      <div className="relative border-y border-white/10 bg-black/30 px-4 py-3">
        <div className="flex items-center justify-around">
          {(['player', 'banker'] as const).map(sideKey => {
            const hand = sideKey === 'player' ? s.playerHand : s.bankerHand;
            const shown = sideKey === 'player' ? s.revealed.player : s.revealed.banker;
            return (
              <div key={sideKey} className="flex flex-col items-center gap-1">
                <span className={`text-[0.6rem] font-bold tracking-[0.25em] ${sideKey === 'player' ? 'text-blue-300' : 'text-red-300'}`}>
                  {sideKey.toUpperCase()}
                </span>
                <div className="flex min-h-14 gap-1">
                  {hand.map((c, i) => (
                    <MiniCard key={`${s.round}-${sideKey}-${i}`} card={c} revealed={i < shown} index={i} />
                  ))}
                  {hand.length === 0 && <div className="h-14 w-10 rounded-md border border-dashed border-white/10" />}
                </div>
              </div>
            );
          })}
        </div>
        {/* outcome flash */}
        <AnimatePresence>
          {s.phase === 'settled' && s.result && (
            <motion.div
              key={s.result.ts}
              className="pointer-events-none absolute inset-0 grid place-items-center"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <motion.span
                className="rounded-xl border-2 bg-black/70 px-4 py-1.5 font-display text-lg font-black tracking-widest"
                style={{ color: outcomeColor, borderColor: outcomeColor, textShadow: `0 0 18px ${outcomeColor}` }}
                initial={{ scale: 2.4, rotate: -6 }} animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 18 }}
              >
                {s.result.outcome === 'tie' ? 'ÉGALITÉ' : `${s.result.outcome.toUpperCase()} WINS`}
                {s.result.natural ? ' ⚔️' : ''} · {s.result.playerTotal}-{s.result.bankerTotal}
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── CHAT ─────────────────────────────────────────────────── */}
      <div ref={chatRef} className="h-36 overflow-y-auto px-4 py-2 text-[0.7rem] leading-relaxed [scrollbar-width:thin]">
        {s.chat.map(m => (
          <motion.div key={m.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
            {m.name === 'system'
              ? <span className="text-white/40 italic">{m.text}</span>
              : <>
                  <span className={`font-bold ${m.mine ? 'text-neon-pink' : ''}`} style={m.mine ? undefined : { color: `hsl(${m.hue} 80% 70%)` }}>
                    {m.name}:
                  </span>{' '}
                  <span className="text-white/80">{m.text}</span>
                </>}
          </motion.div>
        ))}
      </div>

      {/* ── HYPE BAR ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2">
        <span className="text-[0.58rem] tracking-widest text-white/40">HYPE</span>
        {HYPE_EMOJIS.map(e => (
          <motion.button
            key={e}
            onClick={() => sendHype(e)}
            whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.8, rotate: -12 }}
            className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-lg"
          >
            {e}
          </motion.button>
        ))}
        <div className="ml-auto text-right">
          <div className="text-[0.55rem] tracking-widest text-white/40">MY CHIPS</div>
          <div className="font-display text-sm font-black text-neon-gold tabular-nums">
            ${s.myBalance.toLocaleString()}
          </div>
        </div>
      </div>

      {/* ── RIDE BAR ─────────────────────────────────────────────── */}
      <div className="border-t border-white/10 p-3">
        {s.phase === 'betting' && s.hrBet && s.myRide === null && (
          <>
            <div className="mb-2 flex items-center justify-between text-[0.68rem]">
              <span className="font-display font-black tracking-wider text-neon-blue">
                🏇 RIDE WITH {hr.name.toUpperCase()}
              </span>
              <span className={`font-bold tabular-nums ${s.countdown <= 3 ? 'text-red-400' : 'text-white/50'}`}>
                {s.countdown}s
              </span>
            </div>
            {/* betting-window timer bar */}
            <div className="mb-2 h-2 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className={`h-full rounded-full ${s.countdown <= 3 ? 'bg-red-500' : 'bg-neon-blue'}`}
                animate={{ width: `${(s.countdown / BET_SECONDS) * 100}%` }}
                transition={{ type: 'tween', duration: 1, ease: 'linear' }}
              />
            </div>
            <div className="flex gap-2">
              {[100, 500, 1000].map(amt => (
                <motion.button
                  key={amt}
                  onClick={() => ride(amt)}
                  disabled={s.myBalance < amt}
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.93 }}
                  className={`btn-chunky flex-1 py-2 text-[0.72rem] ${
                    s.myBalance >= amt
                      ? 'bg-gradient-to-r from-neon-blue to-neon-violet text-white'
                      : 'cursor-not-allowed bg-white/10 text-white/30 shadow-none'
                  }`}
                >
                  RIDE ${amt >= 1000 ? '1K' : amt}
                </motion.button>
              ))}
            </div>
          </>
        )}

        {s.myRide !== null && s.phase !== 'settled' && s.hrBet && (
          <div className="rounded-xl border border-neon-blue/40 bg-neon-blue/10 px-3 py-2 text-center text-[0.75rem] font-bold text-neon-blue">
            🏇 Riding ${s.myRide.toLocaleString()} on {s.hrBet.side.toUpperCase()} with {hr.name} ✓
          </div>
        )}

        <AnimatePresence>
          {s.phase === 'settled' && s.lastPayout && (
            <motion.div
              key={s.lastPayout.ts}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className={`rounded-xl border px-3 py-2 text-center font-display text-sm font-black ${
                s.lastPayout.delta > 0
                  ? 'border-neon-green/50 bg-neon-green/10 text-neon-green'
                  : s.lastPayout.delta === 0
                    ? 'border-white/20 bg-white/5 text-white/60'
                    : 'border-red-500/40 bg-red-500/10 text-red-400'
              }`}
            >
              {s.lastPayout.delta > 0 ? `🎉 RIDE PAYS +$${s.lastPayout.delta.toLocaleString()}`
                : s.lastPayout.delta === 0 ? '🤝 PUSH — stake returned'
                : `💔 RIDE LOST −$${Math.abs(s.lastPayout.delta).toLocaleString()}`}
            </motion.div>
          )}
        </AnimatePresence>

        {s.phase !== 'betting' && s.myRide === null && !s.lastPayout && (
          <div className="py-1 text-center text-[0.68rem] text-white/35">
            Next betting window opens after this hand…
          </div>
        )}
      </div>
    </div>
  );
}
