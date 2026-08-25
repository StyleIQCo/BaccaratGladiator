// ═══════════════════════════════════════════════════════════════════
//  FISH TOSS — Demo Hub tab wrapper.
//  Mock-driven like every hub tab: the weekly board is a canned
//  snapshot held in state, and "Log the Catch" GT-merges the run into
//  it locally (exactly what Redis ZADD GT does server-side). When the
//  arena gateway hosts the demo, swap the canned snapshot for
//  useFishmonger's live one and this bookkeeping goes away.
//  Test hook: `?fishRun=<secs>` shortens the run so the touch smoke
//  can drive a full play→results→log loop in seconds.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useState } from 'react';
import type { FishTossEntry, FishTossSnapshotPayload } from '@bg/shared';
import { FishTossChallenge } from './FishTossChallenge';
import { FishmongerLeaderboard } from './FishmongerLeaderboard';

const BEST_KEY = 'arena.fishtoss.best';
const ME_ID = 'demo-me';
const PRIZES = [50_000, 25_000, 10_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000];

// The competition. Scores sit close enough that a good run visibly
// climbs the board — the whole point of the demo.
const RIVALS: Array<{ handle: string; score: number }> = [
  { handle: 'Salmon Slinger Sal', score: 4850 },
  { handle: 'Chinook Chuck', score: 4400 },
  { handle: 'Halibut Hank', score: 3950 },
  { handle: 'Crabby Colleen', score: 3600 },
  { handle: 'Two-Hands Tammy', score: 3250 },
  { handle: 'Dockside Dre', score: 2900 },
  { handle: 'Sockeye Sue', score: 2550 },
  { handle: 'Puget Pete', score: 2200 },
  { handle: 'Ferry Line Fiona', score: 1900 },
  { handle: 'Gullbait Gary', score: 1600 },
  { handle: 'Mudflat Marv', score: 1300 },
  { handle: 'Barnacle Barb', score: 1050 },
  { handle: 'Rain-Check Ray', score: 900 },
];

/** ISO week key, UTC — mirrors the server's weekKeyOf (persistence). */
function isoWeekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function nextMondayUtc(d = new Date()): number {
  const day = d.getUTCDay() || 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - day));
}

function buildSnapshot(myBest: number): FishTossSnapshotPayload {
  const all: FishTossEntry[] = [
    ...RIVALS.map(r => ({ userId: r.handle, handle: r.handle, avatarKey: 'gladiator-01', score: r.score, rank: 0 })),
    { userId: ME_ID, handle: 'You', avatarKey: 'gladiator-01', score: myBest, rank: 0 },
  ]
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);
  all.forEach((e, i) => { e.rank = i + 1; });
  return {
    v: 1,
    weekKey: isoWeekKey(),
    ts: Date.now(),
    endsAt: nextMondayUtc(),
    top: all.slice(0, 10),
    me: all.find(e => e.userId === ME_ID) ?? null,
    totalPlayers: all.length + 116, // the rest of the imaginary dock crowd
    prizes: PRIZES,
  };
}

export default function FishTossDemo() {
  const [open, setOpen] = useState(false);
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY)) || 0);
  const runSeconds =
    Number(new URLSearchParams(window.location.search).get('fishRun')) || 30;

  const snapshot = useMemo(() => buildSnapshot(best), [best]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4">
      <div className="glass flex w-full flex-col items-center gap-4 p-6 text-center">
        <div className="text-5xl">🐟</div>
        <div className="font-display text-xl font-black tracking-widest text-neon-gold">
          PIKE PLACE FISH TOSS
        </div>
        <p className="text-[0.75rem] leading-relaxed text-white/60">
          Weekly-arcade preview — the stall monger hurls salmon across the
          dock, you slide the catcher to snag them. Your best single run all
          week ranks on the Top Fishmonger board; Sunday night the top 10
          split the chip pot.
        </p>
        <div className="text-[0.7rem] tracking-wider text-white/70">
          WEEKLY BEST
          <div className="text-lg font-black text-white">{best.toLocaleString()}</div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="btn-chunky bg-gradient-to-r from-neon-gold to-neon-pink px-10 py-3 text-abyss-900"
        >
          ▶ PLAY
        </button>
      </div>

      <FishmongerLeaderboard meId={ME_ID} handle="You" demoSnapshot={snapshot} />

      <FishTossChallenge
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
