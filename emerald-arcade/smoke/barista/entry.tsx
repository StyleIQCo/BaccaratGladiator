import { createRoot } from 'react-dom/client';
import { BaristaRushCanvas } from '../../src/minigames/barista/BaristaRushCanvas';
import type { BaristaStage, DrinkLogEntry } from '../../src/minigames/barista/useBaristaPhysics';

declare global {
  interface Window {
    __smoke: {
      hudTicks: number;
      lastHud: { timeLeft: number; score: number; combo: number } | null;
      stage: BaristaStage | null;
      stageAt: number; // performance.now() of the last transition
      stagesSeen: string[];
      over: null | { score: number; drinks: number; perfects: number; log: DrinkLogEntry[] };
    };
  }
}

window.__smoke = { hudTicks: 0, lastHud: null, stage: null, stageAt: 0, stagesSeen: [], over: null };

function App() {
  return (
    <div style={{ width: 390, height: 560 }}>
      <BaristaRushCanvas
        runSeconds={25}
        onHudTick={(timeLeft, score, combo) => {
          window.__smoke.hudTicks++;
          window.__smoke.lastHud = { timeLeft, score, combo };
        }}
        onStageChange={(stage) => {
          window.__smoke.stage = stage;
          window.__smoke.stageAt = performance.now();
          window.__smoke.stagesSeen.push(stage);
        }}
        onGameOver={(score, drinks, perfects, log) => {
          window.__smoke.over = { score, drinks, perfects, log };
        }}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
