// ═══════════════════════════════════════════════════════════════════
//  DIGITAL PASSPORT — profile card for the world tour.
//  Tier/stage header, thick progress bar, a 10-tier stamp grid
//  (StageClear rows aggregate to these), and a pulsing Share CTA.
//  Cleared stamps pop in with a stagger and sit slightly rotated,
//  like real ink stamps; locked tiers are dashed ghosts.
// ═══════════════════════════════════════════════════════════════════
import { motion } from 'framer-motion';
import { useState } from 'react';
import { shareOrCopy } from './share';

interface TierStamp {
  tier: number;
  name: string;
  emoji: string;
  cleared: boolean;
  clearedAt?: string;
}

// World-tour tier roster (display copy — server truth is StageClear rows)
const TIERS: TierStamp[] = [
  { tier: 1,  name: 'Welcome Pit',   emoji: '🎰', cleared: true,  clearedAt: 'MAR 12' },
  { tier: 2,  name: 'Vegas Strip',   emoji: '🎲', cleared: true,  clearedAt: 'MAR 28' },
  { tier: 3,  name: 'Atlantic City', emoji: '🌊', cleared: true,  clearedAt: 'APR 15' },
  { tier: 4,  name: 'Monte Carlo',   emoji: '👑', cleared: false },
  { tier: 5,  name: 'Macau VIP',     emoji: '🐉', cleared: false },
  { tier: 6,  name: 'Singapore Sky', emoji: '🌆', cleared: false },
  { tier: 7,  name: 'Seoul Neon',    emoji: '🎤', cleared: false },
  { tier: 8,  name: 'Rio Carnival',  emoji: '🎭', cleared: false },
  { tier: 9,  name: 'Marrakech',     emoji: '🌙', cleared: false },
  { tier: 10, name: 'Grand Arena',   emoji: '⚔️', cleared: false },
];

// Deterministic "ink stamp" tilt per tier
const tilt = (tier: number) => ((tier * 37) % 7) - 3;

function Stamp({ stamp, index }: { stamp: TierStamp; index: number }) {
  return (
    <motion.div
      initial={{ scale: 0, rotate: -14, opacity: 0 }}
      animate={{ scale: 1, rotate: stamp.cleared ? tilt(stamp.tier) : 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 20, delay: index * 0.06 }}
      whileHover={stamp.cleared ? { scale: 1.1, rotate: 0, zIndex: 5 } : undefined}
      className={[
        'relative flex flex-col items-center justify-center gap-0.5 rounded-xl p-2 aspect-square text-center',
        stamp.cleared
          ? 'border-2 border-neon-gold/60 bg-gradient-to-br from-neon-gold/15 to-neon-pink/10 shadow-glow-gold'
          : 'border-2 border-dashed border-white/15 bg-white/[0.02] opacity-50 grayscale',
      ].join(' ')}
      title={stamp.cleared ? `Tier ${stamp.tier} · ${stamp.name} — stamped ${stamp.clearedAt}` : `Tier ${stamp.tier} · locked`}
    >
      <span className="text-xl leading-none">{stamp.cleared ? stamp.emoji : '🔒'}</span>
      <span className={`text-[0.52rem] font-bold tracking-wide ${stamp.cleared ? 'text-neon-gold' : 'text-white/40'}`}>
        {stamp.name.toUpperCase()}
      </span>
      {stamp.cleared && (
        <span className="text-[0.45rem] tracking-widest text-white/45">{stamp.clearedAt}</span>
      )}
    </motion.div>
  );
}

export default function DigitalPassport({
  handle = 'You',
  tier = 4,
  stageIndex = 22, // 0-based → "STAGE 23"
  totalStages = 62,
}: {
  handle?: string; tier?: number; stageIndex?: number; totalStages?: number;
}) {
  const [shareLabel, setShareLabel] = useState('SHARE PASSPORT ✈️');
  const cleared = TIERS.filter(t => t.cleared).length;
  const pct = Math.round(((stageIndex + 1) / totalStages) * 100);

  async function onShare() {
    const result = await shareOrCopy(
      `⚔️ My Gladiator Passport — Tier ${tier} · Stage ${stageIndex + 1}/${totalStages} · ${cleared}/10 tiers stamped. Think you can out-travel me?`,
      'https://baccaratgladiator.com',
    );
    if (result !== 'failed') {
      setShareLabel(result === 'shared' ? '✅ SHARED' : '✅ COPIED');
      setTimeout(() => setShareLabel('SHARE PASSPORT ✈️'), 1800);
    }
  }

  return (
    <div className="glass w-full max-w-md p-4 text-white">
      {/* Passport header */}
      <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full border-2 border-neon-gold/70 bg-gradient-to-br from-neon-violet to-abyss-700 font-display text-lg font-black shadow-glow-gold">
            {handle.slice(0, 1)}
          </div>
          <div>
            <div className="font-display text-base font-black tracking-wider text-neon-gold">
              GLADIATOR PASSPORT
            </div>
            <div className="text-[0.68rem] tracking-[0.2em] text-white/45">
              {handle.toUpperCase()} · Nº BG-{String(2_600 + tier * 62 + stageIndex).padStart(6, '0')}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-black text-neon-pink leading-none">T{tier}</div>
          <div className="text-[0.6rem] tracking-widest text-white/45">TIER</div>
        </div>
      </div>

      {/* World-tour progress — thick, rounded, animated fill */}
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-[0.68rem] tracking-widest text-white/55">
          <span>STAGE {stageIndex + 1} OF {totalStages}</span>
          <span className="text-neon-gold font-bold">{pct}%</span>
        </div>
        <div className="h-4 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-neon-blue via-neon-violet to-neon-pink"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1.1, ease: [0.22, 0.9, 0.3, 1] }}
          />
        </div>
      </div>

      {/* Stamp grid */}
      <div className="mb-4 grid grid-cols-5 gap-1.5">
        {TIERS.map((stamp, i) => (
          <Stamp key={stamp.tier} stamp={stamp} index={i} />
        ))}
      </div>

      {/* Pulsing share CTA */}
      <motion.button
        onClick={onShare}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        className="btn-chunky w-full bg-gradient-to-r from-neon-pink to-neon-violet py-3 text-sm text-white animate-pulse-glow"
      >
        {shareLabel}
      </motion.button>
    </div>
  );
}
