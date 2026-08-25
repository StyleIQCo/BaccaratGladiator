/**
 * Smoke harness for the Odyssey module — a minimal host wired the way a real
 * host would be: CampaignSelector → OdysseyCampaignFlow (map + cutscene) →
 * StageTransitionOverlay voyage → table + BigWinOverlay. Driven by
 * test-odyssey-smoke.js at the repo root; not shipped anywhere.
 */
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CampaignSelector } from '@odyssey/components/CampaignSelector';
import { OdysseyCampaignFlow } from '@odyssey/components/OdysseyCampaignFlow';
import {
  StageTransitionOverlay,
  type StageTransitionOverlayHandle,
} from '@odyssey/components/StageTransitionOverlay';
import { BigWinOverlay, type BigWinOverlayHandle } from '@odyssey/components/BigWinOverlay';
import { BossAtmosphere } from '@odyssey/components/BossAtmosphere';
import { ODYSSEY_STAGE_COUNT } from '@odyssey/data/odysseyStoryData';
import './index.css';

function App() {
  const [view, setView] = useState<'selector' | 'campaign' | 'table'>('selector');
  const voyageRef = useRef<StageTransitionOverlayHandle>(null);
  const bigWinRef = useRef<BigWinOverlayHandle>(null);

  return (
    <>
      {view === 'selector' && (
        <CampaignSelector
          onSelect={(c) => {
            if (c === 'ODYSSEY') setView('campaign');
          }}
        />
      )}
      {view === 'campaign' && (
        <OdysseyCampaignFlow
          highestClearedStage={0}
          relics={[]}
          onExit={() => setView('selector')}
          onEnterTable={(s) => {
            // Smoke shortcut: entering the table immediately "clears" the
            // stage and sails on, so one pass exercises the whole loop.
            void voyageRef.current
              ?.play({
                fromStageId: s.id,
                toStageId: Math.min(s.id + 1, ODYSSEY_STAGE_COUNT),
              })
              .then(() => setView('table'));
          }}
        />
      )}
      {view === 'table' && (
        <div
          data-testid="table-scene"
          style={{ minHeight: '100vh', position: 'relative', color: '#fff' }}
        >
          <BossAtmosphere intensity={0.5} />
          <h1 style={{ position: 'relative', padding: '2rem' }}>TABLE SCENE</h1>
          <button
            type="button"
            data-testid="jackpot-btn"
            style={{ position: 'relative', padding: '1rem 2rem' }}
            onClick={() => bigWinRef.current?.triggerJackpot({ label: 'TROJAN HORSE' })}
          >
            JACKPOT
          </button>
        </div>
      )}

      <StageTransitionOverlay ref={voyageRef} />
      <BigWinOverlay ref={bigWinRef} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
