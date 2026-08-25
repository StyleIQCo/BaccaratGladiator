'use client';

/**
 * CampaignSelector — the dual-campaign landing screen.
 *
 * Card A: Classic Gladiator Saga (the untouched 62-stage progression).
 * Card B: LIMITED TIME EVENT: The Odyssey (parallel campaign) — deep ocean
 *         blue, pulsing LIVE badge, live countdown to ODYSSEY_EVENT_ENDS_AT.
 *
 * Audio choreography:
 * - Hovering either card: throttled "card_slide" SFX.
 * - Selecting The Odyssey: gong strike + crossfade into the orchestral
 *   overture, a gold flash, then onSelect fires once the gong has landed.
 * - Selecting Classic: quick slide SFX, immediate handoff, BGM untouched.
 * - Locked Odyssey: metal clank + shake, no navigation.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { useAudioEngine } from '../hooks/useAudioEngine';
import {
  CLASSIC_CAMPAIGN_STAGE_COUNT,
  ODYSSEY_EVENT_ENDS_AT,
  ODYSSEY_STAGE_COUNT,
  type ActiveCampaign,
} from '../data/odysseyStoryData';

export interface CampaignSelectorProps {
  onSelect: (campaign: ActiveCampaign) => void;
  odysseyLocked?: boolean;
  /** Shown on the lock badge, e.g. "Clear Stage 10 to unlock". */
  odysseyLockedHint?: string;
  /** e.g. 37 → renders "STAGE 37 / 62" on the classic card. */
  classicStagesCleared?: number;
  /** Override the event deadline (defaults to ODYSSEY_EVENT_ENDS_AT). */
  eventEndsAt?: string | number | Date;
}

