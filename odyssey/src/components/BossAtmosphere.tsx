'use client';

/**
 * BossAtmosphere — full-screen ember canvas layered behind boss stages and
 * the Odyssey campaign map. One canvas, zero per-particle DOM. Memoized so
 * parent re-renders (bet updates, HUD ticks) never touch it.
 */

import { memo, useRef, type CSSProperties } from 'react';
import { useCanvasParticles } from '../hooks/useCanvasParticles';

export interface BossAtmosphereProps {
  /** 0–1: scales ember density. Default 0.6; push to 1 for final bosses. */
  intensity?: number;
  /** position: fixed fullscreen (default) vs absolute-fill of the parent. */
  fixed?: boolean;
  zIndex?: number;
  /** Darkened edges + a low heat-glow so embers read on any backdrop. */
  vignette?: boolean;
  className?: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function BossAtmosphereImpl({
  intensity = 0.6,
  fixed = true,
  zIndex = 0,
  vignette = true,
  className,
}: BossAtmosphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const level = clamp01(intensity);

  useCanvasParticles(canvasRef, 'embers', {
    emissionRate: 8 + 34 * level,
    maxParticles: Math.round(90 + 160 * level),
  });

  const rootStyle: CSSProperties = {
    position: fixed ? 'fixed' : 'absolute',
    inset: 0,
    zIndex,
    pointerEvents: 'none',
    overflow: 'hidden',
  };

  return (
    <div aria-hidden className={className} style={rootStyle} data-testid="boss-atmosphere">
      {vignette && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: [
              'radial-gradient(120% 90% at 50% 40%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)',
              `linear-gradient(to top, rgba(120,35,5,${0.12 + 0.18 * level}) 0%, rgba(0,0,0,0) 35%)`,
            ].join(', '),
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
    </div>
  );
}

export const BossAtmosphere = memo(BossAtmosphereImpl);
