// ═══════════════════════════════════════════════════════════════════
//  LIVE TIER LEADERBOARD — the crucial one.
//  Framer Motion `layout` makes rows physically glide past each other
//  on every rank change; rank-ups flash a gold/green aura; top 3 get
//  glowing borders + bigger avatars; the current user is highlighted
//  and pinned to the bottom whenever they fall outside the top 10.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useSpring, useTransform } from 'framer-motion';
import { useEffect } from 'react';
import { useLiveLeaderboard, type LeaderboardRow } from './useLiveLeaderboard';

const TOP_N = 10;

// Deterministic neon hue per user for avatar discs
const hue = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

/** Odometer-style score: springs toward the live value instead of jumping. */
function AnimatedScore({ value, className }: { value: number; className?: string }) {
  const spring = useSpring(value, { stiffness: 90, damping: 20 });
  const text = useTransform(spring, v => Math.round(v).toLocaleString());
  useEffect(() => { spring.set(value); }, [value, spring]);
  return <motion.span className={className}>{text}</motion.span>;
}

const PODIUM: Record<number, { ring: string; glow: string; emblem: string }> = {
  1: { ring: 'border-neon-gold/80',  glow: 'shadow-glow-gold', emblem: '👑' },
  2: { ring: 'border-neon-blue/70',  glow: 'shadow-glow-blue', emblem: '🥈' },
  3: { ring: 'border-neon-pink/70',  glow: 'shadow-glow-pink', emblem: '🥉' },
};

function Avatar({ row, size }: { row: LeaderboardRow; size: number }) {
  return (
    <div
      className="relative shrink-0 rounded-full border-2 border-white/25 font-display font-bold text-white grid place-items-center"
      style={{
        width: size, height: size, fontSize: size * 0.38,
        background: `radial-gradient(circle at 32% 30%, hsl(${hue(row.userId)} 90% 62%), hsl(${hue(row.userId)} 85% 30%))`,
      }}
    >
      {row.handle.slice(0, 1)}
      {row.bestStreak >= 7 && (
        <span className="absolute -bottom-1 -right-1 text-[0.6em]" title={`Best streak ×${row.bestStreak}`}>🔥</span>
      )}
    </div>
  );
}

function RankRow({ row, isMe }: { row: LeaderboardRow; isMe: boolean }) {
  const podium = PODIUM[row.rank];
  const avatarSize = podium ? 52 : 38;

  return (
    <motion.li
      layout                                   // ← THE theatric: rows glide, never jump
      key={row.userId}
      initial={{ opacity: 0, y: 24, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -40, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className={[
        'relative flex items-center gap-3 px-3 py-2.5 rounded-2xl border',
        podium ? `bg-white/[0.07] ${podium.ring} ${podium.glow}` : 'bg-white/[0.03] border-white/10',
        isMe ? 'ring-2 ring-neon-pink/70' : '',
      ].join(' ')}
    >
      {/* Rank-change aura: gold/green burst on rank-up, cool dim on rank-down */}
      <AnimatePresence>
        {row.flash === 'up' && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            initial={{ opacity: 0 }}
            animate={{
              opacity: [0, 1, 0],
              boxShadow: [
                '0 0 0 rgba(61,255,143,0)',
                '0 0 34px rgba(255,210,74,0.85), inset 0 0 22px rgba(61,255,143,0.45)',
                '0 0 0 rgba(61,255,143,0)',
              ],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.3, times: [0, 0.25, 1] }}
          />
        )}
        {row.flash === 'down' && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-2xl bg-abyss-900/40"
            initial={{ opacity: 0 }} animate={{ opacity: [0, 0.6, 0] }} exit={{ opacity: 0 }}
            transition={{ duration: 1.1 }}
          />
        )}
      </AnimatePresence>

      {/* Rank number — pops on every change */}
      <motion.div
        key={row.rank}
        initial={{ scale: 1.6, color: row.flash === 'up' ? '#3dff8f' : '#ffffff' }}
        animate={{ scale: 1, color: podium ? '#ffd24a' : '#ffffff' }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
        className="w-8 text-center font-display font-black text-lg"
      >
        {podium?.emblem ?? row.rank}
      </motion.div>

      <Avatar row={row} size={avatarSize} />

      <div className="min-w-0 flex-1">
        <div className={`truncate font-semibold ${isMe ? 'text-neon-pink' : 'text-white/90'}`}>
          {row.handle} {isMe && <span className="text-[0.65rem] tracking-widest text-neon-pink/80">YOU</span>}
        </div>
        <div className="text-[0.68rem] text-white/40">best streak ×{row.bestStreak}</div>
      </div>

      {/* "+2,450" celebration pop riding above the score */}
      <div className="relative text-right">
        <AnimatePresence>
          {row.flash === 'up' && row.lastDelta > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.7 }}
              animate={{ opacity: 1, y: -16, scale: 1.05 }}
              exit={{ opacity: 0, y: -26 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
              className="absolute -top-3 right-0 font-display font-bold text-neon-green text-sm drop-shadow-[0_0_8px_rgba(61,255,143,0.8)]"
            >
              +{row.lastDelta.toLocaleString()}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatedScore
          value={row.score}
          className="font-display font-bold text-neon-gold tabular-nums"
        />
      </div>
    </motion.li>
  );
}

export default function LiveLeaderboard({
  seasonKey = '2026-08',
  tier = 4,
  meId = 'me',
  meHandle = 'You',
}: {
  seasonKey?: string; tier?: number; meId?: string; meHandle?: string;
}) {
  const { rows, me, totalPlayers, connected } = useLiveLeaderboard({ seasonKey, tier, meId, meHandle });
  const top = rows.slice(0, TOP_N);
  const mePinned = me && me.rank > TOP_N;

  return (
    <div className="glass w-full max-w-md p-4 text-white">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between px-1">
        <div>
          <div className="font-display text-lg font-black tracking-wide text-neon-gold">
            TIER {tier} ARENA
          </div>
          <div className="text-[0.7rem] text-white/45">
            Season {seasonKey} · {totalPlayers.toLocaleString()} gladiators
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-3 py-1 text-[0.68rem] tracking-widest">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-neon-green animate-live-dot' : 'bg-white/30'}`} />
          LIVE
        </div>
      </div>

      {/* Rows — popLayout keeps exits from blocking the glide */}
      <ul className="flex flex-col gap-1.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {top.map(row => (
            <RankRow key={row.userId} row={row} isMe={row.userId === meId} />
          ))}
        </AnimatePresence>
      </ul>

      {/* Current user pinned below the fold when outside the top 10 */}
      {mePinned && me && (
        <>
          <div className="my-1.5 text-center text-white/25 tracking-[0.5em] text-xs">···</div>
          <ul>
            <AnimatePresence mode="popLayout" initial={false}>
              <RankRow key={me.userId} row={me} isMe />
            </AnimatePresence>
          </ul>
          <div className="mt-1 text-center text-[0.68rem] text-white/40">
            #{me.rank} of {totalPlayers.toLocaleString()} — {(
              top[TOP_N - 1].score - me.score
            ).toLocaleString()} chips to crack the top {TOP_N}
          </div>
        </>
      )}
    </div>
  );
}
