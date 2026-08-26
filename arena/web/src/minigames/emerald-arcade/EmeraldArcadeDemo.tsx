// ═══════════════════════════════════════════════════════════════════
//  EMERALD CITY ARCADE — Demo Hub tab wrapper.
//
//  Mounts the repo-root emerald-arcade module's SeattleArcadeHub as a
//  fullscreen overlay, and routes its onLaunchGame(id) to the three
//  cabinets this host wires:
//    · emerald-city-claw      → EmeraldClawGame   (modal contract)
//    · pike-st-barista-rush   → PikeBaristaGame   (modal contract)
//    · rainier-cherry-picker  → RainierCherryGame (fullscreen contract)
//
//  Every OTHER data-file entry is force-locked via the hub's `games`
//  prop override, regardless of its isUnlocked flag — an unlocked card
//  with no route here would be a dead INSERT COIN button. Wiring a new
//  cabinet = add its id to WIRED_IDS + one case in launch().
//
//  Mock-driven like every hub tab: daily tickets + claimed chips live
//  in localStorage, no backend. When the arena wallet goes live, bank()
//  swaps to the real grant call.
//
//  Test hooks: `?game=arcade` deep-links straight into the hub;
//  `?arcadeSeed=<n>` makes the claw machine deterministic;
//  `?cherryRun=<secs>` / `?baristaRun=<secs>` shorten those runs so
//  smokes can drive full loops in seconds. The claw's `?eadebug=1` sim
//  handle passes through untouched.
//
//  Tailwind note: the claw/barista wrappers are Tailwind-styled from
//  emerald-arcade/src — covered by the '../../emerald-arcade/src/**'
//  content glob in tailwind.config.js. The hub itself is inline-styled.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useMemo, useState } from 'react';
import { SeattleArcadeHub } from '../../../../../emerald-arcade/src/components/SeattleArcadeHub';
import { EmeraldClawGame } from '../../../../../emerald-arcade/src/minigames/claw/EmeraldClawGame';
import { PikeBaristaGame } from '../../../../../emerald-arcade/src/minigames/barista/PikeBaristaGame';
import { RainierCherryGame } from '../../../../../emerald-arcade/src/games/RainierCherryGame';
import {
  ARCADE_DAILY_TICKETS,
  EMERALD_ARCADE_GAMES,
} from '../../../../../emerald-arcade/src/data/emeraldArcadeData';

const TICKETS_KEY = 'arena.arcade.tickets'; // {"date":"YYYY-MM-DD","used":n}
const CHIPS_KEY = 'arena.arcade.chips';

/** The cabinets THIS host routes. Everything else renders locked. */
const WIRED_IDS = new Set(['emerald-city-claw', 'pike-st-barista-rush', 'rainier-cherry-picker']);

const today = () => new Date().toISOString().slice(0, 10);

function loadUsed(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(TICKETS_KEY) || 'null') as
      | { date: string; used: number }
      | null;
    return raw && raw.date === today() ? raw.used : 0;
  } catch {
    return 0;
  }
}

