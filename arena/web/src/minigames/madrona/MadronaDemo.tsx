// ═══════════════════════════════════════════════════════════════════
//  MADRONA WOOD LABYRINTH — Demo Hub tab wrapper.
//  Mounts the Emerald City Arcade cabinet from the repo-root
//  emerald-arcade/ module (same host contract as the Odyssey tab:
//  relative import + tailwind content glob covering the module's src).
//  Mock-driven like every hub tab: best score lives in localStorage
//  and "Claim" GT-merges the run into it locally (only a higher run
//  counts — exactly what the server enforces with ZADD GT). When the
//  arena gateway hosts the demo, swap this bookkeeping for the live
//  submit.
//  Test hook: `?madronaRun=<secs>` shortens the run clock so the touch
//  smoke can drive a full play→plaque→claim loop in seconds (the smoke
//  also rides `?madronaDebug`, the cabinet's own sim handle).
// ═══════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { TiltLabyrinthGame } from '../../../../../emerald-arcade/src/minigames/madrona/TiltLabyrinthGame';

const BEST_KEY = 'arena.madrona.best';

export default function MadronaDemo() {
  const [open, setOpen] = useState(false);
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY)) || 0);
  const runSeconds =
    Number(new URLSearchParams(window.location.search).get('madronaRun')) || 60;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4">
      <div className="glass flex w-full flex-col items-center gap-4 p-6 text-center">
        <div className="text-5xl">🪵</div>
        <div className="font-display text-xl font-black tracking-widest text-neon-gold">
          MADRONA WOOD LABYRINTH
        </div>
        <p className="text-[0.75rem] leading-relaxed text-white/60">
          Emerald City Arcade preview — tilt a hand-carved madrona maze
          board with your finger. Pick your marble in the inventory:
          glass flies but ricochets, iron crawls but crushes straight
          through the cracked barriers. Gems pay, knot-holes punish, and
          the emerald inlay ends the run with a time bonus.
        </p>
        <div className="text-[0.7rem] tracking-wider text-white/70">
          BEST RUN
          <div className="text-lg font-black text-white">{best.toLocaleString()}</div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="btn-chunky bg-gradient-to-r from-neon-gold to-neon-pink px-10 py-3 text-abyss-900"
        >
          ▶ PLAY
        </button>
      </div>

      <TiltLabyrinthGame
        open={open}
        onClose={() => setOpen(false)}
        runSeconds={runSeconds}
        onClaim={chips => {
          // Local GT-merge — same "only a higher run counts" rule the
          // server enforces with ZADD GT.
          if (chips > best) {
            localStorage.setItem(BEST_KEY, String(chips));
            setBest(chips);
          }
        }}
      />
    </div>
  );
}
