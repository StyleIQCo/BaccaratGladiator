'use client';

/**
 * StageTransitionOverlay — the full-screen voyage sequence played after
 * clearing an Odyssey stage. Imperative API:
 *
 *   const voyageRef = useRef<StageTransitionOverlayHandle>(null);
 *   <StageTransitionOverlay ref={voyageRef} />
 *   ...
 *   await voyageRef.current?.play({ fromStageId: 2, toStageId: 3 });
 *   // sequence finished — advance progress / swap screens here
 *
 * Timeline (audio and visuals share one clock):
 *   0ms      SHAKE    screen shakes, lightning flash, thunderclap SFX
 *   750ms    SAIL     golden ship glides the chart — position driven by a
 *                     requestAnimationFrame loop writing styles directly
 *                     (zero React state per frame); ocean-waves loop starts
 *   3350ms   ARRIVE   destination node blooms; waves fade; triumphant chime
 *   4250ms   DISSOLVE overlay dissolves; play()'s Promise resolves at 4900ms
 *
 * A play() call while a voyage is running returns the in-flight Promise.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { motion } from 'framer-motion';
import { useAudioEngine, type SfxHandle } from '../hooks/useAudioEngine';
import { getOdysseyStage, type OdysseyStage } from '../data/odysseyStoryData';

export interface Voyage {
  fromStageId: number;
  toStageId: number;
}

export interface StageTransitionOverlayHandle {
  play: (voyage: Voyage) => Promise<void>;
}

export interface StageTransitionOverlayProps {
  zIndex?: number;
}

export const TRANSITION_SHAKE_MS = 750;
export const TRANSITION_SAIL_MS = 2600;
export const TRANSITION_ARRIVE_MS = 900;
export const TRANSITION_DISSOLVE_MS = 650;
export const TRANSITION_TOTAL_MS =
  TRANSITION_SHAKE_MS + TRANSITION_SAIL_MS + TRANSITION_ARRIVE_MS + TRANSITION_DISSOLVE_MS;

type Phase = 'idle' | 'shake' | 'sail' | 'arrive' | 'dissolve';

const GOLD = '#f5c542';
const GOLD_DIM = 'rgba(245, 197, 66, 0.45)';
const EMBER = '#e8703a';

const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

interface ActiveVoyage {
  from: OdysseyStage;
  to: OdysseyStage;
}

export const StageTransitionOverlay = forwardRef<
  StageTransitionOverlayHandle,
  StageTransitionOverlayProps
>(function StageTransitionOverlay({ zIndex = 1300 }, ref) {
  const audio = useAudioEngine();
  const [voyage, setVoyage] = useState<ActiveVoyage | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  const shipRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  const glideRafRef = useRef<number | null>(null);
  const wavesRef = useRef<SfxHandle | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);
  const busyRef = useRef<Promise<void> | null>(null);

  const cleanup = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
    if (glideRafRef.current !== null) {
      cancelAnimationFrame(glideRafRef.current);
      glideRafRef.current = null;
    }
    wavesRef.current?.stop(150);
    wavesRef.current = null;
  }, []);

  // Unmount mid-voyage: never leave the caller awaiting a dead Promise.
  useEffect(
    () => () => {
      cleanup();
      resolveRef.current?.();
      resolveRef.current = null;
      busyRef.current = null;
    },
    [cleanup],
  );

  const startGlide = useCallback((from: OdysseyStage, to: OdysseyStage) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / TRANSITION_SAIL_MS, 1);
      const e = easeInOutCubic(p);
      const el = shipRef.current;
      if (el) {
        el.style.left = `${from.mapPosition.x + (to.mapPosition.x - from.mapPosition.x) * e}%`;
        el.style.top = `${from.mapPosition.y + (to.mapPosition.y - from.mapPosition.y) * e}%`;
      }
      glideRafRef.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    glideRafRef.current = requestAnimationFrame(step);
  }, []);

  const play = useCallback(
    (v: Voyage): Promise<void> => {
      if (busyRef.current) return busyRef.current;
      const from = getOdysseyStage(v.fromStageId);
      const to = getOdysseyStage(v.toStageId);
      if (!from || !to) return Promise.resolve();

      const promise = new Promise<void>((resolve) => {
        resolveRef.current = resolve;
      });
      busyRef.current = promise;

      setVoyage({ from, to });
      setPhase('shake');
      audio.playSFX('thunderclap', { volume: 1 });

      const at = (ms: number, fn: () => void) =>
        timersRef.current.push(window.setTimeout(fn, ms));

      at(TRANSITION_SHAKE_MS, () => {
        setPhase('sail');
        wavesRef.current = audio.playSFX('ocean_waves', { loop: true, volume: 0.7 });
        startGlide(from, to);
      });
      at(TRANSITION_SHAKE_MS + TRANSITION_SAIL_MS, () => {
        setPhase('arrive');
        wavesRef.current?.stop(700);
        wavesRef.current = null;
        audio.playSFX('triumph_chime', { volume: 1 });
      });
      at(TRANSITION_SHAKE_MS + TRANSITION_SAIL_MS + TRANSITION_ARRIVE_MS, () =>
        setPhase('dissolve'),
      );
      at(TRANSITION_TOTAL_MS, () => {
        cleanup();
        setPhase('idle');
        setVoyage(null);
        busyRef.current = null;
        resolveRef.current?.();
        resolveRef.current = null;
      });

      return promise;
    },
    [audio, cleanup, startGlide],
  );

  useImperativeHandle(ref, () => ({ play }), [play]);

  if (!voyage || phase === 'idle') return null;

  const { from, to } = voyage;
  const sailing = phase !== 'shake';
  const arrived = phase === 'arrive' || phase === 'dissolve';

  return (
    <motion.div
      data-testid="stage-transition"
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: phase === 'dissolve' ? 0 : 1 }}
      transition={{
        duration: phase === 'dissolve' ? TRANSITION_DISSOLVE_MS / 1000 : 0.2,
        ease: 'easeInOut',
      }}
      style={{ ...S.root, zIndex }}
    >
      <style>{KEYFRAMES}</style>

      {/* Lightning flash under the thunderclap */}
      {phase === 'shake' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.9, 0.1, 0.5, 0] }}
          transition={{ duration: 0.55, times: [0, 0.12, 0.35, 0.5, 1] }}
          style={S.lightning}
        />
      )}

      {/* Everything inside shakes with the thunder */}
      <motion.div
        animate={
          phase === 'shake'
            ? { x: [0, -16, 13, -10, 8, -5, 0], y: [0, 9, -8, 6, -4, 2, 0] }
            : { x: 0, y: 0 }
        }
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={S.stage}
      >
        <p style={S.kicker}>STAGE CLEARED</p>
        <h2 style={S.title}>{from.title}</h2>

        <div style={S.seaPanel}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={S.routeSvg}>
            <line
              x1={from.mapPosition.x}
              y1={from.mapPosition.y}
              x2={to.mapPosition.x}
              y2={to.mapPosition.y}
              stroke={GOLD_DIM}
              strokeWidth={0.5}
              strokeDasharray="1.4 2"
              strokeLinecap="round"
            />
            <motion.line
              x1={from.mapPosition.x}
              y1={from.mapPosition.y}
              x2={to.mapPosition.x}
              y2={to.mapPosition.y}
              stroke={GOLD}
              strokeWidth={0.7}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: sailing ? 1 : 0 }}
              transition={{ duration: TRANSITION_SAIL_MS / 1000, ease: 'easeInOut' }}
            />
          </svg>

          {/* Departure marker */}
          <span
            style={{
              ...S.marker,
              left: `${from.mapPosition.x}%`,
              top: `${from.mapPosition.y}%`,
              background: GOLD_DIM,
            }}
          />

          {/* Destination marker + arrival bloom */}
          <span
            style={{
              ...S.marker,
              left: `${to.mapPosition.x}%`,
              top: `${to.mapPosition.y}%`,
              background: arrived ? GOLD : 'rgba(207, 216, 227, 0.35)',
              boxShadow: arrived ? `0 0 18px ${GOLD}` : 'none',
            }}
          />
          {arrived && (
            <motion.span
              initial={{ scale: 0.2, opacity: 0.9 }}
              animate={{ scale: 2.4, opacity: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              style={{
                ...S.bloomRing,
                left: `${to.mapPosition.x}%`,
                top: `${to.mapPosition.y}%`,
                borderColor: to.isBossStage ? EMBER : GOLD,
              }}
            />
          )}

          {/* The golden ship — the sail-phase rAF glide writes left/top here */}
          <div
            ref={shipRef}
            style={{
              ...S.shipAnchor,
              left: `${from.mapPosition.x}%`,
              top: `${from.mapPosition.y}%`,
            }}
          >
            <span style={S.ship}>⛵</span>
          </div>
        </div>

        <div style={S.captionWell}>
          {arrived ? (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              style={{ textAlign: 'center' }}
            >
              <p style={{ ...S.caption, color: GOLD }}>{to.title}</p>
              <p style={S.epithet}>{to.epithet}</p>
              {to.isBossStage && <p style={S.bossWarning}>⚔️ A BOSS AWAITS</p>}
            </motion.div>
          ) : (
            <p style={S.caption}>
              {phase === 'shake' ? 'The sea answers…' : `Sailing for ${to.title}…`}
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
});

const KEYFRAMES = `
@keyframes voyageBob {
  0%, 100% { transform: translate(-50%, -80%) rotate(-4deg); }
  50%      { transform: translate(-50%, -92%) rotate(4deg); }
}
`;

const S: Record<string, CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background:
      'radial-gradient(120% 100% at 50% 0%, #10203a 0%, #0a1322 55%, #060a12 100%)',
    fontFamily: "'Cinzel', 'Trajan Pro', Georgia, serif",
  },
  lightning: {
    position: 'absolute',
    inset: 0,
    background:
      'radial-gradient(90% 70% at 50% 20%, rgba(235, 242, 255, 0.95) 0%, rgba(160, 190, 235, 0.35) 45%, rgba(0,0,0,0) 80%)',
  },
  stage: {
    width: 'min(640px, 92%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1.1rem',
  },
  kicker: {
    margin: 0,
    fontSize: '0.68rem',
    letterSpacing: '0.5em',
    color: GOLD_DIM,
  },
  title: {
    margin: 0,
    fontSize: 'clamp(1.5rem, 6vw, 2.4rem)',
    letterSpacing: '0.06em',
    color: '#f2ead8',
    textShadow: '0 2px 24px rgba(245, 197, 66, 0.3)',
    textAlign: 'center',
  },
  seaPanel: {
    position: 'relative',
    width: '100%',
    height: 'min(46dvh, 380px)',
    borderRadius: '16px',
    border: `1px solid ${GOLD_DIM}`,
    overflow: 'hidden',
    background:
      'linear-gradient(180deg, rgba(16, 34, 58, 0.9) 0%, rgba(8, 16, 30, 0.95) 100%)',
    boxShadow: 'inset 0 0 60px rgba(0, 0, 0, 0.6)',
  },
  routeSvg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  },
  marker: {
    position: 'absolute',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
  },
  bloomRing: {
    position: 'absolute',
    width: '46px',
    height: '46px',
    borderRadius: '50%',
    border: `2px solid ${GOLD}`,
    transform: 'translate(-50%, -50%)',
  },
  shipAnchor: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
  ship: {
    position: 'absolute',
    display: 'inline-block',
    fontSize: '1.8rem',
    animation: 'voyageBob 1.5s ease-in-out infinite',
    filter:
      'sepia(1) saturate(2.2) hue-rotate(-12deg) drop-shadow(0 0 12px rgba(245, 197, 66, 0.5)) drop-shadow(0 4px 10px rgba(0,0,0,0.7))',
  },
  captionWell: {
    minHeight: '4.4rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    margin: 0,
    fontFamily: 'Georgia, serif',
    fontStyle: 'italic',
    fontSize: '0.95rem',
    letterSpacing: '0.06em',
    color: 'rgba(238, 242, 248, 0.75)',
  },
  epithet: {
    margin: '0.3rem 0 0',
    fontFamily: 'Georgia, serif',
    fontStyle: 'italic',
    fontSize: '0.8rem',
    color: 'rgba(238, 242, 248, 0.55)',
  },
  bossWarning: {
    margin: '0.5rem 0 0',
    fontSize: '0.7rem',
    letterSpacing: '0.35em',
    color: EMBER,
  },
};
