// ═══════════════════════════════════════════════════════════════════
//  WHALE WATCH — Demo Hub tab wrapper.
//  Mock-driven like every hub tab: best run is a localStorage GT-merge
//  (exactly what Redis ZADD GT does server-side). When the arena
//  gateway hosts a whale-watch board, swap this bookkeeping for the
//  live snapshot hook.
//  Test hook: `?whaleRun=<secs>` shortens the run so the touch smoke
//  can drive a full play→results→log loop in seconds.
// ═══════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { WhaleWatchGame } from './WhaleWatchGame';

const BEST_KEY = 'arena.whalewatch.best';

export default function WhaleWatchDemo() {
  const [open, setOpen] = useState(false);
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY)) || 0);
  const runSeconds =
    Number(new URLSearchParams(window.location.search).get('whaleRun')) || 45;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4">
      <div className="glass flex w-full flex-col items-center gap-4 p-6 text-center">
        <div className="text-5xl">🐋</div>
        <div className="font-display text-xl font-black tracking-widest text-neon-gold">
          SALISH SEA WHALE WATCH
        </div>
        <p className="text-[0.75rem] leading-relaxed text-white/60">
          Precision-timing preview — shadows rise out of the deep, breach,
          and hang at the apex for exactly one graded moment. Paddle under
          them, hold to raise your spotting ring, and release at the very
          top. Perfect releases pay double.
        </p>
        <div className="text-[0.7rem] tracking-wider text-white/70">
          BEST WATCH
          <div className="text-lg font-black text-white">{best.toLocaleString()}</div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="btn-chunky bg-gradient-to-r from-neon-gold to-neon-pink px-10 py-3 text-abyss-900"
        >
          ▶ PLAY
        </button>
      </div>

      <WhaleWatchGame
        open={open}
        onClose={() => setOpen(false)}
        runSeconds={runSeconds}
        onSubmitScore={score => {
          // Local GT-merge — only a higher run counts, same as the server rule.
          if (score > best) {
            localStorage.setItem(BEST_KEY, String(score));
            setBest(score);
          }
        }}
      />
    </div>
  );
}
