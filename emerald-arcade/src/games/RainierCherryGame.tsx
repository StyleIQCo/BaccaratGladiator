'use client';

/**
 * RainierCherryGame — the first Emerald City Arcade game, built to prove
 * the useArcadeEngine architecture. A 60-second orchard catching game:
 * drag a woven basket, catch cherries, dodge the rot.
 *
 *   Bing cherry (dark red)         +10   medium fall, gentle sway
 *   Rainier cherry (gold + blush)  +50   fast, straight drop
 *   Rotten / bird-pecked (brown)   −20   medium fall, drunken sway
 *
 * Architecture notes (the template every later game copies):
 * - React owns only the PHASE ('ready' | 'playing' | 'over') and its
 *   overlays. Everything at 60 fps — cherries, basket, particles, score,
 *   timer — lives in one sim ref and is drawn on the canvas by the
 *   engine's render callback. Zero React re-renders during play.
 * - Every sprite is drawn natively with canvas paths — no images, no
 *   asset pipeline. The static backdrop (dusk sky, Mount Rainier,
 *   orchard rows) is rendered ONCE per resize into an offscreen canvas
 *   and blitted each frame, so per-frame cost is sprites only.
 * - Object pools with swap-remove for cherries/particles/floaters:
 *   steady state allocates nothing per frame.
 * - All speeds are scaled by canvas height against a reference viewport,
 *   so fall times feel identical on a phone and a desktop window.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useArcadeEngine,
  type ArcadeInput,
  type ArcadeSize,
} from '../hooks/useArcadeEngine';
import { getArcadeGame } from '../data/emeraldArcadeData';

export interface RainierCherryResult {
  score: number;
  /** Score clamped to [0, dailyRewardLimit] — what the faucet pays out. */
  chips: number;
}

export interface RainierCherryGameProps {
  onComplete: (result: RainierCherryResult) => void;
  onExit: () => void;
  /** Run length in seconds. Default 60. */
  durationSec?: number;
}

type Phase = 'ready' | 'playing' | 'over';
type CherryKind = 'bing' | 'rainier' | 'rotten';

const TAU = Math.PI * 2;
/** Reference viewport height — fall speeds are tuned against this. */
const REF_H = 812;
const GAME_ID = 'rainier-cherry-picker';

const POINTS: Record<CherryKind, number> = { bing: 10, rainier: 50, rotten: -20 };

/** Smoke-test hook: with ?eadebug in the URL, the live sim is exposed on
 *  the canvas element so the harness auto-player can chase cherries. */
const EA_DEBUG = typeof location !== 'undefined' && location.search.includes('eadebug');

interface Cherry {
  kind: CherryKind;
  x: number;
  y: number;
  vy: number;
  r: number;
  age: number;
  swayPhase: number;
  swayFreq: number;
  swayAmp: number;
}

interface Pop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  maxLife: number;
  size: number;
  color: string;
}

interface Floater {
  x: number;
  y: number;
  age: number;
  text: string;
  color: string;
}

interface Sim {
  score: number;
  /** Total cherries caught (any kind) — smoke assertions read this. */
  caught: number;
  timeLeft: number;
  elapsed: number;
  basketX: number;
  spawnAcc: number;
  lastTickSec: number;
  badFlash: number;
  cherries: Cherry[];
  cherryPool: Cherry[];
  pops: Pop[];
  popPool: Pop[];
  floaters: Floater[];
  floaterPool: Floater[];
  bg: HTMLCanvasElement | null;
  bgKey: string;
}

const makeCherry = (): Cherry => ({
  kind: 'bing', x: 0, y: 0, vy: 0, r: 12, age: 0,
  swayPhase: 0, swayFreq: 0, swayAmp: 0,
});
const makePop = (): Pop => ({
  x: 0, y: 0, vx: 0, vy: 0, age: 0, maxLife: 1, size: 2, color: '#fff',
});
const makeFloater = (): Floater => ({ x: 0, y: 0, age: 0, text: '', color: '#fff' });

const freshSim = (durationSec: number): Sim => ({
  score: 0,
  caught: 0,
  timeLeft: durationSec,
  elapsed: 0,
  basketX: -1, // sentinel: centered on first update once size is known
  spawnAcc: 0,
  lastTickSec: Math.ceil(durationSec),
  badFlash: 0,
  cherries: [],
  cherryPool: [],
  pops: [],
  popPool: [],
  floaters: [],
  floaterPool: [],
  bg: null,
  bgKey: '',
});

