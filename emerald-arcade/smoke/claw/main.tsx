/**
 * Smoke harness for the Emerald City Claw cabinet — mounts the REAL
 * EmeraldClawGame wrapper (which mounts the real ClawMachineCanvas →
 * useClawPhysics → useArcadeEngine), seeded for a deterministic pile.
 * Driven by run.js in this directory; ships nowhere.
 */
import { createRoot } from 'react-dom/client';
import { EmeraldClawGame } from '@arcade/minigames/claw/EmeraldClawGame';
import './index.css';

declare global {
  interface Window {
    __smoke: {
      claimed: number | null;
      closed: boolean;
    };
  }
}

window.__smoke = { claimed: null, closed: false };

createRoot(document.getElementById('root')!).render(
  <EmeraldClawGame
    open
    seed={7}
    onClaim={(chips) => {
      window.__smoke.claimed = chips;
    }}
    onClose={() => {
      window.__smoke.closed = true;
    }}
  />,
);
