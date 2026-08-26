/**
 * Smoke harness for the emerald-arcade module — a minimal host wired the
 * way a real host would be: SeattleArcadeHub → ticket spend on launch →
 * RainierCherryGame (short run) → collect → back to the hub with chips
 * banked. Driven by test-emerald-arcade-smoke.js at the repo root; not
 * shipped anywhere.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SeattleArcadeHub } from '@arcade/components/SeattleArcadeHub';
import { RainierCherryGame } from '@arcade/games/RainierCherryGame';
import { ARCADE_DAILY_TICKETS, EMERALD_ARCADE_GAMES } from '@arcade/data/emeraldArcadeData';

// The smoke derives its expected card/lock counts from the config module,
// so adding a game to emeraldArcadeData.ts never breaks the gate.
(window as unknown as { __EA_GAMES?: typeof EMERALD_ARCADE_GAMES }).__EA_GAMES =
  EMERALD_ARCADE_GAMES;

function App() {
  const [view, setView] = useState<'hub' | 'cherry'>('hub');
  const [tickets, setTickets] = useState(ARCADE_DAILY_TICKETS);
  const [bank, setBank] = useState(0);

  return view === 'hub' ? (
    <>
      <SeattleArcadeHub
        tickets={tickets}
        onLaunchGame={(id) => {
          if (id !== 'rainier-cherry-picker') return;
          setTickets((t) => Math.max(0, t - 1));
          setView('cherry');
        }}
      />
      <div
        data-testid="chip-bank"
        style={{
          position: 'fixed',
          bottom: 4,
          left: 8,
          zIndex: 40,
          color: '#ffd75e',
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      >
        bank:{bank}
      </div>
    </>
  ) : (
    <RainierCherryGame
      // Smoke shortcut: an 8-second run so the suite doesn't sit through
      // the real 60-second clock.
      durationSec={8}
      onComplete={({ chips }) => {
        setBank((b) => b + chips);
        setView('hub');
      }}
      onExit={() => setView('hub')}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