const GOLD = '#f5c542';
const GOLD_DIM = 'rgba(245, 197, 66, 0.45)';
const OCEAN_EDGE = 'rgba(86, 180, 233, 0.5)';

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function CampaignSelector({
  onSelect,
  odysseyLocked = false,
  odysseyLockedHint = 'Coming soon, Gladiator',
  classicStagesCleared,
  eventEndsAt = ODYSSEY_EVENT_ENDS_AT,
}: CampaignSelectorProps) {
  const audio = useAudioEngine();
  const [selecting, setSelecting] = useState<ActiveCampaign | null>(null);
  const shakeControls = useAnimationControls();
  const timersRef = useRef<number[]>([]);

  // Countdown starts null and fills in on mount, so SSR markup and the first
  // client render agree (no hydration mismatch from Date.now()).
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  useEffect(() => {
    const deadline = new Date(eventEndsAt).getTime();
    const tick = () => setRemainingMs(deadline - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [eventEndsAt]);

  const eventOver = remainingMs !== null && remainingMs <= 0;

  useEffect(() => {
    audio.preload({
      sfx: ['card_slide', 'gong', 'metal_clank'],
      bgm: ['orchestral_overture'],
    });
    return () => {
      for (const id of timersRef.current) window.clearTimeout(id);
    };
  }, [audio]);

  const handleHover = useCallback(() => {
    if (selecting) return;
    audio.playSFX('card_slide', { volume: 0.45, throttleMs: 150 });
  }, [audio, selecting]);

  const handleSelect = useCallback(
    (id: ActiveCampaign) => {
      if (selecting) return;

      if (id === 'CLASSIC') {
        audio.playSFX('card_slide', { volume: 0.8 });
        setSelecting('CLASSIC');
        timersRef.current.push(window.setTimeout(() => onSelect('CLASSIC'), 180));
        return;
      }

      if (odysseyLocked || eventOver) {
        audio.playSFX('metal_clank', { volume: 0.9, throttleMs: 250 });
        void shakeControls.start({
          x: [0, -10, 10, -6, 6, -2, 0],
          transition: { duration: 0.45 },
        });
        return;
      }

      setSelecting('ODYSSEY');
      audio.playSFX('gong', { volume: 1 });
      audio.playBGM('orchestral_overture', { crossfadeMs: 2400 });
      // Let the gong bloom and the flash play before handing off.
      timersRef.current.push(window.setTimeout(() => onSelect('ODYSSEY'), 950));
    },
    [audio, eventOver, odysseyLocked, onSelect, selecting, shakeControls],
  );

  return (
    <div style={S.root} data-testid="campaign-selector">
      <style>{KEYFRAMES}</style>

      <header style={S.header}>
        <p style={S.kicker}>A LIMITED-TIME EVENT HAS BEGUN</p>
        <h1 style={S.title}>Choose Your Campaign</h1>
      </header>

      <div style={S.cardRow}>
        {/* ---- Card A: Classic Gladiator Saga ---- */}
        <motion.button
          type="button"
          data-testid="campaign-card-classic"
          onHoverStart={handleHover}
          onFocus={handleHover}
          onClick={() => handleSelect('CLASSIC')}
          whileHover={{ y: -10, scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          style={{ ...S.card, ...S.cardClassic, opacity: selecting === 'ODYSSEY' ? 0.35 : 1 }}
        >
          <span style={S.shine} />
          <span style={S.emblem}>🏛️</span>
          <span style={S.cardTitle}>Classic Gladiator Saga</span>
          <span style={S.cardTagline}>
            {CLASSIC_CAMPAIGN_STAGE_COUNT} Stages • Global Circuit
          </span>
          {classicStagesCleared !== undefined && (
            <span style={S.progressChip}>
              STAGE {classicStagesCleared} / {CLASSIC_CAMPAIGN_STAGE_COUNT}
            </span>
          )}
          <span style={{ ...S.cta, color: '#cfd8e3', borderColor: 'rgba(207, 216, 227, 0.4)' }}>
            CONTINUE
          </span>
        </motion.button>

        {/* ---- Card B: LIMITED TIME EVENT: The Odyssey ---- */}
        <motion.button
          type="button"
          data-testid="campaign-card-odyssey"
          animate={shakeControls}
          onHoverStart={handleHover}
          onFocus={handleHover}
          onClick={() => handleSelect('ODYSSEY')}
          whileHover={{ y: -10, scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          style={{ ...S.card, ...S.cardOdyssey, opacity: selecting === 'CLASSIC' ? 0.35 : 1 }}
        >
          <span style={S.shine} />
          <span style={S.liveBadge} data-testid="odyssey-live-badge">
            <span style={S.liveDot} />
            LIVE
          </span>
          <span style={S.eventKicker}>LIMITED TIME EVENT</span>
          <span style={{ ...S.emblem, animation: 'odysseyFloat 3.2s ease-in-out infinite' }}>⛵</span>
          <span style={{ ...S.cardTitle, color: GOLD }}>The Odyssey</span>
          <span style={S.cardTagline}>
            {ODYSSEY_STAGE_COUNT} Epic Trials • Exclusive Rewards
          </span>
          <span style={S.countdown} data-testid="odyssey-countdown">
            {remainingMs === null
              ? 'ENDS SOON'
              : eventOver
                ? 'EVENT ENDED'
                : `ENDS IN ${formatCountdown(remainingMs)}`}
          </span>
          {odysseyLocked ? (
            <span style={{ ...S.cta, ...S.ctaLocked }}>🔒 {odysseyLockedHint}</span>
          ) : (
            <span style={{ ...S.cta, color: GOLD, borderColor: GOLD_DIM }}>SET SAIL</span>
          )}
        </motion.button>
      </div>

      {/* Gold gong-flash when The Odyssey is chosen */}
      <AnimatePresence>
        {selecting === 'ODYSSEY' && (
          <motion.div
            key="gong-flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.85, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, times: [0, 0.18, 1], ease: 'easeOut' }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 50,
              pointerEvents: 'none',
              background:
                'radial-gradient(circle at 50% 55%, rgba(255, 236, 170, 0.95) 0%, rgba(245, 197, 66, 0.5) 40%, rgba(0,0,0,0) 75%)',
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const KEYFRAMES = `
@keyframes odysseyFloat {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50%      { transform: translateY(-8px) rotate(2deg); }
}
@keyframes shineSweep {
  0%   { transform: translateX(-130%) skewX(-18deg); }
  60%  { transform: translateX(230%) skewX(-18deg); }
  100% { transform: translateX(230%) skewX(-18deg); }
}
@keyframes livePulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 82, 82, 0.55); }
  50%      { box-shadow: 0 0 0 7px rgba(255, 82, 82, 0); }
}
@keyframes liveDotBlink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}
`;

const S: Record<string, CSSProperties> = {
  root: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2.5rem',
    padding: '3rem 1.25rem',
    background:
      'radial-gradient(120% 100% at 50% 0%, #1b2436 0%, #0f1420 55%, #090b12 100%)',
    fontFamily: "'Cinzel', 'Trajan Pro', Georgia, serif",
  },
  header: { textAlign: 'center' },
  kicker: {
    margin: 0,
    fontSize: '0.75rem',
    letterSpacing: '0.45em',
    color: GOLD_DIM,
  },
  title: {
    margin: '0.5rem 0 0',
    fontSize: 'clamp(1.8rem, 6vw, 3rem)',
    fontWeight: 700,
    letterSpacing: '0.06em',
    color: '#f2ead8',
    textShadow: '0 2px 24px rgba(245, 197, 66, 0.25)',
  },
  cardRow: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '2rem',
    width: '100%',
    maxWidth: '900px',
  },
  card: {
    position: 'relative',
    overflow: 'hidden',
    flex: '1 1 320px',
    maxWidth: '400px',
    minHeight: '380px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.9rem',
    padding: '2.25rem 1.5rem',
    borderRadius: '18px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'center',
    WebkitTapHighlightColor: 'transparent',
  },
  cardClassic: {
    background: 'linear-gradient(165deg, #232b3a 0%, #161c29 60%, #101521 100%)',
    border: '2px solid rgba(207, 216, 227, 0.25)',
    boxShadow: '0 18px 50px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255,255,255,0.04)',
  },
  cardOdyssey: {
    // Deep ocean blue — wine-dark sea under a sky of stars.
    background: 'linear-gradient(165deg, #0e3a5c 0%, #0a2542 45%, #061428 100%)',
    border: `2px solid ${OCEAN_EDGE}`,
    boxShadow:
      '0 18px 50px rgba(0, 0, 0, 0.55), 0 0 42px rgba(56, 152, 210, 0.22), inset 0 0 0 1px rgba(245, 197, 66, 0.12)',
  },
  shine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '45%',
    background:
      'linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0) 100%)',
    animation: 'shineSweep 4.5s ease-in-out infinite',
    pointerEvents: 'none',
  },
  liveBadge: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.32rem 0.7rem',
    borderRadius: '999px',
    fontSize: '0.66rem',
    letterSpacing: '0.22em',
    fontWeight: 700,
    color: '#fff',
    background: 'linear-gradient(180deg, #ff5d5d, #d32f2f)',
    animation: 'livePulse 1.6s ease-out infinite',
  },
  liveDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: '#fff',
    animation: 'liveDotBlink 1.6s ease-in-out infinite',
  },
  eventKicker: {
    position: 'absolute',
    top: '1.15rem',
    left: '1rem',
    fontSize: '0.6rem',
    letterSpacing: '0.24em',
    color: 'rgba(160, 210, 245, 0.85)',
    fontWeight: 700,
  },
  emblem: {
    fontSize: '3.4rem',
    lineHeight: 1,
    filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.6))',
    display: 'inline-block',
  },
  cardTitle: {
    fontSize: '1.55rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: '#e8edf5',
  },
  cardTagline: {
    fontSize: '0.85rem',
    lineHeight: 1.5,
    color: 'rgba(232, 237, 245, 0.72)',
    letterSpacing: '0.06em',
  },
  countdown: {
    padding: '0.4rem 1rem',
    borderRadius: '999px',
    border: `1px solid ${OCEAN_EDGE}`,
    background: 'rgba(6, 20, 40, 0.6)',
    fontSize: '0.72rem',
    letterSpacing: '0.2em',
    color: '#aee0ff',
    fontVariantNumeric: 'tabular-nums',
  },
  progressChip: {
    padding: '0.35rem 0.9rem',
    borderRadius: '999px',
    border: '1px solid rgba(207, 216, 227, 0.25)',
    fontSize: '0.68rem',
    letterSpacing: '0.22em',
    color: 'rgba(207, 216, 227, 0.85)',
  },
  cta: {
    marginTop: '0.6rem',
    padding: '0.7rem 2rem',
    borderRadius: '10px',
    border: '1px solid',
    fontSize: '0.8rem',
    fontWeight: 700,
    letterSpacing: '0.3em',
  },
  ctaLocked: {
    color: 'rgba(232, 237, 245, 0.45)',
    borderColor: 'rgba(232, 237, 245, 0.2)',
    letterSpacing: '0.12em',
  },
};