const basketWidth = (size: ArcadeSize) => Math.min(Math.max(size.w * 0.24, 88), 140);
const basketTop = (size: ArcadeSize) => size.h - Math.max(size.h * 0.13, 92);

// ---------------------------------------------------------------------------
// Backdrop — painted once per resize into an offscreen canvas
// ---------------------------------------------------------------------------

function paintBackdrop(size: ArcadeSize): HTMLCanvasElement {
  const { w, h, dpr } = size;
  const bg = document.createElement('canvas');
  bg.width = Math.max(1, Math.round(w * dpr));
  bg.height = Math.max(1, Math.round(h * dpr));
  const ctx = bg.getContext('2d');
  if (!ctx) return bg;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Golden-hour sky — the one sunny day of the Seattle year.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#6fb2e8');
  sky.addColorStop(0.45, '#a8cbe8');
  sky.addColorStop(0.72, '#ffd9a0');
  sky.addColorStop(1, '#ffb87a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Sun low over the foothills.
  const sunX = w * 0.78;
  const sunY = h * 0.42;
  const sun = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, w * 0.3);
  sun.addColorStop(0, 'rgba(255, 244, 214, 0.95)');
  sun.addColorStop(0.25, 'rgba(255, 224, 160, 0.4)');
  sun.addColorStop(1, 'rgba(255, 224, 160, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  // Mount Rainier — a broad, flattened dome (it's a shield of a mountain,
  // not a Fuji cone), with a wide snow cap.
  const baseY = h * 0.58;
  const peakX = w * 0.42;
  const peakY = h * 0.33;
  ctx.beginPath();
  ctx.moveTo(-w * 0.2, baseY);
  ctx.quadraticCurveTo(peakX * 0.4, baseY - (baseY - peakY) * 0.72, peakX * 0.62, peakY + 12);
  ctx.quadraticCurveTo(peakX * 0.86, peakY - 16, peakX * 1.06, peakY - 4);
  ctx.quadraticCurveTo(peakX * 1.26, peakY - 12, peakX * 1.44, peakY + 16);
  ctx.quadraticCurveTo(w * 0.82, baseY - (baseY - peakY) * 0.62, w * 1.2, baseY);
  ctx.closePath();
  ctx.fillStyle = '#7d90b8';
  ctx.fill();

  // Snow cap — wide, with a melt-line scalloped along the bottom.
  ctx.beginPath();
  ctx.moveTo(peakX * 0.58, peakY + 16);
  ctx.quadraticCurveTo(peakX * 0.86, peakY - 20, peakX * 1.06, peakY - 8);
  ctx.quadraticCurveTo(peakX * 1.28, peakY - 16, peakX * 1.48, peakY + 20);
  ctx.quadraticCurveTo(peakX * 1.3, peakY + 44, peakX * 1.18, peakY + 30);
  ctx.quadraticCurveTo(peakX * 1.06, peakY + 58, peakX * 0.94, peakY + 34);
  ctx.quadraticCurveTo(peakX * 0.8, peakY + 52, peakX * 0.58, peakY + 16);
  ctx.closePath();
  ctx.fillStyle = '#f4f7ff';
  ctx.fill();

  // Foothill evergreen band.
  ctx.fillStyle = '#3c5a4a';
  ctx.beginPath();
  ctx.moveTo(0, baseY + 6);
  for (let x = 0; x <= w; x += 14) {
    ctx.lineTo(x + 7, baseY - 8 - ((x * 7919) % 17));
    ctx.lineTo(x + 14, baseY + 6);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // Orchard ground.
  const ground = ctx.createLinearGradient(0, baseY, 0, h);
  ground.addColorStop(0, '#7fae5a');
  ground.addColorStop(1, '#4c7a3a');
  ctx.fillStyle = ground;
  ctx.fillRect(0, baseY + 4, w, h - baseY);

  // Converging orchard rows for depth.
  ctx.strokeStyle = 'rgba(46, 82, 34, 0.4)';
  ctx.lineWidth = 2;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.5 + i * w * 0.09, baseY + 10);
    ctx.lineTo(w * 0.5 + i * w * 0.42, h);
    ctx.stroke();
  }

  // Overhanging bough across the top — where the cherries fall from.
  ctx.fillStyle = '#4a3220';
  ctx.beginPath();
  ctx.moveTo(-10, -12);
  ctx.quadraticCurveTo(w * 0.35, 34, w * 0.72, 16);
  ctx.quadraticCurveTo(w * 0.9, 8, w + 10, 22);
  ctx.lineTo(w + 10, -12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3e6b30';
  for (let i = 0; i < 14; i++) {
    const lx = ((i * 2654435761) % 1000) / 1000 * w;
    const ly = 6 + ((i * 40503) % 26);
    ctx.beginPath();
    ctx.ellipse(lx, ly, 16, 8, (i % 5) * 0.5 - 1, 0, TAU);
    ctx.fill();
  }

  return bg;
}

// ---------------------------------------------------------------------------
// Sprites — all native canvas paths, no images
// ---------------------------------------------------------------------------

function drawCherry(ctx: CanvasRenderingContext2D, c: Cherry) {
  const { x, y, r } = c;

  // Stem + leaf.
  ctx.strokeStyle = c.kind === 'rotten' ? '#5a4632' : '#5f4526';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.6);
  ctx.quadraticCurveTo(x + r * 0.5, y - r * 1.7, x + r * 0.2, y - r * 2.1);
  ctx.stroke();
  if (c.kind !== 'rotten') {
    ctx.fillStyle = '#4f8a3d';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.55, y - r * 1.75, r * 0.55, r * 0.26, -0.6, 0, TAU);
    ctx.fill();
  }

  if (c.kind === 'bing') {
    ctx.fillStyle = '#8e1030';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.35, r * 0.28, r * 0.18, -0.7, 0, TAU);
    ctx.fill();
  } else if (c.kind === 'rainier') {
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    // Red blush on the sun side — the Rainier signature.
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = 'rgba(235, 80, 90, 0.75)';
    ctx.beginPath();
    ctx.arc(x + r * 0.55, y + r * 0.15, r * 0.85, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.35, r * 0.28, r * 0.18, -0.7, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = '#6b4a2a';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    // Bird-peck gashes.
    ctx.fillStyle = '#3a2412';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.3, y - r * 0.2, r * 0.3, r * 0.18, 0.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y + r * 0.3, r * 0.22, r * 0.13, -0.4, 0, TAU);
    ctx.fill();
    // Sickly sheen.
    ctx.fillStyle = 'rgba(164, 196, 120, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.2, y - r * 0.45, r * 0.3, r * 0.14, -0.6, 0, TAU);
    ctx.fill();
  }
}

