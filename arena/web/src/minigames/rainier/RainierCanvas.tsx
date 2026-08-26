// ═══════════════════════════════════════════════════════════════════
//  RAINIER SUMMIT SCRAMBLE — canvas renderer.
//
//  React's only jobs here: mount the <canvas>, wire pointer events,
//  own the rAF loop's lifecycle. Every frame goes straight through
//  physics.step() → draw() on refs — zero setState during play.
//
//  Art is 100% procedural (arc / bezier / fillStyle): a violet-dusk
//  alpine sky with alpenglow, the great white cone of Rainier drifting
//  by on slow parallax, foothill ridges that sink away as you climb,
//  falling snow — and the whole cast: blue-ice ledge slabs with
//  icicles, jagged tumbling seracs, glowing golden carabiners, and a
//  white-and-grey mountain goat with backswept horns.
//
//  The BLIZZARD lives here, not in physics — it is pure visibility
//  theatre (a semi-transparent whiteout sheet + sideways snow) and
//  never touches the sim: warn (rumble SFX, 1s) → whiteout (3s) →
//  clear. Ledges keep working; you just can't see them.
//
//  Renderer performance notes (same contract as FishTossCanvas):
//    • DPR capped at 2 — fill-rate over vanity.
//    • Sky gradient + star/snow/ridge fields built once per resize;
//      they advance by dt and wrap — no per-frame allocs.
//    • FX particles reuse the physics arrays' in-place compaction
//      trick, capped at 48 live particles.
//    • Pointer → logical-x uses a cached bounding rect (refreshed on
//      resize), not a layout query per pointermove.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import {
  useRainierPhysics, GOAT_W, GOAT_H, LEDGE_H, CARABINER_R,
  type GoatState, type Ledge, type Serac, type Carabiner, type GameOverReason,
} from './useRainierPhysics';
import { primeAudio, sfxBleat, sfxCollect, sfxGameOver, sfxLand, sfxRumble, sfxStart } from './rainierSfx';

export interface RainierCanvasProps {
  onGameOver: (finalScore: number, reason: GameOverReason, altitudeM: number) => void;
  runSeconds?: number;
  className?: string;
}

// Bouncy arcade-ish stack — best native match on iOS first, then Android/desktop.
const HUD_FONT = '"Chalkboard SE", "Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';

// What the goat hollers after a serac whistles past.
const DODGE_PHRASES = ['BAA!', 'NICE DODGE!', 'MEH-EH-EH!', 'TOO SLOW!'];

/** The goat's current holler: t counts up from the trigger. */
interface Reaction { t: number; dur: number; phrase: string }

interface Fx {
  kind: 'ice' | 'spark';
  x: number; y: number; vx: number; vy: number;   // world coords
  rot: number; rv: number;
  age: number; ttl: number; s: number;
  color: string;
}

// ── Deterministic helpers (no Math.random in the render loop) ──────

/** mulberry32 — tiny seeded PRNG for the ambient fields. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable jitter in [0,1) keyed off a seed. */
function jitter(seed: number, i: number): number {
  const x = Math.sin(seed + i * 7.13) * 43758.5453;
  return x - Math.floor(x);
}

interface Flake { x: number; y: number; r: number; v: number; sway: number }
interface Backdrop {
  sky: CanvasGradient;
  stars: Array<{ x: number; y: number; tw: number }>;
  flakes: Flake[];
  ridgeA: number[];   // normalized heights across the width, far foothills
  ridgeB: number[];   // nearer foothills
}

function buildBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): Backdrop {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#141b38');       // high-altitude night blue
  sky.addColorStop(0.55, '#3a4a75');
  sky.addColorStop(0.85, '#8a5f7a');    // alpenglow band
  sky.addColorStop(1, '#b57685');
  const rng = mulberry32(0x5ca1e);
  const stars: Array<{ x: number; y: number; tw: number }> = [];
  for (let i = 0; i < 26; i++) {
    stars.push({ x: rng() * w, y: rng() * h * 0.55, tw: 0.6 + rng() * 2.2 });
  }
  const flakes: Flake[] = [];
  for (let i = 0; i < 46; i++) {
    flakes.push({ x: rng() * w, y: rng() * h, r: 0.8 + rng() * 1.9, v: 26 + rng() * 60, sway: rng() * Math.PI * 2 });
  }
  const ridgeA: number[] = [];
  const ridgeB: number[] = [];
  for (let i = 0; i <= 12; i++) {
    ridgeA.push(0.12 + rng() * 0.16);
    ridgeB.push(0.16 + rng() * 0.22);
  }
  return { sky, stars, flakes, ridgeA, ridgeB };
}

