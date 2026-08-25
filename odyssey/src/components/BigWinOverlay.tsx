'use client';

/**
 * BigWinOverlay — foreground coin-shower canvas for jackpot moments
 * (Trojan Horse side bet, boss clears).
 *
 * Mount it once near the app root and keep a ref:
 *
 *   const bigWinRef = useRef<BigWinOverlayHandle>(null);
 *   <BigWinOverlay ref={bigWinRef} />
 *   ...
 *   bigWinRef.current?.triggerJackpot({ label: 'TROJAN HORSE', sublabel: '×40 PAYS 12,000' });
 *
 * The whole sequence — chime, coin volleys, label — runs exactly
 * JACKPOT_DURATION_MS and is re-entrant (retriggering restarts it cleanly).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCanvasParticles } from '../hooks/useCanvasParticles';
import { useAudioEngine } from '../hooks/useAudioEngine';

export interface JackpotOptions {
  label?: string;
  sublabel?: string;
}

export interface BigWinOverlayHandle {
  triggerJackpot: (opts?: JackpotOptions) => void;
}

export interface BigWinOverlayProps {
  zIndex?: number;
}

export const JACKPOT_DURATION_MS = 3000;

interface JackpotDisplay {
  label: string;
  sublabel?: string;
}

export const BigWinOverlay = forwardRef<BigWinOverlayHandle, BigWinOverlayProps>(
  function BigWinOverlay({ zIndex = 1200 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { burst, clear } = useCanvasParticles(canvasRef, 'coins', { maxParticles: 450 });
    const audio = useAudioEngine();

    const [display, setDisplay] = useState<JackpotDisplay | null>(null);
    const timersRef = useRef<number[]>([]);

    const clearTimers = useCallback(() => {
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
    }, []);

    useEffect(() => clearTimers, [clearTimers]);

    const triggerJackpot = useCallback(
      (opts: JackpotOptions = {}) => {
        clearTimers();
        clear();
        setDisplay({ label: opts.label ?? 'BIG WIN', sublabel: opts.sublabel });
        audio.playSFX('jackpot_chime', { volume: 1 });

        const cw = canvasRef.current?.clientWidth ?? window.innerWidth;
        const ch = canvasRef.current?.clientHeight ?? window.innerHeight;
        const launchY = ch * 0.92;

        // Volleys stagger across the first ~2.1s so coins are still raining
        // as the 3s window closes, instead of one blast and dead air.
        const volleys = [
          { at: 0, count: 95, x: cw * 0.5 },
          { at: 280, count: 55, x: cw * 0.28 },
          { at: 560, count: 55, x: cw * 0.72 },
          { at: 900, count: 45, x: cw * 0.4 },
          { at: 1250, count: 45, x: cw * 0.6 },
          { at: 1650, count: 35, x: cw * 0.5 },
          { at: 2000, count: 25, x: cw * 0.5 },
        ];
        for (const v of volleys) {
          timersRef.current.push(
            window.setTimeout(() => burst({ x: v.x, y: launchY, count: v.count }), v.at),
          );
        }

        // Label exits (and the canvas begins its 250ms CSS fade) just before
        // the hard cutoff, so the whole effect lands at exactly 3s.
        timersRef.current.push(
          window.setTimeout(() => setDisplay(null), JACKPOT_DURATION_MS - 250),
        );
        timersRef.current.push(window.setTimeout(() => clear(), JACKPOT_DURATION_MS));
      },
      [audio, burst, clear, clearTimers],
    );

    useImperativeHandle(ref, () => ({ triggerJackpot }), [triggerJackpot]);

    return (
      <div
        aria-hidden={display === null}
        data-testid="big-win-overlay"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex,
          pointerEvents: 'none',
          opacity: display ? 1 : 0,
          transition: 'opacity 250ms ease',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
        <AnimatePresence>
          {display && (
            <motion.div
              key="jackpot-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.25, transition: { duration: 0.25 } }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '0 1rem',
              }}
            >
              <motion.h2
                initial={{ scale: 0.2, rotate: -6 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 14 }}
                style={{
                  margin: 0,
                  fontFamily: "'Cinzel', 'Trajan Pro', Georgia, serif",
                  fontWeight: 900,
                  fontSize: 'clamp(3rem, 13vw, 7rem)',
                  lineHeight: 1,
                  letterSpacing: '0.04em',
                  background: 'linear-gradient(180deg, #fff3c4 0%, #f5c542 45%, #b8860b 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                  filter: 'drop-shadow(0 0 18px rgba(245, 197, 66, 0.55)) drop-shadow(0 4px 2px rgba(0,0,0,0.6))',
                }}
              >
                {display.label}
              </motion.h2>
              {display.sublabel && (
                <motion.p
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, duration: 0.35 }}
                  style={{
                    margin: '0.75rem 0 0',
                    fontFamily: "'Cinzel', Georgia, serif",
                    fontSize: 'clamp(1rem, 4vw, 1.6rem)',
                    letterSpacing: '0.3em',
                    color: '#ffe9a8',
                    textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                  }}
                >
                  {display.sublabel}
                </motion.p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
);
