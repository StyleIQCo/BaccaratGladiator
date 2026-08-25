// ═══════════════════════════════════════════════════════════════════
//  DAILY RACE — standalone demo harness (dev/preview only).
//  A minimal chip wallet around the real <DailyRaceBonus/> so the race
//  can be played outside the arena shell. Demo affordance: the daily
//  localStorage lock is cleared on every launch so testers can replay —
//  the production mount must NOT do this.
// ═══════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import '../social/social.css';
import { DailyRaceBonus } from './DailyRaceBonus';
import { WIN_CHIPS } from './useJumbotronRace';

const DAILY_LOCK_KEY = 'bg:daily-race:last-claim';

function DemoShell() {
  const [chips, setChips] = useState(12_340);
  const [playing, setPlaying] = useState(false);
  const [lastPayout, setLastPayout] = useState<number | null>(null);

  const launch = () => {
    try { localStorage.removeItem(DAILY_LOCK_KEY); } catch { /* demo-only reset */ }
    setLastPayout(null);
    setPlaying(true);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-abyss-900 p-6 text-white">
      <header className="flex flex-col items-center gap-1">
        <h1 className="font-display text-3xl font-black tracking-widest text-neon-gold [text-shadow:0_0_24px_rgba(255,210,74,0.5)]">
          BACCARAT GLADIATOR
        </h1>
        <p className="text-[11px] tracking-[0.4em] text-white/50">DAILY JUMBOTRON RACE — DEMO</p>
      </header>

      <div className="glass flex items-center gap-3 px-6 py-3">
        <span className="text-2xl">🪙</span>
        <span className="font-display text-2xl font-black text-neon-gold">{chips.toLocaleString()}</span>
        <span className="text-xs text-white/50">CHIPS</span>
        {lastPayout !== null && (
          <motion.span
            key={chips}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-sm font-bold ${lastPayout >= WIN_CHIPS ? 'text-neon-green' : 'text-neon-blue'}`}
          >
            +{lastPayout.toLocaleString()}
          </motion.span>
        )}
      </div>

      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        onClick={launch}
        className="btn-chunky animate-pulse-glow bg-neon-gold px-10 py-4 text-xl text-abyss-900"
      >
        🏁 PLAY TODAY'S RACE
      </motion.button>

      <p className="max-w-xs text-center text-[10px] leading-relaxed text-white/35">
        Demo harness: the once-per-day lock resets every launch so you can replay.
        Sound on for the full jumbotron experience. 🔊
      </p>

      {playing && (
        <DailyRaceBonus
          onClaim={payout => { setChips(c => c + payout); setLastPayout(payout); }}
          onClose={() => setPlaying(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<DemoShell />);