// ── Path helpers ───────────────────────────────────────────────────

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ── Parallax scenery (screen-space) ────────────────────────────────

/** The mountain itself. `sink` is how far it has dropped below its
 *  start pose — the slow parallax that sells the climb. */
function drawPeak(ctx: CanvasRenderingContext2D, w: number, h: number, sink: number): void {
  const baseY = h * 0.9 + sink;
  const apexX = w * 0.56, apexY = baseY - h * 0.66;
  // Rock cone
  ctx.fillStyle = '#2c3757';
  ctx.beginPath();
  ctx.moveTo(-w * 0.15, baseY);
  ctx.lineTo(apexX, apexY);
  ctx.lineTo(w * 1.15, baseY);
  ctx.closePath();
  ctx.fill();
  // Snowcap with a sawtooth hem
  ctx.fillStyle = '#dfe9f5';
  ctx.beginPath();
  ctx.moveTo(apexX, apexY);
  const capT = 0.42; // fraction of each flank that stays snowbound
  const lx = apexX + (-w * 0.15 - apexX) * capT, ly = apexY + (baseY - apexY) * capT;
  const rx = apexX + (w * 1.15 - apexX) * capT, ry = ly;
  ctx.lineTo(rx, ry);
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = rx + (lx - rx) * t;
    ctx.lineTo(x, ry + (i % 2 ? 26 : 4) + jitter(3, i) * 10);
  }
  ctx.lineTo(lx, ly);
  ctx.closePath();
  ctx.fill();
  // Alpenglow on the sunlit flank + a couple of glacier seams
  ctx.fillStyle = 'rgba(255,170,150,0.18)';
  ctx.beginPath();
  ctx.moveTo(apexX, apexY);
  ctx.lineTo(rx, ry);
  ctx.lineTo(apexX + w * 0.06, apexY + (ry - apexY) * 1.15);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,150,190,0.35)';
  ctx.lineWidth = 2;
  for (const o of [-0.05, 0.04, 0.1]) {
    ctx.beginPath();
    ctx.moveTo(apexX + o * w, apexY + 20);
    ctx.quadraticCurveTo(apexX + o * w * 2.6, apexY + h * 0.2, apexX + o * w * 4, ly + 20);
    ctx.stroke();
  }
}

function drawRidge(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  heights: number[], yBase: number, color: string,
): void {
  if (yBase - h * 0.3 > h) return; // sunk out of sight — skip the path entirely
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h + 40);
  heights.forEach((k, i) => ctx.lineTo((i / (heights.length - 1)) * w, yBase - k * h));
  ctx.lineTo(w, h + 40);
  ctx.closePath();
  ctx.fill();
}

// ── Entities (world-space — drawn inside the camera translate) ─────

function drawLedge(ctx: CanvasRenderingContext2D, l: Ledge): void {
  const x0 = l.x - l.w / 2;
  // Slab body, sunlit top lip, shaded underside
  ctx.fillStyle = '#a8cfe3';
  rr(ctx, x0, l.y, l.w, LEDGE_H, 5); ctx.fill();
  ctx.fillStyle = '#eaf7ff';
  rr(ctx, x0, l.y, l.w, 5, 3); ctx.fill();
  ctx.fillStyle = '#6fa2c2';
  ctx.fillRect(x0 + 3, l.y + LEDGE_H - 3, l.w - 6, 3);
  // Icicles — count and shape keyed to the slab's seed
  ctx.fillStyle = 'rgba(207,234,247,0.9)';
  const n = 2 + Math.floor(jitter(l.seed, 0) * 3);
  for (let i = 0; i < n; i++) {
    const ix = x0 + 8 + jitter(l.seed, i + 1) * (l.w - 16);
    const len = 6 + jitter(l.seed, i + 5) * 9;
    ctx.beginPath();
    ctx.moveTo(ix - 3, l.y + LEDGE_H);
    ctx.lineTo(ix + 3, l.y + LEDGE_H);
    ctx.lineTo(ix, l.y + LEDGE_H + len);
    ctx.closePath();
    ctx.fill();
  }
  // A hairline crack
  ctx.strokeStyle = 'rgba(90,130,160,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const cx = x0 + jitter(l.seed, 9) * l.w;
  ctx.moveTo(cx, l.y + 4);
  ctx.lineTo(cx + 6, l.y + LEDGE_H - 2);
  ctx.stroke();
}

