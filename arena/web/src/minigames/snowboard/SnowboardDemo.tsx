// ═══════════════════════════════════════════════════════════════════
//  SNOQUALMIE NIGHT SHRED — Demo Hub tab wrapper.
//  Mock-driven like every hub tab: claimed chips land in localStorage,
//  no backend. When the arena wallet goes live, onClaim swaps to the
//  real grant call and the localStorage bookkeeping goes away.
//  Test hook: `?shredRun=<secs>` shortens the run so the touch smoke
//  can drive a full play→results→claim loop in seconds.
// ═══════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { SnowboardShredGame } from './SnowboardShredGame';

const BEST_KEY = 'arena.shred.best';
const TOTAL_KEY = 'arena.shred.chips';

export default function SnowboardDemo() {
  // Deep link (?game=shred) lands straight on the game intro — audio
  // still primes on the SHRED tap, so the iOS gesture rule holds.
  const [open, setOpen] = useState(
    () => new URLSearchParams(window.location.search).get('game') === 'shred',
  );
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY)) || 0);
  const [total, setTotal] = useState(() => Number(localStorage.getItem(TOTAL_KEY)) || 0);
  const runSeconds =
    Number(new URLSearchParams(window.location.search).get('shredRun')) || 45;

  return (
    <div className="glass mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
      <div className="text-5xl">🏂</div>
      <div className="font-display text-xl font-black tracking-widest text-neon-gold">
        SNOQUALMIE NIGHT SHRED
      </div>
      <p className="text-[0.75rem] leading-relaxed text-white/60">
        Night-session downhill under the neon — drag to carve, thread the
        slalom gates, boost off the kickers, and keep the combo alive to
        the lodge. Synthwave soundtrack, so sound on.
      </p>
      <div className="flex gap-8 text-[0.7rem] tracking-wider text-white/70">
        <div>
          BEST RUN
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

      <SnowboardShredGame
        open={open}
        onClose={() => setOpen(false)}
        runSeconds={runSeconds}
        onClaim={chips => {
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
