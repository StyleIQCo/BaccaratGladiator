'use client';

/**
 * OdysseyCampaignMap — the 10-node Mediterranean voyage hub.
 *
 * - BossAtmosphere (embers) burns behind the whole map.
 * - Aegean guitar BGM crossfades in on mount.
 * - The dotted route connects nodes in stage order; the traveled stretch is
 *   drawn solid gold. The player's ship bobs at the current node.
 * - Locked nodes clank and shake. Unlocked nodes slide (bosses unsheathe)
 *   and hand the stage to the parent — typically to open the
 *   NarrativeCutsceneModal.
 * - Progress defaults to loadOdysseyProgress() (the parallel Odyssey save);
 *   pass props to control it explicitly.
 *
 * Styling: Tailwind utility classes with arbitrary values only (no theme
 * extensions). The host's tailwind config must include
 * `odyssey/src/** /*.{ts,tsx}` in its content globs. Custom keyframes ship
 * in this component's own <style> tag. Dynamic values (node coordinates,
 * lock opacity) stay in inline style.
 */

import { useEffect, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { useAudioEngine } from '../hooks/useAudioEngine';
import { BossAtmosphere } from './BossAtmosphere';
import {
  loadOdysseyProgress,
  ODYSSEY_EVENT_ENDS_AT,
  ODYSSEY_STAGE_COUNT,
  ODYSSEY_STAGES,
  type OdysseyStage,
} from '../data/odysseyStoryData';

export interface OdysseyCampaignMapProps {
  /** Highest stage cleared (0–10). Omit to read the Odyssey save. */
  highestClearedStage?: number;
  /** Collected relic names. Omit to read the Odyssey save. */
  relics?: string[];
  onSelectStage: (stage: OdysseyStage) => void;
  onExit?: () => void;
  /** Override the event deadline (defaults to ODYSSEY_EVENT_ENDS_AT). */
  eventEndsAt?: string | number | Date;
}

type NodeStatus = 'cleared' | 'unlocked' | 'locked';

const GOLD = '#f5c542';
const GOLD_DIM = 'rgba(245, 197, 66, 0.45)';

const TOTAL_RELICS = ODYSSEY_STAGES.filter((s) => s.reward.relic).length;

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function OdysseyCampaignMap({
  highestClearedStage,
  relics,
  onSelectStage,
  onExit,
  eventEndsAt = ODYSSEY_EVENT_ENDS_AT,
}: OdysseyCampaignMapProps) {
  const audio = useAudioEngine();

  const [cleared, setCleared] = useState(highestClearedStage ?? 0);
  const [relicList, setRelicList] = useState<string[]>(relics ?? []);

  // Fill uncontrolled fields from the Odyssey save after mount (post-mount so
  // SSR markup and the first client render agree).
  useEffect(() => {
    if (highestClearedStage !== undefined) setCleared(highestClearedStage);
    if (relics !== undefined) setRelicList(relics);
    if (highestClearedStage === undefined || relics === undefined) {
      const saved = loadOdysseyProgress();
      if (highestClearedStage === undefined) setCleared(saved.highestClearedStage);
      if (relics === undefined) setRelicList(saved.relics);
    }
  }, [highestClearedStage, relics]);

  // Countdown starts null and fills in on mount (no hydration mismatch).
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  useEffect(() => {
    const deadline = new Date(eventEndsAt).getTime();
    const tick = () => setRemainingMs(deadline - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [eventEndsAt]);

  useEffect(() => {
    audio.playBGM('aegean_guitar', { crossfadeMs: 1800, volume: 0.85 });
    audio.preload({
      sfx: ['card_slide', 'metal_clank', 'stone_drag', 'sword_unsheathe'],
      bgm: ['mystic_chords', 'boss_drums', 'ocean_ambient'],
    });
  }, [audio]);

  const currentId = Math.min(cleared + 1, ODYSSEY_STAGE_COUNT);
  const statusOf = (stage: OdysseyStage): NodeStatus =>
    stage.id <= cleared ? 'cleared' : stage.id === currentId ? 'unlocked' : 'locked';

  const shipStage = ODYSSEY_STAGES[currentId - 1];
  const routePoints = ODYSSEY_STAGES.map(
    (s) => `${s.mapPosition.x},${s.mapPosition.y}`,
  ).join(' ');
  const traveledPoints = ODYSSEY_STAGES.slice(0, currentId)
    .map((s) => `${s.mapPosition.x},${s.mapPosition.y}`)
    .join(' ');

  return (
    <div
      data-testid="odyssey-campaign-map"
      className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#070d18] [background-image:radial-gradient(130%_80%_at_50%_0%,#14263c_0%,#0c1626_45%,#070d18_100%)] [font-family:Cinzel,Georgia,serif]"
    >
      <style>{KEYFRAMES}</style>
      <BossAtmosphere fixed={false} intensity={0.45} zIndex={1} />

      <header className="relative z-[3] flex items-center justify-between gap-3 px-5 py-4">
        {onExit ? (
          <button
            type="button"
            aria-label="Back to campaign select"
            data-testid="map-exit"
            onClick={() => {
              audio.playSFX('card_slide', { volume: 0.6 });
              onExit();
            }}
            className="h-10 w-10 cursor-pointer rounded-[10px] border border-[rgba(245,197,66,0.45)] bg-[rgba(245,197,66,0.06)] text-[1.1rem] text-[#f5c542]"
          >
            ←
          </button>
        ) : (
          <span className="w-10" />
        )}

        <div className="text-center">
          <h1 className="m-0 text-[clamp(1.2rem,5vw,1.8rem)] font-bold tracking-[0.28em] text-[#f2ead8] [text-shadow:0_2px_20px_rgba(245,197,66,0.3)]">
            THE ODYSSEY
          </h1>
          <p className="mx-0 mb-0 mt-1 text-[0.62rem] tracking-[0.3em] text-[rgba(245,197,66,0.55)]">
            Chart your course home, Gladiator
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <span
            data-testid="map-progress"
            className="whitespace-nowrap rounded-full border border-[rgba(245,197,66,0.45)] px-3 py-1 text-[0.66rem] tracking-[0.12em] text-[#ffe9a8]"
          >
            ⚔️ {cleared} / {ODYSSEY_STAGE_COUNT} · 🏺 {relicList.length} / {TOTAL_RELICS}
          </span>
          <span
            data-testid="map-countdown"
            className="whitespace-nowrap rounded-full border border-[rgba(86,180,233,0.4)] px-3 py-1 text-[0.6rem] tracking-[0.14em] text-[#bfe3ff]"
          >
            {remainingMs === null
              ? 'LIMITED TIME'
              : remainingMs <= 0
                ? 'EVENT ENDED'
                : `ENDS IN ${formatCountdown(remainingMs)}`}
          </span>
        </div>
      </header>

      <div className="relative z-[2] mx-3 mb-4 flex-1">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          <polyline
            points={routePoints}
            fill="none"
            stroke={GOLD_DIM}
            strokeWidth={0.35}
            strokeDasharray="1 1.6"
            strokeLinecap="round"
            opacity={0.55}
          />
          <polyline
            points={traveledPoints}
            fill="none"
            stroke={GOLD}
            strokeWidth={0.45}
            strokeLinecap="round"
            opacity={0.85}
          />
        </svg>

        {ODYSSEY_STAGES.map((stage) => (
          <MapNode
            key={stage.id}
            stage={stage}
            status={statusOf(stage)}
            onSelect={onSelectStage}
          />
        ))}

        {/* The player's ship, docked at the current node. */}
        <div
          aria-hidden
          data-testid="map-ship"
          className="pointer-events-none absolute z-[4] -translate-x-1/2 -translate-y-[135%]"
          style={{
            left: `${shipStage.mapPosition.x}%`,
            top: `${shipStage.mapPosition.y}%`,
          }}
        >
          <span className="inline-block text-[1.6rem] [animation:shipBob_1.8s_ease-in-out_infinite] [filter:sepia(1)_saturate(2.2)_hue-rotate(-12deg)_drop-shadow(0_4px_10px_rgba(0,0,0,0.7))]">
            ⛵
          </span>
        </div>
      </div>
    </div>
  );
}

interface MapNodeProps {
  stage: OdysseyStage;
  status: NodeStatus;
  onSelect: (stage: OdysseyStage) => void;
}

const NODE_CIRCLE_BASE = 'flex items-center justify-center rounded-full border-2 font-extrabold';

const NODE_CIRCLE_BY_STATUS: Record<NodeStatus, (boss: boolean) => string> = {
  cleared: () =>
    'border-[#f5c542] text-[#1a1408] [background:linear-gradient(180deg,#ffe9a8_0%,#f5c542_60%,#c9992d_100%)] shadow-[0_0_16px_rgba(245,197,66,0.35)]',
  unlocked: (boss) =>
    `bg-[rgba(14,20,32,0.85)] text-[#f5c542] ${
      boss
        ? 'border-[#e8703a] [animation:nodePulseBoss_2.2s_ease-out_infinite]'
        : 'border-[#f5c542] [animation:nodePulse_2.2s_ease-out_infinite]'
    }`,
  locked: () =>
    'border-[rgba(150,160,175,0.4)] bg-[rgba(14,20,32,0.85)] text-[0.8rem] text-[#e8edf5] opacity-70',
};

const NODE_LABEL_BY_STATUS: Record<NodeStatus, string> = {
  cleared: 'text-[rgba(245,197,66,0.75)]',
  unlocked: 'text-[#f5c542]',
  locked: 'text-[rgba(207,216,227,0.45)]',
};

function MapNode({ stage, status, onSelect }: MapNodeProps) {
  const audio = useAudioEngine();
  const shakeControls = useAnimationControls();
  const locked = status === 'locked';
  const boss = stage.isBossStage;
  // Edge ports (x ≤10 / ≥90 — coords shared with the ship anchor, so the
  // data can't move) get their labels nudged inboard so long titles never
  // clip on narrow screens.
  const labelShift = stage.mapPosition.x <= 10 ? 22 : stage.mapPosition.x >= 90 ? -24 : 0;
  const labelNudge = labelShift ? { transform: `translateX(${labelShift}px)` } : undefined;

  const handleHover = () => {
    if (locked) return;
    audio.playSFX('card_slide', { volume: 0.4, throttleMs: 150 });
  };

  const handleClick = () => {
    if (locked) {
      audio.playSFX('metal_clank', { volume: 0.9, throttleMs: 200 });
      void shakeControls.start({
        x: [0, -7, 7, -4, 4, 0],
        transition: { duration: 0.4 },
      });
      return;
    }
    audio.playSFX(boss ? 'sword_unsheathe' : 'card_slide', { volume: 0.8 });
    onSelect(stage);
  };

  return (
    <div
      className="absolute z-[3] -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${stage.mapPosition.x}%`, top: `${stage.mapPosition.y}%` }}
    >
      <motion.button
        type="button"
        data-testid={`map-node-${stage.id}`}
        data-status={status}
        aria-label={locked ? 'Locked trial' : `${stage.title} — ${stage.objective}`}
        aria-disabled={locked}
        animate={shakeControls}
        whileHover={locked ? undefined : { scale: 1.12 }}
        whileTap={locked ? undefined : { scale: 0.94 }}
        onHoverStart={handleHover}
        onFocus={handleHover}
        onClick={handleClick}
        className="relative flex cursor-pointer flex-col items-center gap-1.5 border-0 bg-transparent p-1 [-webkit-tap-highlight-color:transparent] [font-family:inherit]"
      >
        {boss && (
          <span
            className="absolute -top-3.5 text-base [filter:drop-shadow(0_2px_6px_rgba(0,0,0,0.7))]"
            style={{ opacity: locked ? 0.5 : 1 }}
          >
            ⚔️
          </span>
        )}
        <span
          className={`${NODE_CIRCLE_BASE} ${
            boss ? 'h-[58px] w-[58px] text-[1.1rem]' : 'h-[46px] w-[46px] text-[0.95rem]'
          } ${NODE_CIRCLE_BY_STATUS[status](boss)}`}
        >
          {status === 'cleared' ? '✓' : locked ? '🔒' : stage.id}
        </span>
        <span
          className={`max-w-[7.5rem] text-[0.58rem] leading-[1.35] tracking-[0.14em] [text-shadow:0_2px_6px_rgba(0,0,0,0.85)] ${NODE_LABEL_BY_STATUS[status]}`}
          style={labelNudge}
        >
          {locked ? '???' : stage.title}
        </span>
        {status === 'unlocked' && (
          <span
            className="max-w-[8.5rem] text-[0.56rem] italic leading-[1.35] text-[rgba(238,242,248,0.6)] [font-family:Georgia,serif] [text-shadow:0_2px_6px_rgba(0,0,0,0.85)]"
            style={labelNudge}
          >
            {stage.epithet}
          </span>
        )}
      </motion.button>
    </div>
  );
}

const KEYFRAMES = `
@keyframes nodePulse {
  0%   { box-shadow: 0 0 0 0 rgba(245, 197, 66, 0.5); }
  100% { box-shadow: 0 0 0 14px rgba(245, 197, 66, 0); }
}
@keyframes nodePulseBoss {
  0%   { box-shadow: 0 0 0 0 rgba(232, 112, 58, 0.55); }
  100% { box-shadow: 0 0 0 16px rgba(232, 112, 58, 0); }
}
@keyframes shipBob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50%      { transform: translateY(-6px) rotate(3deg); }
}
`;