function drawSerac(ctx: CanvasRenderingContext2D, s: Serac): void {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.spin);
  // Jagged polygon from the boulder's seed — same shape every frame
  ctx.beginPath();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = s.r * (0.7 + jitter(s.seed, i) * 0.55);
    const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#c3e6f4';
  ctx.fill();
  ctx.strokeStyle = '#78aecb';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Inner facets
  ctx.strokeStyle = 'rgba(120,174,203,0.55)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-s.r * 0.4, -s.r * 0.3);
  ctx.lineTo(s.r * 0.2, s.r * 0.4);
  ctx.moveTo(s.r * 0.35, -s.r * 0.35);
  ctx.lineTo(-s.r * 0.1, s.r * 0.15);
  ctx.stroke();
  ctx.restore();
}

function drawCarabiner(ctx: CanvasRenderingContext2D, c: Carabiner): void {
  const y = c.y + Math.sin(c.phase) * 4;
  const glow = 0.14 + 0.08 * Math.sin(c.phase * 2);
  ctx.fillStyle = `rgba(255,223,107,${glow})`;
  dot(ctx, c.x, y, CARABINER_R * 2.2);
  // The gold oval body
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.ellipse(c.x, y, CARABINER_R * 0.72, CARABINER_R, 0.25, 0, Math.PI * 2);
  ctx.stroke();
  // Gate: the straight bar across one side
  ctx.strokeStyle = '#c9971e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c.x + CARABINER_R * 0.55, y - CARABINER_R * 0.55);
  ctx.lineTo(c.x + CARABINER_R * 0.2, y + CARABINER_R * 0.7);
  ctx.stroke();
  // Glint
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  dot(ctx, c.x - CARABINER_R * 0.4, y - CARABINER_R * 0.6, 2);
}

/** The star of the show. Drawn facing +x; flip via scale. Squash &
 *  stretch ride on landPulse (impact) and vy (airborne pose). */