function drawBasket(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number) {
  const h = w * 0.52;
  const halfTop = w / 2;
  const halfBot = w * 0.36;

  // Body.
  ctx.beginPath();
  ctx.moveTo(cx - halfTop, top);
  ctx.lineTo(cx - halfBot, top + h);
  ctx.quadraticCurveTo(cx, top + h + 10, cx + halfBot, top + h);
  ctx.lineTo(cx + halfTop, top);
  ctx.closePath();
  const body = ctx.createLinearGradient(0, top, 0, top + h);
  body.addColorStop(0, '#b07a36');
  body.addColorStop(1, '#7c4f1d');
  ctx.fillStyle = body;
  ctx.fill();

  // Horizontal weave bands.
  ctx.strokeStyle = 'rgba(60, 36, 12, 0.55)';
  ctx.lineWidth = 2;
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const y = top + h * t;
    const half = halfTop + (halfBot - halfTop) * t;
    ctx.beginPath();
    ctx.moveTo(cx - half, y);
    ctx.quadraticCurveTo(cx, y + 6, cx + half, y);
    ctx.stroke();
  }
  // Vertical weave stitches.
  ctx.strokeStyle = 'rgba(201, 141, 67, 0.7)';
  ctx.lineWidth = 3;
  for (let i = -3; i <= 3; i++) {
    const tx = cx + (i / 3.6) * halfTop;
    const bx = cx + (i / 3.6) * halfBot;
    ctx.beginPath();
    ctx.moveTo(tx, top + 3);
    ctx.lineTo(bx, top + h - 2);
    ctx.stroke();
  }

  // Rim.
  ctx.beginPath();
  ctx.ellipse(cx, top, halfTop, 7, 0, 0, TAU);
  ctx.fillStyle = '#5e3c14';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, top - 1.5, halfTop, 5.5, 0, 0, TAU);
  ctx.fillStyle = '#c98d43';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, top, halfTop * 0.82, 4, 0, 0, TAU);
  ctx.fillStyle = '#4a2e0e';
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RainierCherryGame({
  onComplete,
  onExit,
  durationSec = 60,
}: RainierCherryGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const phaseRef = useRef<Phase>('ready');
  const [finalScore, setFinalScore] = useState(0);

  const simRef = useRef<Sim>(freshSim(durationSec));

  const rewardLimit = getArcadeGame(GAME_ID)?.dailyRewardLimit ?? 5000;

  const spawnCherry = useCallback((sim: Sim, size: ArcadeSize) => {
    const c = sim.cherryPool.pop() ?? makeCherry();
    const roll = Math.random();
    c.kind = roll < 0.2 ? 'rainier' : roll < 0.45 ? 'rotten' : 'bing';
    const hScale = size.h / REF_H;
    const ramp = 1 + Math.min(0.5, sim.elapsed * 0.008);
    c.r = c.kind === 'rainier' ? 11 : 13;
    c.x = 24 + Math.random() * Math.max(1, size.w - 48);
    c.y = -c.r * 2.5;
    c.age = 0;
    if (c.kind === 'rainier') {
      c.vy = (400 + Math.random() * 70) * hScale * ramp; // fast, straight
      c.swayAmp = 0;
      c.swayFreq = 0;
    } else if (c.kind === 'bing') {
      c.vy = (225 + Math.random() * 45) * hScale * ramp;
      c.swayAmp = 26 + Math.random() * 22;
      c.swayFreq = 0.5 + Math.random() * 0.5;
    } else {
      c.vy = (265 + Math.random() * 55) * hScale * ramp;
      c.swayAmp = 46 + Math.random() * 30; // drunken wobble
      c.swayFreq = 0.9 + Math.random() * 0.7;
    }
    c.swayPhase = Math.random() * TAU;
    sim.cherries.push(c);
  }, []);

  const burstPops = useCallback((sim: Sim, x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const p = sim.popPool.pop() ?? makePop();
      const a = Math.random() * TAU;
      const speed = 60 + Math.random() * 160;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * speed;
      p.vy = Math.sin(a) * speed - 70;
      p.age = 0;
      p.maxLife = 0.4 + Math.random() * 0.3;
      p.size = 2 + Math.random() * 3;
      p.color = color;
      sim.pops.push(p);
    }
  }, []);

  const engine = useArcadeEngine(canvasRef, {
    update: (dt: number, input: ArcadeInput, size: ArcadeSize) => {
      const sim = simRef.current;
      if (phaseRef.current !== 'playing' || size.w <= 0) return;

      sim.elapsed += dt;
      sim.timeLeft -= dt;
      sim.badFlash = Math.max(0, sim.badFlash - dt * 3);

      // Countdown ticks over the last five seconds.
      const sec = Math.max(0, Math.ceil(sim.timeLeft));
      if (sec !== sim.lastTickSec) {
        sim.lastTickSec = sec;
        if (sec > 0 && sec <= 5) engine.playSound('tick', { volume: 0.8 });
      }

      // Basket follows the drag, critically damped-ish lerp.
      const bw = basketWidth(size);
      if (sim.basketX < 0) sim.basketX = size.w / 2;
      if (input.isDown && input.pointer) {
        const target = Math.min(size.w - bw * 0.35, Math.max(bw * 0.35, input.pointer.x));
        sim.basketX += (target - sim.basketX) * Math.min(1, dt * 16);
      }

      // Spawn — ramps from ~1.05/s to ~2.1/s across the run.
      const rate = 1.05 + Math.min(1.05, sim.elapsed * 0.02);
      sim.spawnAcc += rate * dt;
      while (sim.spawnAcc >= 1) {
        sim.spawnAcc -= 1;
        spawnCherry(sim, size);
      }

      // Cherries.
      const bTop = basketTop(size);
      const halfCatch = bw * 0.46;
      for (let i = sim.cherries.length - 1; i >= 0; i--) {
        const c = sim.cherries[i];
        c.age += dt;
        c.y += c.vy * dt;
        if (c.swayAmp > 0) c.x += Math.sin(c.age * c.swayFreq * TAU + c.swayPhase) * c.swayAmp * dt;

        let remove = false;
        const inCatchBand = c.y + c.r >= bTop && c.y - c.r < bTop + 24;
        if (inCatchBand && Math.abs(c.x - sim.basketX) <= halfCatch) {
          const pts = POINTS[c.kind];
          sim.score = Math.max(0, sim.score + pts);
          sim.caught++;
          const f = sim.floaterPool.pop() ?? makeFloater();
          f.x = c.x;
          f.y = bTop - 14;
          f.age = 0;
          f.text = pts > 0 ? `+${pts}` : `${pts}`;
          f.color = c.kind === 'rainier' ? '#ffd75e' : c.kind === 'bing' ? '#ff9db1' : '#a8ff9d';
          if (c.kind === 'rotten') f.color = '#ff6b5e';
          sim.floaters.push(f);
          if (c.kind === 'bing') {
            engine.playSound('catch_good', { volume: 0.8 });
            burstPops(sim, c.x, bTop, '#c22045', 8);
          } else if (c.kind === 'rainier') {
            engine.playSound('catch_gold', { volume: 0.9 });
            burstPops(sim, c.x, bTop, '#ffd75e', 14);
          } else {
            engine.playSound('catch_bad', { volume: 0.9 });
            burstPops(sim, c.x, bTop, '#6b4a2a', 10);
            sim.badFlash = 1;
          }
          remove = true;
        } else if (c.y - c.r > size.h + 20) {
          remove = true;
        }

        if (remove) {
          sim.cherries[i] = sim.cherries[sim.cherries.length - 1];
          sim.cherries.pop();
          sim.cherryPool.push(c);
        }
      }

      // Splat particles.
      for (let i = sim.pops.length - 1; i >= 0; i--) {
        const p = sim.pops[i];
        p.age += dt;
        p.vy += 620 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.age >= p.maxLife) {
          sim.pops[i] = sim.pops[sim.pops.length - 1];
          sim.pops.pop();
          sim.popPool.push(p);
        }
      }

      // Score floaters.
      for (let i = sim.floaters.length - 1; i >= 0; i--) {
        const f = sim.floaters[i];
        f.age += dt;
        f.y -= 46 * dt;
        if (f.age >= 0.9) {
          sim.floaters[i] = sim.floaters[sim.floaters.length - 1];
          sim.floaters.pop();
          sim.floaterPool.push(f);
        }
      }

      // Time up.
      if (sim.timeLeft <= 0) {
        sim.timeLeft = 0;
        phaseRef.current = 'over';
        engine.playSound('game_over', { volume: 1 });
        engine.stop();
        setFinalScore(sim.score);
        setPhase('over');
      }
    },

    render: (ctx, size) => {
      const sim = simRef.current;
      if (EA_DEBUG && canvasRef.current) {
        (canvasRef.current as HTMLCanvasElement & { __eaSim?: Sim }).__eaSim = sim;
      }
      if (size.w <= 0) return;

      // Backdrop (rebuilt only when the canvas size actually changes).
      const key = `${size.w}x${size.h}@${size.dpr}`;
      if (!sim.bg || sim.bgKey !== key) {
        sim.bg = paintBackdrop(size);
        sim.bgKey = key;
      }
      ctx.drawImage(sim.bg, 0, 0, size.w, size.h);

      for (const c of sim.cherries) drawCherry(ctx, c);

      const bw = basketWidth(size);
      drawBasket(ctx, sim.basketX < 0 ? size.w / 2 : sim.basketX, basketTop(size), bw);

      for (const p of sim.pops) {
        const a = 1 - p.age / p.maxLife;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.textAlign = 'center';
      ctx.font = '800 20px system-ui, sans-serif';
      for (const f of sim.floaters) {
        ctx.globalAlpha = 1 - f.age / 0.9;
        ctx.fillStyle = f.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 3;
        ctx.strokeText(f.text, f.x, f.y);
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;

      // HUD — score chip (top-left), timer (top-right).
      const pad = 14;
      const hudY = pad + 22;
      ctx.textAlign = 'left';
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.arc(pad + 11, hudY - 8, 11, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#7d5f10';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 4;
      const scoreText = `${sim.score}`;
      ctx.strokeText(scoreText, pad + 30, hudY);
      ctx.fillText(scoreText, pad + 30, hudY);

      const sec = Math.max(0, Math.ceil(sim.timeLeft));
      const urgent = sec <= 5 && phaseRef.current === 'playing';
      ctx.textAlign = 'right';
      const pulse = urgent ? 1 + 0.14 * Math.sin(sim.elapsed * 10) : 1;
      ctx.font = `800 ${Math.round(24 * pulse)}px system-ui, sans-serif`;
      ctx.fillStyle = urgent ? '#ff4d5e' : '#fff';
      const timeText = `0:${String(sec).padStart(2, '0')}`;
      ctx.strokeText(timeText, size.w - pad, hudY);
      ctx.fillText(timeText, size.w - pad, hudY);

      // Rotten-catch sting.
      if (sim.badFlash > 0) {
        ctx.fillStyle = `rgba(255, 30, 60, ${(sim.badFlash * 0.22).toFixed(3)})`;
        ctx.fillRect(0, 0, size.w, size.h);
      }
    },
  });

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const handleStart = useCallback(() => {
    simRef.current = freshSim(durationSec);
    setFinalScore(0);
    phaseRef.current = 'playing';
    setPhase('playing');
    engine.playSound('coin_insert', { volume: 0.9 });
    engine.start();
  }, [durationSec, engine]);

  const chips = Math.max(0, Math.min(finalScore, rewardLimit));

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    background: 'rgba(8, 14, 24, 0.72)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    color: '#fff',
    fontFamily: "'Avenir Next', 'Trebuchet MS', system-ui, sans-serif",
    textAlign: 'center',
    padding: 24,
  };

  const btnStyle: React.CSSProperties = {
    padding: '14px 30px',
    borderRadius: 14,
    border: 'none',
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: '0.1em',
    cursor: 'pointer',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a1220' }} data-testid="cherry-game">
      <canvas
        ref={canvasRef}
        data-testid="cherry-canvas"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      <button
        type="button"
        onClick={onExit}
        aria-label="Exit game"
        data-testid="cherry-exit"
        style={{
          position: 'absolute',
          top: 'calc(10px + env(safe-area-inset-top))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.4)',
          background: 'rgba(6, 10, 18, 0.55)',
          color: '#fff',
          fontSize: 15,
          cursor: 'pointer',
          zIndex: 5,
        }}
      >
        ✕
      </button>

      <AnimatePresence>
        {phase === 'ready' && (
          <motion.div
            key="ready"
            data-testid="cherry-ready"
            style={overlayStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.h1
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '0.06em', color: '#ffd75e' }}
            >
              🍒 RAINIER CHERRY PICKER
            </motion.h1>
            <p style={{ margin: 0, maxWidth: 340, lineHeight: 1.5, color: 'rgba(220, 232, 250, 0.9)' }}>
              Drag the basket. Sixty seconds on the clock.
            </p>
            <div style={{ display: 'grid', gap: 6, fontSize: 15, fontWeight: 700 }}>
              <span style={{ color: '#ff9db1' }}>● Bing cherry — +10</span>
              <span style={{ color: '#ffd75e' }}>● Rainier cherry — +50 (falls fast!)</span>
              <span style={{ color: '#ff6b5e' }}>● Bird-pecked — −20, let it drop</span>
            </div>
            <motion.button
              type="button"
              data-testid="cherry-start"
              whileTap={{ scale: 0.94 }}
              onClick={handleStart}
              style={{ ...btnStyle, background: 'linear-gradient(180deg, #3dffb4, #1fbf82)', color: '#04160e' }}
            >
              ▶ Tap to Start
            </motion.button>
          </motion.div>
        )}

        {phase === 'over' && (
          <motion.div
            key="over"
            data-testid="cherry-over"
            style={overlayStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.h1
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              style={{ margin: 0, fontSize: 34, fontWeight: 800, color: '#ffd75e' }}
            >
              TIME!
            </motion.h1>
            <div style={{ fontSize: 18, color: 'rgba(220, 232, 250, 0.9)' }}>Final score</div>
            <div style={{ fontSize: 48, fontWeight: 800 }} data-testid="cherry-final-score">
              {finalScore}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ffd75e' }} data-testid="cherry-chips">
              ⛁ {chips.toLocaleString()} chips earned
              {finalScore > rewardLimit && (
                <span style={{ display: 'block', fontSize: 12, color: 'rgba(220,232,250,0.7)' }}>
                  (daily limit {rewardLimit.toLocaleString()})
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
              <motion.button
                type="button"
                data-testid="cherry-replay"
                whileTap={{ scale: 0.94 }}
                onClick={handleStart}
                style={{ ...btnStyle, background: 'rgba(255,255,255,0.14)', color: '#fff' }}
              >
                ↻ Play Again
              </motion.button>
              <motion.button
                type="button"
                data-testid="cherry-collect"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  engine.playSound('fanfare', { volume: 0.9 });
                  onComplete({ score: finalScore, chips });
                }}
                style={{ ...btnStyle, background: 'linear-gradient(180deg, #ffd75e, #d9a92e)', color: '#221602' }}
              >
                ⛁ Collect
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
