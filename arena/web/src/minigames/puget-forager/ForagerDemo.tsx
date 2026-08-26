// ═══════════════════════════════════════════════════════════════════
//  PUGET SOUND FORAGER — Demo Hub tab wrapper.
//  Mock-driven like every hub tab: claimed chips land in localStorage,
//  no backend. When the arena wallet goes live, onFinish swaps to the
//  real grant call and the localStorage bookkeeping goes away.
//  Test hooks: `?game=forager` deep-links straight to this tab with
//  the intro open; `?forageRun=<secs>` shortens the run so the touch
//  smoke can drive a full play→results→claim loop in seconds.
// ═══════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { PugetForagerGame } from './PugetForagerGame';
import { BOIL_BONUS } from './useForagerPhysics';

const BEST_KEY = 'arena.forager.best';
const TOTAL_KEY = 'arena.forager.chips';

export default function ForagerDemo() {
  // Shared deep link lands straight on the game intro — audio still
  // primes on the start-button tap, so the iOS gesture rule holds.
  const [open, setOpen] = useState(
    () => new URLSearchParams(window.location.search).get('game') === 'forager',
  );
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY)) || 0);
  const [total, setTotal] = useState(() => Number(localStorage.getItem(TOTAL_KEY)) || 0);
  const runSeconds =
    Number(new URLSearchParams(window.location.search).get('forageRun')) || 60;

  return (
    <div className="glass mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
      <div className="text-5xl">🦪</div>
      <div className="font-display text-xl font-black tracking-widest text-neon-gold">
        THE PUGET SOUND FORAGER
      </div>
      <p className="text-[0.75rem] leading-relaxed text-white/60">
        Emerald City Arcade preview — 60 seconds, three spots, one pot. Tap
        the mudflats for clams and the mighty geoduck, drop the crab pot off
        the dock, and reel a king salmon out of deep water. Fill the whole
        quota and the Ultimate Seafood Boil pays{' '}
        {BOIL_BONUS.toLocaleString()} chips.
      </p>
      <div className="flex gap-8 text-[0.7rem] tracking-wider text-white/70">
        <div>
          BEST HAUL
          <div className="text-lg font-black text-white">{best.toLocaleString()}</div>
        </div>
        <div>
          CHIPS CLAIMED
          <div className="text-lg font-black text-white">{total.toLocaleString()}</div>
        </div>
      </div>
      <button
        onClick={() => setOpen(true)}
        className="btn-chunky bg-gradient-to-r from-neon-gold to-neon-pink px-10 py-3 text-abyss-900"
      >
        ▶ PLAY
      </button>

      <PugetForagerGame
        open={open}
        onClose={() => setOpen(false)}
        runSeconds={runSeconds}
        onFinish={chips => {
          const b = Math.max(best, chips);
          const tot = total + chips;
          localStorage.setItem(BEST_KEY, String(b));
          localStorage.setItem(TOTAL_KEY, String(tot));
          setBest(b);
          setTotal(tot);
        }}
      />
    </div>
  );
}