function drawGoat(ctx: CanvasRenderingContext2D, g: GoatState, facing: number, landPulse: number): void {
  ctx.save();
  ctx.translate(g.x, g.y);
  const stretch = Math.min(Math.abs(g.vy) / 1600, 0.14);
  const sx = (1 + landPulse * 0.22 - stretch) * facing;
  const sy = 1 - landPulse * 0.28 + stretch;
  ctx.scale(sx, sy);

  const bodyW = GOAT_W, bodyH = GOAT_H * 0.62;
  // Legs: tucked back while rising, reaching down while falling
  const k = Math.min(Math.max(g.vy / 700, -1), 1);
  ctx.strokeStyle = '#e8e4dc';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.fillStyle = '#3a3438';
  for (const lx of [-14, -8, 8, 14]) {
    const hx = lx + (k > 0 ? 2 : -6);
    const hy = k > 0 ? 17 : 10;
    ctx.beginPath();
    ctx.moveTo(lx, bodyH * 0.3);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    dot(ctx, hx, hy + 2, 3); // hoof
  }
  // Body: white capsule with a grey saddle and shaded belly
  ctx.fillStyle = '#f4f2ec';
  ctx.beginPath();
  ctx.ellipse(0, 0, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9c5bc';
  ctx.beginPath();
  ctx.ellipse(-6, -bodyH * 0.22, bodyW * 0.3, bodyH * 0.24, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9d4ca';
  ctx.beginPath();
  ctx.ellipse(0, bodyH * 0.28, bodyW * 0.36, bodyH * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tail nub
  ctx.fillStyle = '#f4f2ec';
  dot(ctx, -bodyW / 2 + 1, -bodyH * 0.28, 4.5);

  // Head, leading the direction of travel
  const hx0 = bodyW / 2 + 2, hy0 = -bodyH * 0.55;
  // Horns first (behind the head): two backswept grey arcs
  ctx.strokeStyle = '#8d8f96';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(hx0 + 1, hy0 - 7);
  ctx.quadraticCurveTo(hx0 - 4, hy0 - 20, hx0 - 14, hy0 - 17);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx0 + 4, hy0 - 6);
  ctx.quadraticCurveTo(hx0 + 1, hy0 - 22, hx0 - 10, hy0 - 21);
  ctx.stroke();
  // Ear, head, snout
  ctx.fillStyle = '#e0dbd0';
  ctx.beginPath();
  ctx.ellipse(hx0 - 8, hy0 - 4, 6, 3.4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4f2ec';
  dot(ctx, hx0, hy0, 9);
  rr(ctx, hx0 + 3, hy0 - 2, 11, 8, 3.5);
  ctx.fill();
  ctx.fillStyle = '#3a3438';
  dot(ctx, hx0 + 13, hy0 + 2, 1.8);      // nose
  dot(ctx, hx0 + 3, hy0 - 2.5, 2);       // eye
  // Beard
  ctx.fillStyle = '#e0dbd0';
  ctx.beginPath();
  ctx.moveTo(hx0 + 2, hy0 + 7);
  ctx.lineTo(hx0 + 8, hy0 + 7);
  ctx.lineTo(hx0 + 4, hy0 + 15);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Component ──────────────────────────────────────────────────────

export function RainierCanvas({ onGameOver, runSeconds, className }: RainierCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxRef = useRef<Fx[]>([]);
  const reactionRef = useRef<Reaction | null>(null);
  const phraseTick = useRef(0);
  const landQueueRef = useRef<number[]>([]);     // x,y pairs — loop drains into ice chips
  const collectQueueRef = useRef<number[]>([]);  // x,y pairs — loop drains into sparks

  const physics = useRainierPhysics({
    runSeconds,
    onGameOver: (score, reason, altitudeM) => {
      sfxGameOver(reason);
      onGameOver(score, reason, altitudeM);
    },
    onLand: (x, y) => {
      sfxLand();
      landQueueRef.current.push(x, y);
    },
    onCollect: (x, y) => {
      sfxCollect();
      collectQueueRef.current.push(x, y);
    },
    onNearMiss: () => {
      sfxBleat();
      reactionRef.current = {
        t: 0, dur: 0.9,
        phrase: DODGE_PHRASES[phraseTick.current++ % DODGE_PHRASES.length],
      };
    },
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0, h = 0, dpr = 1;
    let backdrop: Backdrop | null = null;
    let rect = canvas.getBoundingClientRect();

    const resize = () => {
      rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      backdrop = buildBackdrop(ctx, w, h);
    };
    resize();
    window.addEventListener('resize', resize);
    physics.start(w, h);

    const onPointer = (e: PointerEvent) => {
      physics.setPointerX(e.clientX - rect.left);
    };
    const onPointerDown = (e: PointerEvent) => {
      primeAudio();       // second line of defense for the iOS gesture rule
      onPointer(e);
    };
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerdown', onPointerDown);
    sfxStart();

    let raf = 0;
    let last = performance.now();
    let t = 0;            // ambient clock (twinkle, bob, drift)
    let facing = 1;       // last confident travel direction

    // ── Blizzard state machine (visibility theatre only) ──
    let blizzMode: 'clear' | 'warn' | 'white' = 'clear';
    let blizzT = 8 + Math.random() * 5;   // seconds to the first warning
    let blizzK = 0;                       // whiteout intensity, 0 → 1

    const emitFx = (kind: Fx['kind'], x: number, y: number, n: number, color: string) => {
      const fx = fxRef.current;
      for (let i = 0; i < n && fx.length < 48; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = kind === 'spark' ? 50 + Math.random() * 110 : 80 + Math.random() * 150;
        fx.push({
          kind, x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - (kind === 'spark' ? 40 : 90),
          rot: Math.random() * Math.PI, rv: (Math.random() - 0.5) * 8,
          age: 0, ttl: 0.45 + Math.random() * 0.4, s: 2 + Math.random() * 3,
          color,
        });
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;

      physics.step(dt, w, h);
      if (!backdrop) return;

      const running = physics.statusRef.current === 'running';
      const goat = physics.goatRef.current;
      const camY = physics.camYRef.current;
      const climbed = Math.max(0, -camY);
      if (goat.vx > 20) facing = 1;
      else if (goat.vx < -20) facing = -1;

      // Drain FX requests queued by physics callbacks (allocation-light).
      const lq = landQueueRef.current;
      for (let i = 0; i < lq.length; i += 2) emitFx('ice', lq[i], lq[i + 1], 8, '#dff2fb');
      lq.length = 0;
      const cq = collectQueueRef.current;
      for (let i = 0; i < cq.length; i += 2) emitFx('spark', cq[i], cq[i + 1], 10, '#ffd23f');
      cq.length = 0;

      // ── Blizzard clock ──
      if (running) {
        blizzT -= dt;
        if (blizzMode === 'clear' && blizzT <= 0) {
          blizzMode = 'warn';
          blizzT = 1.0;
          sfxRumble();                       // the mountain clears its throat
        } else if (blizzMode === 'warn' && blizzT <= 0) {
          blizzMode = 'white';
          blizzT = 3.0;                      // the 3-second whiteout
        } else if (blizzMode === 'white' && blizzT <= 0) {
          blizzMode = 'clear';
          blizzT = 8 + Math.random() * 6;
        }
      }
      if (blizzMode === 'white' && running) {
        blizzK = Math.min(1, blizzK + dt * 2.5);
        if (blizzT < 0.7) blizzK = Math.min(blizzK, blizzT / 0.7);   // roll out
      } else {
        blizzK = Math.max(0, blizzK - dt * 2);
      }

      // ── Scene ──
      const shake = physics.shakeRef.current;
      ctx.save();
      if (shake > 0) {
        ctx.translate((jitter(t * 60, 1) - 0.5) * shake * 22, (jitter(t * 60, 2) - 0.5) * shake * 22);
      }

      // Sky + stars (screen-space)
      ctx.fillStyle = backdrop.sky;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < backdrop.stars.length; i++) {
        const s = backdrop.stars[i];
        ctx.fillStyle = `rgba(235,240,255,${0.25 + 0.5 * Math.abs(Math.sin(t * s.tw + i))})`;
        dot(ctx, s.x, s.y, 1.1);
      }

      // Parallax: the peak barely moves; the foothills sink away under you.
      drawPeak(ctx, w, h, climbed * 0.04);
      drawRidge(ctx, w, h, backdrop.ridgeA, h * 0.78 + climbed * 0.1, '#232c4a');
      drawRidge(ctx, w, h, backdrop.ridgeB, h * 0.94 + climbed * 0.18, '#1b2340');

      // ── World (camera translate) ──
      ctx.save();
      ctx.translate(0, -camY);

      for (const l of physics.ledgesRef.current) drawLedge(ctx, l);
      for (const c of physics.carabinersRef.current) drawCarabiner(ctx, c);
      drawGoat(ctx, goat, facing, physics.landPulseRef.current);
      for (const s of physics.seracsRef.current) drawSerac(ctx, s);

      // Goat's holler bubble
      const reaction = reactionRef.current;
      if (reaction) {
        reaction.t += dt;
        if (reaction.t >= reaction.dur) reactionRef.current = null;
        else {
          const k = reaction.t / reaction.dur;
          const pop = k < 0.2 ? k / 0.2 : 1;
          const fade = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
          ctx.save();
          ctx.globalAlpha = fade;
          ctx.font = `900 18px ${HUD_FONT}`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,15,25,0.85)';
          const ry = goat.y - 44 - pop * 10;
          ctx.strokeText(reaction.phrase, goat.x, ry);
          ctx.fillStyle = '#dff2fb';
          ctx.fillText(reaction.phrase, goat.x, ry);
          ctx.restore();
        }
      }

      // ── Particles (in-place compaction) ──
      const fx = fxRef.current;
      let write = 0;
      for (let i = 0; i < fx.length; i++) {
        const p = fx[i];
        p.age += dt;
        if (p.age >= p.ttl) continue;
        p.vy += (p.kind === 'spark' ? 150 : 500) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.rv * dt;
        ctx.save();
        ctx.globalAlpha = 1 - p.age / p.ttl;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.kind === 'ice') ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
        else dot(ctx, 0, 0, p.s * 0.6);
        ctx.restore();
        fx[write++] = p;
      }
      fx.length = write;

      // ── Score popups ──
      ctx.textAlign = 'center';
      for (const p of physics.popupsRef.current) {
        ctx.save();
        ctx.globalAlpha = 1 - p.age / p.ttl;
        ctx.font = `900 20px ${HUD_FONT}`;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,15,25,0.85)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      }

      ctx.restore(); // camera

      // ── Snow (screen-space; the blizzard bends it sideways) ──
      const wind = blizzK * 430;
      ctx.fillStyle = `rgba(240,248,255,${0.55 + blizzK * 0.4})`;
      for (let i = 0; i < backdrop.flakes.length; i++) {
        const f = backdrop.flakes[i];
        f.y += (f.v + physics.scrollSpeedRef.current * 0.4) * dt;
        f.x += (Math.sin(t * 1.3 + f.sway) * 18 - wind) * dt;
        if (f.y > h + 4) { f.y = -4; f.x = jitter(i, Math.floor(t)) * w; }
        if (f.x < -6) f.x += w + 12;
        if (blizzK > 0.15) {
          // Streaked flakes read as horizontal wind
          ctx.fillRect(f.x, f.y, 2 + blizzK * 14, f.r * 1.4);
        } else {
          dot(ctx, f.x, f.y, f.r);
        }
      }

      // ── THE WHITEOUT: the semi-transparent sheet that eats the mountain ──
      if (blizzK > 0) {
        ctx.fillStyle = `rgba(240,246,252,${blizzK * 0.82})`;
        ctx.fillRect(0, 0, w, h);
      }

      // Blizzard warning banner
      if (blizzMode === 'warn') {
        const flash = 0.5 + 0.5 * Math.sin(t * 18);
        ctx.fillStyle = `rgba(240,246,252,${0.12 * flash})`;
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.font = `900 22px ${HUD_FONT}`;
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,15,25,0.85)';
        ctx.strokeText('⚠ BLIZZARD!', w / 2, h * 0.3);
        ctx.fillStyle = `rgba(255,223,107,${0.6 + 0.4 * flash})`;
        ctx.fillText('⚠ BLIZZARD!', w / 2, h * 0.3);
      }

      // ── Hazard flash ──
      if (physics.hazardFlashRef.current > 0) {
        ctx.fillStyle = `rgba(220,50,40,${physics.hazardFlashRef.current * 0.28})`;
        ctx.fillRect(0, 0, w, h);
      }

      // ── HUD (over the whiteout — never strand the player blind on score) ──
      const pulse = 1 + physics.collectPulseRef.current * 0.25;
      ctx.save();
      ctx.translate(16, 30);
      ctx.scale(pulse, pulse);
      ctx.textAlign = 'left';
      ctx.font = `900 24px ${HUD_FONT}`;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,15,25,0.85)';
      const scoreTxt = `${physics.scoreRef.current.toLocaleString()} chips`;
      ctx.strokeText(scoreTxt, 0, 0);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(scoreTxt, 0, 0);
      ctx.restore();
      ctx.textAlign = 'left';
      ctx.font = `700 13px ${HUD_FONT}`;
      ctx.fillStyle = 'rgba(223,242,251,0.8)';
      ctx.fillText(`⛰ ${Math.round(physics.altitudeRef.current).toLocaleString()} m`, 16, 50);
      ctx.fillText(`🧗 ×${physics.collectedRef.current}`, 16, 68);

      const tl = physics.timeLeftRef.current;
      const urgent = tl <= 5;
      ctx.textAlign = 'right';
      ctx.font = `900 24px ${HUD_FONT}`;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,15,25,0.85)';
      const timeTxt = `${Math.ceil(tl)}s`;
      const tx = w - 16 + (urgent ? (jitter(t * 30, 3) - 0.5) * 3 : 0);
      ctx.strokeText(timeTxt, tx, 30);
      ctx.fillStyle = urgent ? '#ff5d4d' : '#dff2fb';
      ctx.fillText(timeTxt, tx, 30);
      ctx.font = `700 11px ${HUD_FONT}`;
      ctx.fillStyle = 'rgba(223,242,251,0.7)';
      ctx.fillText('TO SUMMIT', w - 16, 46);

      ctx.restore(); // shake
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once game loop
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ touchAction: 'none', display: 'block' }}
    />
  );
}
