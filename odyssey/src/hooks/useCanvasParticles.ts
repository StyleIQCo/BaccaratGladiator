'use client';

/**
 * useCanvasParticles — single-canvas particle engine for The Odyssey.
 *
 * Performance contract (the reason this hook exists):
 * - ONE <canvas>, driven by requestAnimationFrame. Zero DOM nodes per
 *   particle, zero React state in the hot path — all simulation state
 *   lives in refs/closures, so a 60fps shower never re-renders React.
 * - Object pool with swap-remove: after warm-up, steady state allocates
 *   nothing per frame, so the GC has nothing to collect mid-animation.
 * - Delta-time clamped stepping (tab switches don't teleport particles),
 *   DPR capped at 2 (3x retina is pure fill-rate cost on mobile), and the
 *   rAF loop self-suspends when there is nothing alive to draw.
 * - No shadowBlur anywhere — it is the single easiest way to drop frames
 *   on mobile canvas. Glow is faked with a cheap 'lighter' composite halo.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';

export type ParticleType = 'embers' | 'coins';

export interface CanvasParticlesOptions {
  /** Hard cap on live particles. Defaults: embers 220, coins 420. */
  maxParticles?: number;
  /** Embers only: continuous spawn rate in particles/second. Default 26. */
  emissionRate?: number;
  /** Embers only: emit continuously from mount. Default true. */
  autoStart?: boolean;
  /** Device-pixel-ratio cap. Default 2. */
  dprCap?: number;
}

export interface BurstOptions {
  x?: number;
  y?: number;
  count?: number;
}

export interface CanvasParticlesApi {
  /** Coins: fire a shower from (x, y). Embers: a one-off puff. */
  burst: (opts?: BurstOptions) => void;
  /** Embers: toggle continuous emission (live particles finish naturally). */
  setRunning: (running: boolean) => void;
  /** Kill every live particle and wipe the canvas immediately. */
  clear: () => void;
}

const TAU = Math.PI * 2;
const MAX_DT = 0.066; // clamp: a long GC pause or tab switch must not teleport particles
const COIN_GRAVITY = 1350; // px/s²

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  maxLife: number;
  size: number;
  phase: number;
  freq: number;
  amp: number;
  spin: number;
  spinSpeed: number;
  tilt: number;
  hueFrom: number;
  hueTo: number;
}

function makeParticle(): Particle {
  return {
    x: 0, y: 0, vx: 0, vy: 0,
    age: 0, maxLife: 1, size: 1,
    phase: 0, freq: 0, amp: 0,
    spin: 0, spinSpeed: 0, tilt: 0,
    hueFrom: 0, hueTo: 0,
  };
}

interface EngineControls {
  burst: (opts?: BurstOptions) => void;
  syncRunning: () => void;
  clear: () => void;
}

