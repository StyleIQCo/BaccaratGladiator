/**
 * Smoke harness for the Madrona Wood Labyrinth cabinet — a minimal host
 * wired the way a real one would be: mount TiltLabyrinthGame, bank the
 * payout onClaim, land on a done view with the bank readout + a
 * relaunch. Driven by test-madrona-smoke.js at the repo root; not
 * shipped anywhere.
 *
 * runSeconds={40} is the smoke shortcut — the test drives the marble
 * via the ?madronaDebug sim handle, so it never sits through a real
 * 60-second clock, but the window must be roomy enough for the scripted
 * smash / bounce / goal beats plus a real-touch tilt check.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TiltLabyrinthGame } from '@arcade/minigames/madrona/TiltLabyrinthGame';
import './index.css';

function App() {
  const [view, setView] = useState<'game' | 'done'>('game');
  const [runKey, setRunKey] = useState(0);
  const [bank, setBank] = useState(0);

  return view === 'game' ? (
    <TiltLabyrinthGame
      key={runKey}
      open
      runSeconds={40}
      onClaim={(chips) => setBank((b) => b + chips)}
      onClose={() => setView('done')}
    />
  ) : (
    <div
      data-testid="madrona-done"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        color: '#ffe9d6',
        fontFamily: 'monospace',
      }}
    >
      <div data-testid="madrona-bank">bank:{bank}</div>
      <button
        type="button"
        data-testid="madrona-relaunch"
        onClick={() => {
          setRunKey((k) => k + 1);
          setView('game');
        }}
        style={{ padding: '12px 24px', fontFamily: 'monospace', fontSize: 14 }}
      >
        RELAUNCH
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
