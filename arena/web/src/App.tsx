// Arena root. KillSwitchGate wraps EVERYTHING — no socket connects until flags
// confirm the arena is enabled. Render path branches on the bandwidth-gated flag.
import { useMemo } from 'react';
import { KillSwitchGate } from './KillSwitchGate';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { useGameSync } from './hooks/useGameSync';
import { VideoTable } from './render/VideoTable';
import { CssTable } from './render/CssTable';

const WS_URL = window.location.origin; // /arena/ws on the same origin (CSP 'self')

function Arena() {
  const { useVideo } = useTheme();
  // A per-device client seed contributes to the pooled provably-fair seed.
  const clientSeed = useMemo(() => {
    const k = 'arena.clientSeed';
    let s = localStorage.getItem(k);
    if (!s) { s = crypto.randomUUID(); localStorage.setItem(k, s); }
    return s;
  }, []);

  const game = useGameSync(WS_URL, clientSeed);

  return (
    <div className="arena">
      <header>
        <span>{game.phase ?? '…'}</span>
        <span>{game.secondsLeft.toFixed(0)}s</span>
        <span className={game.crashed ? 'mult crashed' : 'mult'}>×{game.multiplier.toFixed(2)}</span>
        {game.verified != null && <span className={game.verified ? 'fair ok' : 'fair bad'}>
          {game.verified ? '✓ provably fair' : '✗ verify failed'}</span>}
      </header>

      {useVideo ? <VideoTable state={game.state} /> : <CssTable state={game.state} />}

      <footer>
        <button disabled={game.phase !== 'BETTING'} onClick={() => game.placeBet({ main: { side: 'player', amount: 100 } })}>Bet Player</button>
        <button disabled={game.phase !== 'BETTING'} onClick={() => game.placeBet({ crash: { amount: 100 } })}>Crash Bet</button>
        <button disabled={game.phase !== 'DEALING' || game.crashed} onClick={game.cashOut}>CASH OUT ×{game.multiplier.toFixed(2)}</button>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <KillSwitchGate>
      {() => (
        <ThemeProvider brand="default" stage="macau-dragon7">
          <Arena />
        </ThemeProvider>
      )}
    </KillSwitchGate>
  );
}
