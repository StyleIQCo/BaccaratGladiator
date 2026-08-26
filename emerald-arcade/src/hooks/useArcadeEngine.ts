'use client';

/**
 * useArcadeEngine — the shared HTML5 canvas engine every Emerald City
 * Arcade mini-game inherits. One hook = the whole platform layer: game
 * loop, resize, input, audio. A mini-game only supplies update/render.
 *
 * Performance contract (mirrors useCanvasParticles):
 * - ONE <canvas>, one rAF loop, zero React state in the hot path. The
 *   caller's callbacks are read through a ref every frame, so games can
 *   pass fresh closures each render without tearing the loop down.
 * - Simulation locked to 60 Hz via a fixed-timestep accumulator: render
 *   runs at the display's native rAF rate (60/90/120 Hz), but `update`
 *   is ALWAYS called with dt = 1/60 s. Identical physics on a ProMotion
 *   iPhone and a budget Android — no per-device speed drift.
 * - Frame delta clamped and steps-per-frame capped, so a tab switch or a
 *   GC pause never teleports entities or spirals the sim to death.
 * - DPR capped at 2 (3x retina is pure fill-rate cost on mobile); the
 *   context is pre-scaled so games draw in logical CSS pixels.
 * - The loop self-suspends on document.hidden and resumes cleanly.
 *
 * Input: pointer events unify touch + mouse; coordinates are normalized
 * to logical canvas pixels via getBoundingClientRect, so CSS scaling of
 * the element never skews hit-tests. touch-action is disabled on the
 * canvas so drags don't scroll the host page.
 *
 * Audio: `playSound(key)` drives a shared WebAudio synth — every SFX is
 * synthesized, zero audio files to ship (the same reason the prototype
 * draws its sprites natively: no asset pipeline required to add a game).
 * iOS/Android autoplay policy is handled by one-time unlock gestures.
 */

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';

// ---------------------------------------------------------------------------
// Audio synth (module-level singleton, shared by the hub and every game)
// ---------------------------------------------------------------------------

export type ArcadeSfxKey =
  | 'coin_insert' // arcade coin drop — hub card select / run start
  | 'catch_good' // small positive pop
  | 'catch_gold' // rare-catch arpeggio
  | 'catch_bad' // penalty buzz
  | 'tick' // countdown blip
  | 'whoosh' // transition sweep
  | 'game_over' // end-of-run sting
  | 'fanfare' // reward payout
  | 'clank' // locked / denied
  | 'click'; // generic UI tap

export interface PlayArcadeSfxOptions {
  volume?: number;
}

class ArcadeAudioSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Safe to call from any user gesture; resumes a suspended context. */
  unlock() {
    this.ensure();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.9;
  }

  private tone(
    f0: number,
    f1: number,
    dur: number,
    o: { type?: OscillatorType; at?: number; vol?: number } = {},
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    const vol = o.vol ?? 0.4;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(
    dur: number,
    o: { at?: number; vol?: number; type?: BiquadFilterType; from?: number; to?: number } = {},
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    if (!this.noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type ?? 'lowpass';
    filt.frequency.setValueAtTime(Math.max(1, o.from ?? 1200), t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(1, o.to ?? 300), t0 + dur);
    filt.Q.value = 1.2;
    const g = ctx.createGain();
    const vol = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  play(key: ArcadeSfxKey, opts: PlayArcadeSfxOptions = {}) {
    const v = Math.min(1, Math.max(0, opts.volume ?? 1));
    switch (key) {
      case 'coin_insert':
        // Metallic slot scrape, two coin rings, then the mech accepting it.
        this.noise(0.09, { type: 'bandpass', from: 2600, to: 900, vol: 0.28 * v });
        this.tone(1320, 990, 0.08, { type: 'square', at: 0.03, vol: 0.16 * v });
        this.tone(660, 540, 0.1, { type: 'square', at: 0.11, vol: 0.14 * v });
        this.tone(190, 90, 0.14, { type: 'triangle', at: 0.19, vol: 0.4 * v });
        break;
      case 'catch_good':
        this.tone(620, 920, 0.09, { type: 'sine', vol: 0.35 * v });
        break;
      case 'catch_gold':
        this.tone(784, 784, 0.11, { type: 'triangle', vol: 0.3 * v });
        this.tone(988, 988, 0.11, { type: 'triangle', at: 0.07, vol: 0.3 * v });
        this.tone(1319, 1319, 0.16, { type: 'triangle', at: 0.14, vol: 0.32 * v });
        break;
      case 'catch_bad':
        this.tone(220, 105, 0.24, { type: 'sawtooth', vol: 0.26 * v });
        this.noise(0.16, { type: 'lowpass', from: 900, to: 180, vol: 0.22 * v });
        break;
      case 'tick':
        this.tone(1150, 1150, 0.045, { type: 'square', vol: 0.16 * v });
        break;
      case 'whoosh':
        this.noise(0.32, { type: 'highpass', from: 380, to: 2600, vol: 0.2 * v });
        break;
      case 'game_over':
        this.tone(523, 523, 0.13, { type: 'triangle', vol: 0.32 * v });
        this.tone(392, 392, 0.13, { type: 'triangle', at: 0.15, vol: 0.32 * v });
        this.tone(330, 262, 0.34, { type: 'triangle', at: 0.3, vol: 0.34 * v });
        break;
      case 'fanfare':
        this.tone(523, 523, 0.1, { type: 'square', vol: 0.18 * v });
        this.tone(659, 659, 0.1, { type: 'square', at: 0.08, vol: 0.18 * v });
        this.tone(784, 784, 0.1, { type: 'square', at: 0.16, vol: 0.18 * v });
        this.tone(1047, 1047, 0.28, { type: 'square', at: 0.24, vol: 0.2 * v });
        break;
      case 'clank':
        this.noise(0.12, { type: 'bandpass', from: 3200, to: 700, vol: 0.3 * v });
        this.tone(210, 160, 0.16, { type: 'square', vol: 0.22 * v });
        break;
      case 'click':
        this.tone(1900, 1500, 0.03, { type: 'square', vol: 0.12 * v });
        break;
    }
  }
}

let audioSingleton: ArcadeAudioSynth | null = null;

export function getArcadeAudio(): ArcadeAudioSynth {
  if (!audioSingleton) audioSingleton = new ArcadeAudioSynth();
  return audioSingleton;
}

/** Fire-and-forget SFX for non-canvas UI (the hub) — SSR-safe no-op. */
export function playArcadeSfx(key: ArcadeSfxKey, opts?: PlayArcadeSfxOptions) {
  if (typeof window === 'undefined') return;
  getArcadeAudio().play(key, opts);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface ArcadeSize {
  /** Logical canvas width/height in CSS pixels — draw in these units. */
  w: number;
  h: number;
  dpr: number;
}

export interface ArcadePointer {
  x: number;
  y: number;
  id: number;
}

export interface ArcadeInput {
  /** Latest pointer position in logical canvas px (null until first contact). */
  pointer: ArcadePointer | null;
  isDown: boolean;
}

export interface ArcadeEngineCallbacks {
  /** Fixed-timestep simulation step — ALWAYS called with dt = 1/60 s. */
  update: (dt: number, input: ArcadeInput, size: ArcadeSize) => void;
  /** Draw pass — once per rAF after pending updates; ctx draws in logical px. */
  render: (ctx: CanvasRenderingContext2D, size: ArcadeSize) => void;
  onPointerDown?: (p: ArcadePointer, size: ArcadeSize) => void;
  onPointerMove?: (p: ArcadePointer, size: ArcadeSize) => void;
  onPointerUp?: (p: ArcadePointer, size: ArcadeSize) => void;
  onResize?: (size: ArcadeSize) => void;
}

export interface ArcadeEngineOptions {
  /** Device-pixel-ratio cap. Default 2. */
  dprCap?: number;
  /** Start the loop as soon as the canvas mounts. Default false. */
  autoStart?: boolean;
}

export interface ArcadeEngineApi {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  playSound: (key: ArcadeSfxKey, opts?: PlayArcadeSfxOptions) => void;
  getSize: () => ArcadeSize;
}

const SIM_STEP = 1 / 60;
/** Clamp: a long GC pause or tab switch must not produce a giant frame. */
const MAX_FRAME_DT = 0.1;
/** Cap catch-up steps per frame; beyond this the backlog is dropped. */
const MAX_STEPS_PER_FRAME = 5;

interface EngineControls {
  syncRunning: () => void;
}

export function useArcadeEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  callbacks: ArcadeEngineCallbacks,
  options: ArcadeEngineOptions = {},
): ArcadeEngineApi {
  // Callbacks/options are read through refs every frame, so callers can
  // pass fresh closures each render without restarting the engine.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const runningRef = useRef(options.autoStart ?? false);
  const controlsRef = useRef<EngineControls | null>(null);
  const sizeRef = useRef<ArcadeSize>({ w: 0, h: 0, dpr: 1 });

  // One-time autoplay unlock: any gesture anywhere primes the synth.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const unlock = () => getArcadeAudio().unlock();
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'touchstart', 'keydown'];
    events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';

    const size = sizeRef.current;
    const input: ArcadeInput = { pointer: null, isDown: false };

    let rafId: number | null = null;
    let last = 0;
    let acc = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, optionsRef.current.dprCap ?? 2);
      size.w = canvas.clientWidth;
      size.h = canvas.clientHeight;
      size.dpr = dpr;
      canvas.width = Math.max(1, Math.round(size.w * dpr));
      canvas.height = Math.max(1, Math.round(size.h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      callbacksRef.current.onResize?.({ ...size });
    };

    // Normalize viewport px → logical canvas px through the element's actual
    // on-screen rect, so CSS transforms/scaling never skew hit-tests.
    const toLocal = (e: PointerEvent): ArcadePointer => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width > 0 ? size.w / rect.width : 1;
      const sy = rect.height > 0 ? size.h / rect.height : 1;
      return {
        x: (e.clientX - rect.left) * sx,
        y: (e.clientY - rect.top) * sy,
        id: e.pointerId,
      };
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      getArcadeAudio().unlock();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best-effort; window-level move/up still track the drag.
      }
      const p = toLocal(e);
      input.pointer = p;
      input.isDown = true;
      callbacksRef.current.onPointerDown?.(p, size);
    };

    const onMove = (e: PointerEvent) => {
      // During a drag, ignore secondary touches so a stray palm can't yank
      // the tracked pointer.
      if (input.isDown && input.pointer && e.pointerId !== input.pointer.id) return;
      const p = toLocal(e);
      input.pointer = p;
      callbacksRef.current.onPointerMove?.(p, size);
    };

    const onUp = (e: PointerEvent) => {
      if (input.isDown && input.pointer && e.pointerId !== input.pointer.id) return;
      const p = toLocal(e);
      input.pointer = p;
      input.isDown = false;
      callbacksRef.current.onPointerUp?.(p, size);
    };

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_FRAME_DT);
      last = now;
      acc += dt;
      let steps = 0;
      while (acc >= SIM_STEP && steps < MAX_STEPS_PER_FRAME) {
        callbacksRef.current.update(SIM_STEP, input, size);
        acc -= SIM_STEP;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0; // drop backlog, never spiral
      callbacksRef.current.render(ctx, size);
    };

    const startLoop = () => {
      if (rafId !== null || document.hidden) return;
      last = performance.now();
      acc = 0;
      rafId = requestAnimationFrame(frame);
    };

    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const onVisibility = () => {
      if (document.hidden) stopLoop();
      else if (runningRef.current) startLoop();
    };

    resize();
    window.addEventListener('resize', resize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    controlsRef.current = {
      syncRunning: () => {
        if (runningRef.current) startLoop();
        else stopLoop();
      },
    };

    if (runningRef.current) startLoop();

    return () => {
      stopLoop();
      window.removeEventListener('resize', resize);
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      controlsRef.current = null;
    };
  }, [canvasRef]);

  const start = useCallback(() => {
    runningRef.current = true;
    controlsRef.current?.syncRunning();
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    controlsRef.current?.syncRunning();
  }, []);

  const isRunning = useCallback(() => runningRef.current, []);

  const playSound = useCallback((key: ArcadeSfxKey, opts?: PlayArcadeSfxOptions) => {
    playArcadeSfx(key, opts);
  }, []);

  const getSize = useCallback((): ArcadeSize => ({ ...sizeRef.current }), []);

  return useMemo(
    () => ({ start, stop, isRunning, playSound, getSize }),
    [start, stop, isRunning, playSound, getSize],
  );
}
