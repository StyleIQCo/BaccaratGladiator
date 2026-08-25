// ═══════════════════════════════════════════════════════════════════
//  HOTDOG DROP — Demo Hub tab wrapper.
//  Mock-driven like every hub tab: claimed chips land in localStorage,
//  no backend. When the arena wallet goes live, onClaim swaps to the
//  real grant call and the localStorage bookkeeping goes away.
//  Test hook: `?hotdogRun=<secs>` shortens the run so the touch smoke
//  can drive a full play→results→claim loop in seconds.
// ═══════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { DailyHotdogChallenge } from './DailyHotdogChallenge';
import { hotdogRank, recordScore } from './leaderboard';
import { shareHotdog } from './share';

const BEST_KEY = 'arena.hotdog.best';
const TOTAL_KEY = 'arena.hotdog.chips';

export default function HotdogDemo() {
  // Shared deep link (?game=hotdog) lands straight on the game intro —
  // audio still primes on the Drop In tap, so the iOS gesture rule holds.
  const [open, setOpen] = useState(
    () => new URLSearchParams(window.location.search).get('game') === 'hotdog',
  );
  const [copied, setCopied] = useState(false);
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY)) || 0);
  const [total, setTotal] = useState(() => Number(localStorage.getItem(TOTAL_KEY)) || 0);
  const runSeconds =
    Number(new URLSearchParams(window.location.search).get('hotdogRun')) || 30;

  return (
    <div className="glass mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
      <div className="text-5xl">🌭</div>
      <div className="font-display text-xl font-black tracking-widest text-neon-gold">
        HOTDOG PARACHUTE DROP
      </div>
      <p className="text-[0.75rem] leading-relaxed text-white/60">
        Daily-challenge preview — steer Gretchen's basket through a rain of
        hotdogs, pretzels and beer steins. Burnt dogs end the run. The oompah
        accordion celebrates every catch, so sound on.
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
      <div className="flex gap-2">
        <button
          onClick={() => setOpen(true)}
          className="btn-chunky bg-gradient-to-r from-neon-gold to-neon-pink px-10 py-3 text-abyss-900"
        >
          ▶ PLAY
        </button>
        <button
          onClick={async () => {
            if ((await shareHotdog()) === 'copied') {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          }}
          className="btn-chunky bg-white/[0.07] px-6 py-3 text-white/80"
        >
          {copied ? '✓ COPIED' : '📤 SHARE'}
        </button>
      </div>

      <DailyHotdogChallenge
        open={open}
        onClose={() => setOpen(false)}
        runSeconds={runSeconds}
        getRank={hotdogRank}
        onSignup={() => {
          // Account creation lives in the classic game (Cognito hosted UI
          // behind its CREATE ACCOUNT button) — send them there in a new
          // tab so the arena session (and their local rank) survives.
          window.open('/', '_blank');
        }}
        onClaim={chips => {
          recordScore(chips);
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