export default function EmeraldArcadeDemo() {
  const params = new URLSearchParams(window.location.search);
  // Shared deep link lands straight in the arcade (audio still primes on
  // in-game start taps, so the iOS gesture rule holds).
  const [hubOpen, setHubOpen] = useState(params.get('game') === 'arcade');
  const [clawOpen, setClawOpen] = useState(false);
  const [baristaOpen, setBaristaOpen] = useState(false);
  const [cherryOpen, setCherryOpen] = useState(false);
  const [used, setUsed] = useState(loadUsed);
  const [chips, setChips] = useState(() => Number(localStorage.getItem(CHIPS_KEY)) || 0);

  const clawSeed = Number(params.get('arcadeSeed')) || undefined;
  const cherryRun = Number(params.get('cherryRun')) || 60;
  const baristaRun = Number(params.get('baristaRun')) || 60;

  const tickets = Math.max(0, ARCADE_DAILY_TICKETS - used);

  // Force-lock every entry this host has no route for (see header).
  const games = useMemo(
    () => EMERALD_ARCADE_GAMES.map(g => ({ ...g, isUnlocked: g.isUnlocked && WIRED_IDS.has(g.id) })),
    [],
  );

  const spendTicket = useCallback(() => {
    setUsed(u => {
      const next = u + 1;
      localStorage.setItem(TICKETS_KEY, JSON.stringify({ date: today(), used: next }));
      return next;
    });
  }, []);

  const bank = useCallback((won: number) => {
    setChips(c => {
      const next = c + won;
      localStorage.setItem(CHIPS_KEY, String(next));
      return next;
    });
  }, []);

  // Ticket is spent at launch; closing a cabinet mid-run forfeits it —
  // same rule the cabinets themselves document.
  const launch = useCallback(
    (id: string) => {
      if (tickets <= 0) return; // hub gates this too
      switch (id) {
        case 'emerald-city-claw':
          spendTicket();
          setClawOpen(true);
          break;
        case 'pike-st-barista-rush':
          spendTicket();
          setBaristaOpen(true);
          break;
        case 'rainier-cherry-picker':
          spendTicket();
          setCherryOpen(true);
          break;
        default:
          // Unrouted id (locked in our override, but belt-and-suspenders).
          break;
      }
    },
    [tickets, spendTicket],
  );

  return (
    <div
      className="glass mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center"
      data-testid="arcade-demo-card"
    >
      <div className="text-5xl">🕹️</div>
      <div className="font-display text-xl font-black tracking-widest text-neon-gold">
        EMERALD CITY ARCADE
      </div>
      <p className="text-[0.75rem] leading-relaxed text-white/60">
        A rain-soaked Seattle arcade of daily chip faucets. Three cabinets are
        on the floor tonight: the <b>Emerald City Claw</b> (grip physics are
        real — heavy prizes slip), the <b>Rainier Cherry Picker</b>, and{' '}
        <b>Pike St. Barista Rush</b>. Three tickets a day; every chip you
        claim banks here.
      </p>
      <div className="flex gap-8 text-[0.7rem] tracking-wider text-white/70">
        <div data-testid="arcade-demo-tickets">
          TICKETS TODAY
          <div className="text-lg font-black text-white">
            {tickets}/{ARCADE_DAILY_TICKETS}
          </div>
        </div>
        <div data-testid="arcade-demo-chips">
          CHIPS CLAIMED
          <div className="text-lg font-black text-white">{chips.toLocaleString()}</div>
        </div>
      </div>
      <button
        onClick={() => setHubOpen(true)}
        data-testid="arcade-demo-enter"
        className="btn-chunky bg-gradient-to-r from-neon-gold to-neon-pink px-10 py-3 text-abyss-900"
      >
        ▶ ENTER THE ARCADE
      </button>

      {/* Fullscreen hub overlay; cabinets stack above it. */}
      {hubOpen && (
        <SeattleArcadeHub
          tickets={tickets}
          maxTickets={ARCADE_DAILY_TICKETS}
          games={games}
          onLaunchGame={launch}
          onExit={() => setHubOpen(false)}
        />
      )}

      {hubOpen && (
        <EmeraldClawGame
          open={clawOpen}
          seed={clawSeed}
          onClose={() => setClawOpen(false)}
          onClaim={bank}
        />
      )}

      {hubOpen && (
        <PikeBaristaGame
          open={baristaOpen}
          runSeconds={baristaRun}
          onClose={() => setBaristaOpen(false)}
          onClaim={bank}
        />
      )}

      {hubOpen && cherryOpen && (
        <RainierCherryGame
          durationSec={cherryRun}
          onComplete={({ chips: won }) => {
            bank(won);
            setCherryOpen(false);
          }}
          onExit={() => setCherryOpen(false)}
        />
      )}
    </div>
  );
}