export function useCanvasParticles(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  type: ParticleType,
  options: CanvasParticlesOptions = {},
): CanvasParticlesApi {
  // Options are read through a ref every frame, so callers can pass a fresh
  // object literal each render (and tween emissionRate) without tearing
  // down the engine.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const runningRef = useRef(options.autoStart ?? true);
  const controlsRef = useRef<EngineControls | null>(null);
  const pendingBurstsRef = useRef<BurstOptions[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const defaults =
      type === 'embers'
        ? { maxParticles: 220, emissionRate: 26 }
        : { maxParticles: 420, emissionRate: 0 };

    const live: Particle[] = [];
    const pool: Particle[] = [];
    let w = 0;
    let h = 0;
    let rafId: number | null = null;
    let last = 0;
    let emitAcc = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, optionsRef.current.dprCap ?? 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const obtain = (): Particle => pool.pop() ?? makeParticle();

    const spawnEmber = (ox?: number, oy?: number) => {
      const p = obtain();
      p.x = ox !== undefined ? ox + (Math.random() - 0.5) * 40 : Math.random() * w;
      p.y = oy !== undefined ? oy + (Math.random() - 0.5) * 20 : h + 8 + Math.random() * 18;
      p.vx = 0;
      p.vy = -(28 + Math.random() * 66);
      p.age = 0;
      p.maxLife = 3.5 + Math.random() * 4.5;
      p.size = 1 + Math.random() * 2.4;
      p.phase = Math.random() * TAU;
      p.freq = 0.4 + Math.random() * 1.4;
      p.amp = 8 + Math.random() * 24;
      p.hueFrom = 16 + Math.random() * 10; // deep orange
      p.hueTo = 44 + Math.random() * 12; // gold-yellow
      live.push(p);
    };

    const spawnCoin = (cx: number, cy: number) => {
      const p = obtain();
      p.x = cx + (Math.random() - 0.5) * 70;
      p.y = cy + (Math.random() - 0.5) * 24;
      // Launch speed derived from canvas height so the fountain apex lands
      // at 30–100% of the screen on any device.
      const apex = 0.3 + Math.random() * 0.7;
      const vUp = Math.sqrt(2 * COIN_GRAVITY * Math.max(h, 200) * apex);
      p.vx = (Math.random() - 0.5) * vUp * 0.7;
      p.vy = -vUp;
      p.age = 0;
      p.maxLife = 5;
      p.size = 6.5 + Math.random() * 7;
      p.spin = Math.random() * TAU;
      p.spinSpeed = 5 + Math.random() * 11;
      p.tilt = (Math.random() - 0.5) * 0.7;
      live.push(p);
    };

    const drawEmber = (p: Particle) => {
      const t = p.age / p.maxLife;
      const a = Math.sin(Math.min(t, 1) * Math.PI) * (0.72 + 0.28 * Math.sin(p.age * 9 + p.phase));
      if (a <= 0.02) return;
      const hue = (p.hueFrom + (p.hueTo - p.hueFrom) * t) | 0;
      ctx.fillStyle = `hsla(${hue}, 100%, 55%, ${(a * 0.16).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 3.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `hsla(${hue}, 100%, ${(60 + 20 * (1 - t)) | 0}%, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    };

    const drawCoin = (p: Particle) => {
      // cos(spin) collapses the ellipse width through the flip — the whole
      // "3D spinning coin" illusion in one term. Sign picks front/back face.
      const face = Math.cos(p.spin);
      const rx = Math.max(Math.abs(face) * p.size, 1.1);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx, p.size, p.tilt, 0, TAU);
      ctx.fillStyle = face > 0 ? '#f5c542' : '#c9992d';
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = '#7d5f10';
      ctx.stroke();
      if (Math.abs(face) > 0.35) {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx * 0.55, p.size * 0.55, p.tilt, 0, TAU);
        ctx.fillStyle = face > 0 ? 'rgba(255, 238, 170, 0.95)' : 'rgba(173, 129, 40, 0.95)';
        ctx.fill();
      }
    };

    const step = (dt: number) => {
      const maxParticles = optionsRef.current.maxParticles ?? defaults.maxParticles;

      if (type === 'embers' && runningRef.current) {
        const rate = optionsRef.current.emissionRate ?? defaults.emissionRate;
        emitAcc += rate * dt;
        while (emitAcc >= 1) {
          emitAcc -= 1;
          if (live.length < maxParticles) spawnEmber();
        }
      }

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = type === 'embers' ? 'lighter' : 'source-over';

      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.age += dt;
        let dead: boolean;
        if (type === 'embers') {
          p.y += p.vy * dt;
          p.x += Math.sin(p.age * p.freq * TAU + p.phase) * p.amp * dt;
          dead = p.age >= p.maxLife || p.y < -14;
        } else {
          p.vy += COIN_GRAVITY * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.spin += p.spinSpeed * dt;
          dead = p.age >= p.maxLife || (p.vy > 0 && p.y > h + 60);
        }
        if (dead) {
          // Swap-remove keeps the array dense; the corpse goes back to the
          // pool instead of the GC. Iterating backwards makes this safe.
          live[i] = live[live.length - 1];
          live.pop();
          pool.push(p);
          continue;
        }
        if (type === 'embers') drawEmber(p);
        else drawCoin(p);
      }

      ctx.globalCompositeOperation = 'source-over';
    };

    const shouldRun = () => (type === 'embers' && runningRef.current) || live.length > 0;

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_DT);
      last = now;
      step(dt);
      if (live.length === 0 && !shouldRun()) {
        stopLoop();
        ctx.clearRect(0, 0, w, h);
      }
    };

    const startLoop = () => {
      if (rafId !== null || document.hidden) return;
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    };

    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const burst = (opts: BurstOptions = {}) => {
      const maxParticles = optionsRef.current.maxParticles ?? defaults.maxParticles;
      const count = opts.count ?? (type === 'coins' ? 70 : 24);
      const cx = opts.x ?? w / 2;
      const cy = opts.y ?? (type === 'coins' ? h * 0.85 : h * 0.5);
      for (let i = 0; i < count && live.length < maxParticles; i++) {
        if (type === 'coins') spawnCoin(cx, cy);
        else spawnEmber(cx, cy);
      }
      startLoop();
    };

    const clearAll = () => {
      while (live.length > 0) pool.push(live.pop() as Particle);
      ctx.clearRect(0, 0, w, h);
    };

    const onVisibility = () => {
      if (document.hidden) stopLoop();
      else if (shouldRun()) startLoop();
    };

    resize();
    window.addEventListener('resize', resize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);

    controlsRef.current = {
      burst,
      syncRunning: () => {
        if (shouldRun()) startLoop();
        // When emission stops, live embers finish their lives and the loop
        // self-suspends — a graceful trail-off instead of a hard cut.
      },
      clear: clearAll,
    };

    // Flush bursts requested before the canvas mounted.
    pendingBurstsRef.current.splice(0).forEach(burst);

    if (shouldRun()) startLoop();

    return () => {
      stopLoop();
      window.removeEventListener('resize', resize);
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      controlsRef.current = null;
    };
  }, [canvasRef, type]);

  const burst = useCallback((opts?: BurstOptions) => {
    const controls = controlsRef.current;
    if (controls) controls.burst(opts);
    else pendingBurstsRef.current.push(opts ?? {});
  }, []);

  const setRunning = useCallback((running: boolean) => {
    runningRef.current = running;
    controlsRef.current?.syncRunning();
  }, []);

  const clear = useCallback(() => {
    controlsRef.current?.clear();
  }, []);

  return { burst, setRunning, clear };
}
