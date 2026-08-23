// ═══════════════════════════════════════════════════════════════════
//  DAILY MISSIONS — bento widget, 3 tasks/day.
//  Shapes mirror MissionProgress ⋈ MissionTemplate. The mocked hook
//  ticks the first mission upward so the moment a bar hits 100% —
//  and the Claim button unlocks and starts pulsing — is demo-visible.
//  Claiming pops a "+reward" flyup and settles the tile to ✓.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export interface MissionView {
  id: string;              // MissionProgress.id — what MISSION_CLAIM sends
  slug: string;
  title: string;
  icon: string;
  progress: number;
  target: number;
  rewardChips: number;
  rewardGems: number;
  claimed: boolean;
}

const SEED: MissionView[] = [
  { id: 'mp1', slug: 'play-10-hands',  title: 'Play 10 hands',       icon: '🃏', progress: 7, target: 10, rewardChips: 1500, rewardGems: 0, claimed: false },
  { id: 'mp2', slug: 'win-3-banker',   title: 'Win 3 Banker bets',   icon: '🏦', progress: 3, target: 3,  rewardChips: 2500, rewardGems: 0, claimed: false },
  { id: 'mp3', slug: 'streak-3',       title: 'Hit a 3-win streak',  icon: '🔥', progress: 1, target: 3,  rewardChips: 0,    rewardGems: 3, claimed: false },
];

/** Mocked live missions — swap the interval for MISSION_PROGRESS socket deltas. */
export function useDailyMissions() {
  const [missions, setMissions] = useState<MissionView[]>(SEED);

  useEffect(() => {
    // Demo: 'play-10-hands' ticks up every 4s until it completes,
    // so the unlock-pulse moment is observable without playing.
    const t = setInterval(() => {
      setMissions(ms => ms.map(m =>
        m.slug === 'play-10-hands' && m.progress < m.target
          ? { ...m, progress: m.progress + 1 }
          : m,
      ));
    }, 4_000);
    return () => clearInterval(t);
  }, []);

  function claim(id: string) {
    // Real impl: emit SocialClientEvent.MISSION_CLAIM and settle on the ack.
    setMissions(ms => ms.map(m => (m.id === id ? { ...m, claimed: true } : m)));
  }

  return { missions, claim };
}

const rewardLabel = (m: MissionView) =>
  [m.rewardChips ? `💰 ${m.rewardChips.toLocaleString()}` : '', m.rewardGems ? `💎 ${m.rewardGems}` : '']
    .filter(Boolean).join(' + ');

function MissionTile({ m, wide, onClaim }: { m: MissionView; wide: boolean; onClaim: (id: string) => void }) {
  const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
  const complete = m.progress >= m.target;
  const [justClaimed, setJustClaimed] = useState(false);

  function handleClaim() {
    if (!complete || m.claimed) return;
    setJustClaimed(true);
    onClaim(m.id);
    setTimeout(() => setJustClaimed(false), 1200);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        'relative rounded-2xl border p-3',
        wide ? 'col-span-2' : '',
        m.claimed
          ? 'border-white/10 bg-white/[0.02] opacity-60'
          : complete
            ? 'border-neon-gold/50 bg-neon-gold/[0.07]'
            : 'border-white/10 bg-white/[0.04]',
      ].join(' ')}
    >
      {/* "+1,500" flyup on claim */}
      <AnimatePresence>
        {justClaimed && (
          <motion.div
            initial={{ opacity: 0, y: 0, scale: 0.7 }}
            animate={{ opacity: 1, y: -28, scale: 1.1 }}
            exit={{ opacity: 0, y: -40 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            className="pointer-events-none absolute right-3 top-1 z-10 font-display font-black text-neon-green drop-shadow-[0_0_10px_rgba(61,255,143,0.9)]"
          >
            +{rewardLabel(m)}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mb-2 flex items-center gap-2">
        <span className="text-xl">{m.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.8rem] font-semibold text-white/90">{m.title}</div>
          <div className="text-[0.62rem] text-white/40">
            {m.progress}/{m.target} · {rewardLabel(m)}
          </div>
        </div>
        {m.claimed && <span className="text-neon-green">✓</span>}
      </div>

      {/* Thick rounded progress bar */}
      <div className="mb-2 h-3.5 overflow-hidden rounded-full border border-white/10 bg-black/40">
        <motion.div
          className={`h-full rounded-full ${
            complete
              ? 'bg-gradient-to-r from-neon-gold to-neon-green'
              : 'bg-gradient-to-r from-neon-blue to-neon-violet'
          }`}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>

      {/* Claim button: locked → unlocked+pulsing → claimed */}
      <motion.button
        onClick={handleClaim}
        disabled={!complete || m.claimed}
        whileTap={complete && !m.claimed ? { scale: 0.92 } : undefined}
        animate={complete && !m.claimed ? { scale: [1, 1.05, 1] } : { scale: 1 }}
        transition={complete && !m.claimed ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : undefined}
        className={[
          'btn-chunky w-full py-2 text-[0.72rem]',
          m.claimed
            ? 'cursor-default bg-white/5 text-white/30 shadow-none'
            : complete
              ? 'bg-gradient-to-r from-neon-gold to-neon-green text-abyss-900 animate-pulse-glow'
              : 'cursor-not-allowed bg-white/10 text-white/30 shadow-none',
        ].join(' ')}
      >
        {m.claimed ? 'CLAIMED ✓' : complete ? `CLAIM ${rewardLabel(m)}` : `🔒 ${pct}%`}
      </motion.button>
    </motion.div>
  );
}

export default function DailyMissions() {
  const { missions, claim } = useDailyMissions();
  const [resetIn, setResetIn] = useState('');

  useEffect(() => {
    const fmt = () => {
      const now = new Date();
      const midnightUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const mins = Math.max(0, Math.floor((midnightUTC - now.getTime()) / 60_000));
      setResetIn(`${Math.floor(mins / 60)}h ${mins % 60}m`);
    };
    fmt();
    const t = setInterval(fmt, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="glass w-full max-w-md p-4 text-white">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="font-display text-lg font-black tracking-wide text-neon-blue">
          DAILY MISSIONS
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[0.65rem] tracking-widest text-white/55">
          ⏳ resets in {resetIn}
        </div>
      </div>

      {/* Bento: first tile spans the full width, two below split it */}
      <div className="grid grid-cols-2 gap-2">
        {missions.map((m, i) => (
          <MissionTile key={m.id} m={m} wide={i === 0} onClaim={claim} />
        ))}
      </div>
    </div>
  );
}
