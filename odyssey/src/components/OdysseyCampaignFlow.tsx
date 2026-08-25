'use client';

/**
 * OdysseyCampaignFlow — the map → cutscene wiring for the Odyssey event.
 *
 * Renders OdysseyCampaignMap and, when a sailable port is tapped, opens
 * NarrativeCutsceneModal (intro mode) for that stage with a "SET SAIL" CTA.
 * Closing the cutscene returns to the map; the CTA hands the stage to the
 * host via onEnterTable — the host owns the actual table scene and, on
 * victory, saving progress (saveOdysseyProgress) before returning here.
 */

import { useCallback, useState } from 'react';
import { OdysseyCampaignMap } from './OdysseyCampaignMap';
import { NarrativeCutsceneModal } from './NarrativeCutsceneModal';
import { type OdysseyStage } from '../data/odysseyStoryData';

export interface OdysseyCampaignFlowProps {
  /** The "SET SAIL" CTA was pressed — host mounts the stage's table. */
  onEnterTable: (stage: OdysseyStage) => void;
  /** Optional "back to campaign select" affordance (forwarded to the map). */
  onExit?: () => void;
  /** Highest stage cleared (0–10). Omit to read the Odyssey save. */
  highestClearedStage?: number;
  /** Collected relic names. Omit to read the Odyssey save. */
  relics?: string[];
  /** Override the event deadline (forwarded to the map). */
  eventEndsAt?: string | number | Date;
}

export function OdysseyCampaignFlow({
  onEnterTable,
  onExit,
  highestClearedStage,
  relics,
  eventEndsAt,
}: OdysseyCampaignFlowProps) {
  const [pendingStage, setPendingStage] = useState<OdysseyStage | null>(null);

  const handleBegin = useCallback(() => {
    if (pendingStage) onEnterTable(pendingStage);
    setPendingStage(null);
  }, [pendingStage, onEnterTable]);

  const handleClose = useCallback(() => setPendingStage(null), []);

  return (
    <>
      <OdysseyCampaignMap
        highestClearedStage={highestClearedStage}
        relics={relics}
        eventEndsAt={eventEndsAt}
        onSelectStage={setPendingStage}
        onExit={onExit}
      />
      <NarrativeCutsceneModal
        stage={pendingStage}
        open={pendingStage !== null}
        mode="intro"
        ctaLabel="SET SAIL"
        onBegin={handleBegin}
        onClose={handleClose}
      />
    </>
  );
}
