// ═══════════════════════════════════════════════════════════════════
//  RAINIER SUMMIT SCRAMBLE — Demo Hub tab wrapper.
//  Mock-driven like every hub tab: best score lives in localStorage
//  and "Claim Chips" GT-merges the run into it locally (only a higher
//  run counts — exactly what the server enforces with ZADD GT). When
//  the arena gateway hosts the demo, swap this bookkeeping for the
//  live submit.
//  Test hook: `?rainierRun=<secs>` shortens the summit clock so the
//  touch smoke can drive a full play→results→claim loop in seconds.
// ═══════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { RainierSummitGame } from './RainierSummitGame';

const BEST_KEY = 'arena.rainier.best';

export default function RainierDemo() {
  const [open, setOpen] = useState(false);
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY)) || 0);
  const runSeconds =
    Number(new URLSearchParams(window.location.search).get('rainierRun')) || 30;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4">
      <div className="glass flex w-full flex-col items-center gap-4 p-6 text-center">
        <div className="text-5xl">🐐</div>
        <div className="font-display text-xl font-black tracking-widest text-neon-gold">
          RAINIER SUMMIT SCRAMBLE
        </div>
        <p className="text-[0.75rem] leading-relaxed text-white/60">
          Emerald City Arcade preview — an alpine goat bounces up an
          ever-scrolling Mount Rainier. Drag to steer between icy ledges,
          dodge the falling seracs, snag golden carabiners, and survive
          the clock to bank the summit bonus.
        </p>
        <div className="text-[0.7rem] tracking-wider text-white/70">
          BEST EXPEDITION
          <div className="text-lg font-black text-white">{best.toLocaleString()}</div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="btn-chunky bg-gradient-to-r from-neon-gold to-neon-pink px-10 py-3 text-abyss-900"
        >
          ▶ PLAY
        </button>
      </div>

      <RainierSummitGame
        open={open}
        onClose={() => setOpen(false)}
        runSeconds={runSeconds}
        onSubmitScore={score => {
          // Local GT-merge — same "only a higher run counts" rule the
          // server enforces with ZADD GT.
          if (score > best) {
            localStorage.setItem(BEST_KEY, String(score));
            setBest(score);
          }
        }}
      />
    </div>
  );
}
