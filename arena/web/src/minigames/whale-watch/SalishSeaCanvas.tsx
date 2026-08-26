// ═══════════════════════════════════════════════════════════════════
//  SALISH SEA WHALE WATCH — canvas renderer.
//
//  React's only jobs here: mount the <canvas>, wire pointer events,
//  own the rAF loop's lifecycle. Every frame goes straight through
//  physics.step() → draw() on refs — zero setState during play.
//
//  Art is 100% procedural (arc / bezier / fillStyle): a hazy Salish
//  Sea afternoon that burns down to dusk over the 45-second run —
//  fir-spiked shoreline, drifting fog banks, rolling sine swells, a
//  cedar-strip canoe with a lone paddler, and the animals themselves:
//  Dall's porpoises, orcas with their white eye patches and saddle,
//  and the humpback's barnacled fluke hanging in the air.
//
//  Renderer performance notes (same contract as FishTossCanvas):
//    • DPR capped at 2 — fill-rate over vanity.
//    • Gradients, the treeline Path2D, star/glint fields, and the fog
//      polygons are built once per resize; day→dusk is a cross-fade
//      of prebaked gradients, never a per-frame gradient alloc.
//    • FX reuse the physics arrays' in-place compaction trick,
//      capped at 48 droplets + 24 rings.
//    • Pointer → logical-x uses a cached bounding rect (refreshed on
//      resize), not a layout query per pointermove.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import {
  useWhaleWatchPhysics, surfaceY, canoeY, MARINE_STATS, CANOE_W,
  type Sighting, type MarineKind, type Grade, type RunStats, type ScorePopup,
} from './useWhaleWatchPhysics';
import { primeAudio, sfxShadow, sfxBreach, sfxSplash, sfxResult } from './whaleWatchSfx';

export interface SalishSeaCanvasProps {
  onGameOver: (finalScore: number, stats: RunStats) => void;
  runSeconds?: number;
  className?: string;
}

// Same HUD stack as the other cabinets — consistency across the arcade.
const HUD_FONT = '"Chalkboard SE", "Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';

const HORIZON_FRAC = 0.34;

interface Drop { x: number; y: number; vx: number; vy: number; age: number; ttl: number; s: number; color: string }
interface Ring { x: number; y: number; r: number; vr: number; age: number; ttl: number; color: string; lw: number }
interface Star { x: number; y: number; s: number }
interface Glint { x: number; y: number; s: number; v: number }
interface FogBank { path: Path2D; y: number; halfW: number; speed: number; alpha: number }

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

/** Stable jitter in [0,1). */
function jitter(seed: number, i: number): number {
  const x = Math.sin(seed + i * 7.13) * 43758.5453;
  return x - Math.floor(x);
}

const smooth = (k: number): number => k * k * (3 - 2 * k);

interface Backdrop {
  skyDay: CanvasGradient;
  skyDusk: CanvasGradient;
  waterDay: CanvasGradient;
  waterDusk: CanvasGradient;
  treeline: Path2D;
  stars: Star[];
  glints: Glint[];
  fog: FogBank[];
}

function buildBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): Backdrop {
  const horizon = h * HORIZON_FRAC;

  const skyDay = ctx.createLinearGradient(0, 0, 0, horizon);
  skyDay.addColorStop(0, '#7fb5cf');
  skyDay.addColorStop(1, '#dfd3a6');
  const skyDusk = ctx.createLinearGradient(0, 0, 0, horizon);
  skyDusk.addColorStop(0, '#141c3d');
  skyDusk.addColorStop(0.7, '#4a2a4a');
  skyDusk.addColorStop(1, '#c96a3a');

  // The brief: deep navy fading to emerald green.
  const waterDay = ctx.createLinearGradient(0, horizon, 0, h);
  waterDay.addColorStop(0, '#12395a');
  waterDay.addColorStop(0.55, '#155a55');
  waterDay.addColorStop(1, '#1d6b52');
  const waterDusk = ctx.createLinearGradient(0, horizon, 0, h);
  waterDusk.addColorStop(0, '#0a1c33');
  waterDusk.addColorStop(0.55, '#0d3236');
  waterDusk.addColorStop(1, '#103c30');

  const rng = mulberry32(0x5a715ea);

  // Fir-spiked shoreline ridge along the horizon, plus one low island.
  const treeline = new Path2D();
  treeline.moveTo(0, horizon + 1);
  for (let x = 0; x <= w; x += 13) {
    treeline.lineTo(x + 5, horizon - 6 - rng() * 20);
    treeline.lineTo(x + 13, horizon - 2 - rng() * 6);
  }
  treeline.lineTo(w, horizon + 1);
  treeline.closePath();
  const islX = w * 0.22, islW = w * 0.2;
  treeline.moveTo(islX - islW / 2, horizon + 9);
  treeline.quadraticCurveTo(islX, horizon - 8, islX + islW / 2, horizon + 9);
  treeline.closePath();

  const stars: Star[] = [];
  for (let i = 0; i < 42; i++) {
    stars.push({ x: rng() * w, y: rng() * horizon * 0.85, s: 0.6 + rng() * 1.1 });
  }

  const glints: Glint[] = [];
  for (let i = 0; i < 12; i++) {
    glints.push({ x: rng() * w, y: horizon + 14 + rng() * (h * 0.4), s: 0.4 + rng() * 0.8, v: 7 + rng() * 12 });
  }

  // Fog banks: lumpy low-alpha white polygons (built once, drifted per
  // frame by translate). Two rows — one hugging the far water, one
  // ghosting across the mid-field.
  const fog: FogBank[] = [];
  for (let i = 0; i < 6; i++) {
    const far = i < 3;
    const halfW = (far ? 0.34 : 0.46) * w * (0.7 + rng() * 0.6);
    const halfH = (far ? 14 : 22) * (0.7 + rng() * 0.7);
    const path = new Path2D();
    const bumps = 9;
    for (let k = 0; k <= bumps; k++) {
      const a = (k / bumps) * Math.PI * 2;
      const rx = halfW * (1 + 0.22 * Math.sin(a * 3 + i * 2.1));
      const ry = halfH * (1 + 0.3 * Math.sin(a * 2 + i * 4.7));
      const px = Math.cos(a) * rx;
      const py = Math.sin(a) * ry;
      if (k === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
    path.closePath();
    fog.push({
      path,
      y: far ? horizon + 12 + rng() * 24 : h * (0.5 + rng() * 0.16),
      halfW,
      speed: (far ? 5 : 10) + rng() * 7,
      alpha: far ? 0.10 : 0.075,
    });
  }

  return { skyDay, skyDusk, waterDay, waterDusk, treeline, stars, glints, fog };
}

// ── Path helpers ───────────────────────────────────────────────────

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

// ── The canoe: cedar-strip hull + lone paddler ─────────────────────

const CEDAR = '#8a4b2a';
const CEDAR_DARK = '#5b2f18';
const CEDAR_STRIP = '#a0603a';
const GUNWALE = '#3d2313';
const ACCENT = '#e8dcc4';    // painted bow band
const PADDLER = '#241a12';

function drawCanoe(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number): void {
  const bob = Math.sin(t * 1.7) * 2.2;
  const rock = Math.sin(t * 1.3) * 0.03;
  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.rotate(rock);
  const half = CANOE_W / 2;

  // Hull: swept belly with upturned bow and stern tips.
  ctx.fillStyle = CEDAR;
  ctx.beginPath();
  ctx.moveTo(-half - 6, -14);
  ctx.quadraticCurveTo(-half + 14, 2, -half * 0.4, 10);
  ctx.quadraticCurveTo(0, 15, half * 0.4, 10);
  ctx.quadraticCurveTo(half - 14, 2, half + 6, -14);
  ctx.quadraticCurveTo(half - 18, -4, 0, -4);
  ctx.quadraticCurveTo(-half + 18, -4, -half - 6, -14);
  ctx.closePath();
  ctx.fill();
  // Strip planking: two sweeping seams.
  ctx.strokeStyle = CEDAR_STRIP;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-half + 6, -6);
  ctx.quadraticCurveTo(0, 6, half - 6, -6);
  ctx.stroke();
  ctx.strokeStyle = CEDAR_DARK;
  ctx.beginPath();
  ctx.moveTo(-half + 12, -9);
  ctx.quadraticCurveTo(0, 11, half - 12, -9);
  ctx.stroke();
  // Gunwale line.
  ctx.strokeStyle = GUNWALE;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-half - 6, -14);
  ctx.quadraticCurveTo(0, -3, half + 6, -14);
  ctx.stroke();
  // Painted bow band.
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(half - 10, -9);
  ctx.quadraticCurveTo(half - 2, -11, half + 4, -13.5);
  ctx.stroke();

  // Paddler silhouette, mid-stroke.
  const dip = Math.sin(t * 2.4);
  ctx.fillStyle = PADDLER;
  ellipse(ctx, -8, -26, 9, 12);              // torso
  dot(ctx, -8, -42, 7);                      // head
  ctx.strokeStyle = PADDLER;
  ctx.lineWidth = 3.4;
  ctx.beginPath();                           // paddle shaft, rocking with the stroke
  ctx.moveTo(-16, -34);
  ctx.lineTo(8 + dip * 4, -10 + dip * 6);
  ctx.stroke();
  ctx.fillStyle = PADDLER;                   // blade
  ellipse(ctx, 10 + dip * 4, -7 + dip * 6, 4, 8, 0.5);

  // Waterline reflection.
  ctx.fillStyle = 'rgba(8,20,24,0.35)';
  ellipse(ctx, 0, 15, half * 0.9, 5);
  ctx.restore();
}

// ── The animals ────────────────────────────────────────────────────
// Breachers are drawn nose-right at unit scale, then rotated by the
// arc: rising = nose up, apex = tipping over, falling = the backflop.

function breachRotation(s: Sighting): number {
  const u = Math.max(-1, Math.min(1, s.vy / s.launchSpeed));
  return -1.15 - (u * 0.5 + 0.5) * 0.85;
}

function drawPorpoise(ctx: CanvasRenderingContext2D): void {
  const st = MARINE_STATS.porpoise;
  ctx.fillStyle = '#2c353d';
  ctx.beginPath();                                       // sleek body
  ctx.moveTo(st.w / 2, 0);
  ctx.quadraticCurveTo(st.w * 0.2, -st.h * 0.62, -st.w * 0.34, -st.h * 0.3);
  ctx.quadraticCurveTo(-st.w * 0.5, 0, -st.w * 0.34, st.h * 0.3);
  ctx.quadraticCurveTo(st.w * 0.2, st.h * 0.62, st.w / 2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();                                       // flukes
  ctx.moveTo(-st.w * 0.42, 0);
  ctx.lineTo(-st.w * 0.58, -st.h * 0.42);
  ctx.lineTo(-st.w * 0.5, 0);
  ctx.lineTo(-st.w * 0.58, st.h * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();                                       // stubby dorsal
  ctx.moveTo(-st.w * 0.02, -st.h * 0.5);
  ctx.quadraticCurveTo(st.w * 0.02, -st.h * 0.95, st.w * 0.1, -st.h * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8eef0';                             // Dall's white flank
  ellipse(ctx, -st.w * 0.14, st.h * 0.14, st.w * 0.24, st.h * 0.26);
}

function drawOrca(ctx: CanvasRenderingContext2D): void {
  const st = MARINE_STATS.orca;
  ctx.fillStyle = '#0b1015';
  ctx.beginPath();                                       // body
  ctx.moveTo(st.w / 2, st.h * 0.05);
  ctx.quadraticCurveTo(st.w * 0.24, -st.h * 0.52, -st.w * 0.28, -st.h * 0.34);
  ctx.quadraticCurveTo(-st.w * 0.48, -st.h * 0.1, -st.w * 0.44, st.h * 0.08);
  ctx.quadraticCurveTo(-st.w * 0.2, st.h * 0.5, st.w * 0.3, st.h * 0.34);
  ctx.quadraticCurveTo(st.w * 0.46, st.h * 0.22, st.w / 2, st.h * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();                                       // flukes
  ctx.moveTo(-st.w * 0.4, 0);
  ctx.lineTo(-st.w * 0.6, -st.h * 0.38);
  ctx.lineTo(-st.w * 0.5, 0);
  ctx.lineTo(-st.w * 0.6, st.h * 0.38);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();                                       // the tall dorsal
  ctx.moveTo(-st.w * 0.04, -st.h * 0.34);
  ctx.quadraticCurveTo(-st.w * 0.02, -st.h * 1.15, st.w * 0.09, -st.h * 0.38);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();                                       // pectoral paddle
  ctx.moveTo(st.w * 0.1, st.h * 0.24);
  ctx.quadraticCurveTo(st.w * 0.04, st.h * 0.75, st.w * 0.22, st.h * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8eef0';
  ellipse(ctx, st.w * 0.3, -st.h * 0.16, st.w * 0.07, st.h * 0.12, -0.35);   // eye patch
  ctx.beginPath();                                       // white chin → belly sweep
  ctx.moveTo(st.w * 0.47, st.h * 0.1);
  ctx.quadraticCurveTo(st.w * 0.2, st.h * 0.42, -st.w * 0.05, st.h * 0.3);
  ctx.quadraticCurveTo(st.w * 0.2, st.h * 0.16, st.w * 0.47, st.h * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(150,165,175,0.55)';              // saddle patch
  ellipse(ctx, -st.w * 0.12, -st.h * 0.2, st.w * 0.1, st.h * 0.16, 0.3);
}

/** The humpback never fully clears — its fluke rises, hangs, and slaps. */
function drawHumpbackFluke(ctx: CanvasRenderingContext2D, s: Sighting, surface: number, t: number): void {
  const st = MARINE_STATS.humpback;
  const wob = Math.sin(t * 2.2 + s.seed) * 0.06;
  ctx.save();
  ctx.translate(s.x, 0);
  ctx.rotate(wob);
  // Peduncle: a dark column from the waterline up to the fluke.
  ctx.fillStyle = '#1c2830';
  ctx.beginPath();
  ctx.moveTo(-st.w * 0.13, surface + 8);
  ctx.quadraticCurveTo(-st.w * 0.1, (surface + s.y) / 2, -st.w * 0.16, s.y + 12);
  ctx.lineTo(st.w * 0.16, s.y + 12);
  ctx.quadraticCurveTo(st.w * 0.1, (surface + s.y) / 2, st.w * 0.13, surface + 8);
  ctx.closePath();
  ctx.fill();
  // The fluke: two swept lobes with the pale, barnacled underside.
  ctx.fillStyle = '#243642';
  ctx.beginPath();
  ctx.moveTo(0, s.y + 14);
  ctx.quadraticCurveTo(-st.w * 0.34, s.y - st.h * 0.16, -st.w * 0.52, s.y + 4);
  ctx.quadraticCurveTo(-st.w * 0.24, s.y - st.h * 0.02, 0, s.y + 6);
  ctx.quadraticCurveTo(st.w * 0.24, s.y - st.h * 0.02, st.w * 0.52, s.y + 4);
  ctx.quadraticCurveTo(st.w * 0.34, s.y - st.h * 0.16, 0, s.y + 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(226,234,238,0.8)';
  for (let i = 0; i < 5; i++) {
    dot(ctx, (jitter(s.seed, i) - 0.5) * st.w * 0.7, s.y + 2 + jitter(s.seed, i + 5) * 8, 1.6 + jitter(s.seed, i + 9) * 1.6);
  }
  // Streaming water off the trailing edges.
  ctx.strokeStyle = 'rgba(200,235,240,0.5)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * st.w * 0.4, s.y + 8);
    ctx.quadraticCurveTo(side * st.w * 0.42, s.y + 26, side * st.w * 0.38, s.y + 40);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBreacher(ctx: CanvasRenderingContext2D, s: Sighting, surface: number, t: number): void {
  if (s.kind === 'humpback') {
    drawHumpbackFluke(ctx, s, surface, t);
    return;
  }
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(breachRotation(s));
  if (s.kind === 'orca') drawOrca(ctx);
  else drawPorpoise(ctx);
  ctx.restore();
}

/** Deep-water shadow + the growing surface disturbance above it. */
function drawShadow(ctx: CanvasRenderingContext2D, s: Sighting, surface: number, t: number): void {
  const st = MARINE_STATS[s.kind];
  const w = st.w * s.scale;
  ctx.fillStyle = `rgba(5,20,26,${0.28 + 0.3 * s.scale})`;
  ellipse(ctx, s.x, s.y, w * 0.55, w * 0.16);
  ctx.fillStyle = `rgba(5,20,26,${0.16 + 0.16 * s.scale})`;
  ellipse(ctx, s.x, s.y, w * 0.72, w * 0.24);
  // Two expanding ripple rings on the surface, phase-offset.
  ctx.strokeStyle = `rgba(210,240,245,${0.28 * s.scale})`;
  ctx.lineWidth = 1.4;
  for (const ph of [0, 0.5]) {
    const k = (t * 0.8 + ph + jitter(s.seed, 3)) % 1;
    ctx.beginPath();
    ctx.ellipse(s.x, surface + 4, 10 + k * w * 0.8, (10 + k * w * 0.8) * 0.22, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 1 - k;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ── Component ──────────────────────────────────────────────────────

export function SalishSeaCanvas({ onGameOver, runSeconds, className }: SalishSeaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dropsRef = useRef<Drop[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  // FX + SFX requests queued from physics callbacks, drained in the loop.
  const splashQueueRef = useRef<number[]>([]);          // x pairs (breach/splashdown share one look)
  const resultQueueRef = useRef<Array<{ grade: Grade; x: number; y: number }>>([]);
  const heldOnceRef = useRef(false);                    // retires the hint text

  const physics = useWhaleWatchPhysics({
    runSeconds,
    onGameOver,
    onShadow: (kind: MarineKind) => sfxShadow(kind),
    onBreach: (kind, x) => {
      sfxBreach(kind);
      splashQueueRef.current.push(x);
    },
    onSplashdown: (kind, x) => {
      sfxSplash(kind);
      splashQueueRef.current.push(x);
    },
    onResult: (grade, _kind, _chips, x, y) => {
      sfxResult(grade);
      resultQueueRef.current.push({ grade, x, y });
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

    const onDown = (e: PointerEvent) => {
      primeAudio();                       // safety net if the modal's tap didn't
      physics.setPointerX(e.clientX - rect.left);
      physics.holdStart();
      heldOnceRef.current = true;
    };
    const onMove = (e: PointerEvent) => {
      physics.setPointerX(e.clientX - rect.left);
    };
    const onUp = () => physics.release();
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onUp);

    let raf = 0;
    let last = performance.now();
    let t = 0; // ambient clock (swells, bob, fog drift)

    const emitDrops = (x: number, y: number, n: number, up: number, color: string) => {
      const drops = dropsRef.current;
      for (let i = 0; i < n && drops.length < 48; i++) {
        const a = Math.PI * (1.1 + Math.random() * 0.8);       // fan upward
        const sp = 90 + Math.random() * 200;
        drops.push({
          x, y,
          vx: Math.cos(a) * sp * 0.6,
          vy: Math.sin(a) * sp - up,
          age: 0, ttl: 0.5 + Math.random() * 0.4,
          s: 1.6 + Math.random() * 2.4,
          color,
        });
      }
    };
    const emitRing = (x: number, y: number, vr: number, ttl: number, color: string, lw: number) => {
      const rings = ringsRef.current;
      if (rings.length < 24) rings.push({ x, y, r: 4, vr, age: 0, ttl, color, lw });
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;

      physics.step(dt, w, h);
      if (!backdrop) return;

      const surface = surfaceY(h);
      const boatY = canoeY(h);
      const horizon = h * HORIZON_FRAC;
      const progress = physics.progressRef.current;
      const dusk = smooth(Math.min(1, progress * 1.15));   // sky cross-fade
      const veil = smooth(Math.max(0, (progress - 0.45) / 0.55)); // late darkening

      // Drain FX queues (allocation-light).
      const sq = splashQueueRef.current;
      for (let i = 0; i < sq.length; i++) {
        emitDrops(sq[i], surface, 12, 140, 'rgba(225,245,248,0.9)');
        emitRing(sq[i], surface + 4, 130, 0.7, 'rgba(220,245,250,0.7)', 2.2);
      }
      sq.length = 0;
      const rq = resultQueueRef.current;
      for (const r of rq) {
        if (r.grade === 'perfect') {
          // The glowing cyan ripple — three staggered expanding rings.
          emitRing(r.x, r.y, 220, 0.9, 'rgba(64,242,255,0.9)', 3.5);
          emitRing(r.x, r.y, 150, 1.1, 'rgba(64,242,255,0.55)', 2.4);
          emitRing(r.x, surface + 4, 260, 1.0, 'rgba(64,242,255,0.7)', 2.8);
          emitDrops(r.x, r.y, 10, 60, 'rgba(140,246,255,0.95)');
        } else if (r.grade === 'good') {
          emitRing(r.x, r.y, 150, 0.7, 'rgba(200,240,245,0.6)', 2.2);
        }
      }
      rq.length = 0;

      // ── Sky: day → dusk cross-fade of prebaked gradients ──
      ctx.fillStyle = backdrop.skyDay;
      ctx.fillRect(0, 0, w, horizon);
      if (dusk > 0.01) {
        ctx.globalAlpha = dusk;
        ctx.fillStyle = backdrop.skyDusk;
        ctx.fillRect(0, 0, w, horizon);
        ctx.globalAlpha = 1;
      }

      // Stars prick through late.
      const starA = Math.max(0, (progress - 0.7) / 0.3);
      if (starA > 0) {
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < backdrop.stars.length; i++) {
          const st = backdrop.stars[i];
          ctx.globalAlpha = starA * (0.4 + 0.6 * jitter(t * 0.7, i));
          dot(ctx, st.x, st.y, st.s);
        }
        ctx.globalAlpha = 1;
      }

      // The sun slides down to the horizon over the run.
      const sunY = h * 0.1 + (horizon + 6 - h * 0.1) * smooth(progress);
      const sunX = w * 0.76;
      ctx.fillStyle = `rgba(255,${200 - dusk * 90},${130 - dusk * 80},${0.16 * (1 - veil * 0.7)})`;
      dot(ctx, sunX, sunY, 34);
      ctx.fillStyle = `rgba(255,${222 - dusk * 100},${160 - dusk * 110},${0.9 - veil * 0.5})`;
      dot(ctx, sunX, sunY, 15);

      // Shoreline firs, darkening as the light goes.
      ctx.fillStyle = `rgba(${16 - dusk * 8},${44 - dusk * 24},${46 - dusk * 26},0.95)`;
      ctx.fill(backdrop.treeline);

      // ── Water ──
      ctx.fillStyle = backdrop.waterDay;
      ctx.fillRect(0, horizon, w, h - horizon);
      if (dusk > 0.01) {
        ctx.globalAlpha = dusk;
        ctx.fillStyle = backdrop.waterDusk;
        ctx.fillRect(0, horizon, w, h - horizon);
        ctx.globalAlpha = 1;
      }
      // Sun-path shimmer down the water.
      ctx.fillStyle = `rgba(255,214,150,${0.1 * (1 - veil * 0.6)})`;
      ellipse(ctx, sunX, horizon + 22, 30, 8);
      ellipse(ctx, sunX - 8, horizon + 48, 22, 6);
      // Drifting glints.
      ctx.strokeStyle = 'rgba(190,232,238,0.24)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (const g of backdrop.glints) {
        g.x += g.v * dt; if (g.x > w + 16) g.x = -16;
        ctx.beginPath(); ctx.moveTo(g.x - 7 * g.s, g.y); ctx.lineTo(g.x + 7 * g.s, g.y); ctx.stroke();
      }

      // ── Underwater shadows (behind the swell lines) ──
      for (const s of physics.sightingsRef.current) {
        if (s.phase === 'approach') drawShadow(ctx, s, surface, t);
      }

      // ── Rolling swells: overlapping low-opacity sine ribbons ──
      ctx.lineCap = 'round';
      const swellRows: Array<[number, number, number, number, string]> = [
        // [y, amplitude, wavelength k, speed, color]
        [surface - 16, 3.5, 0.020, 1.1, 'rgba(215,242,246,0.10)'],
        [surface + 3, 5, 0.016, -0.8, 'rgba(215,242,246,0.14)'],
        [surface + 42, 6.5, 0.012, 0.6, 'rgba(190,232,238,0.10)'],
        [boatY + 20, 9, 0.009, -0.45, 'rgba(215,242,246,0.12)'],
      ];
      for (let r = 0; r < swellRows.length; r++) {
        const [y0, amp, k, sp, color] = swellRows[r];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 24) {
          const y = y0 + Math.sin(x * k + t * sp + r * 2.4) * amp + Math.sin(x * k * 2.3 - t * sp * 1.7) * amp * 0.4;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // ── Breachers ──
      for (const s of physics.sightingsRef.current) {
        if (s.phase === 'airborne') drawBreacher(ctx, s, surface, t);
      }

      // ── Spotting ring: perspective circle on the breach line ──
      const ring = physics.ringRef.current;
      if (ring > 2) {
        const canoeX = physics.canoeXRef.current;
        let hot = false;
        for (const s of physics.sightingsRef.current) {
          if (s.phase === 'airborne' && !s.attempted &&
              Math.abs(s.x - canoeX) <= ring + MARINE_STATS[s.kind].w * 0.5) { hot = true; break; }
        }
        ctx.strokeStyle = hot ? 'rgba(64,242,255,0.95)' : 'rgba(230,245,248,0.55)';
        ctx.lineWidth = hot ? 3.5 : 2;
        ctx.beginPath();
        ctx.ellipse(canoeX, surface + 6, ring, ring * 0.24, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (hot) {
          ctx.fillStyle = 'rgba(64,242,255,0.08)';
          ctx.beginPath();
          ctx.ellipse(canoeX, surface + 6, ring, ring * 0.24, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── FX rings + droplets (in-place compaction) ──
      const rings = ringsRef.current;
      let write = 0;
      for (let i = 0; i < rings.length; i++) {
        const p = rings[i];
        p.age += dt;
        if (p.age >= p.ttl) continue;
        p.r += p.vr * dt;
        ctx.globalAlpha = 1 - p.age / p.ttl;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.lw;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r, p.r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        rings[write++] = p;
      }
      rings.length = write;
      ctx.globalAlpha = 1;

      const drops = dropsRef.current;
      write = 0;
      for (let i = 0; i < drops.length; i++) {
        const p = drops[i];
        p.age += dt;
        if (p.age >= p.ttl) continue;
        p.vy += 560 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = 1 - p.age / p.ttl;
        ctx.fillStyle = p.color;
        dot(ctx, p.x, p.y, p.s * 0.6);
        drops[write++] = p;
      }
      drops.length = write;
      ctx.globalAlpha = 1;

      // ── The canoe ──
      drawCanoe(ctx, physics.canoeXRef.current, boatY, t);

      // ── Fog banks drift over everything on the water ──
      ctx.fillStyle = '#e8f2f4';
      for (let i = 0; i < backdrop.fog.length; i++) {
        const f = backdrop.fog[i];
        const span = w + 2 * f.halfW;
        const off = ((t * f.speed + i * 617) % span) - f.halfW;
        ctx.save();
        ctx.translate(off, f.y);
        ctx.globalAlpha = f.alpha * (1 + dusk * 0.4);   // fog thickens at dusk
        ctx.fill(f.path);
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // ── Dusk veil ──
      if (veil > 0) {
        ctx.fillStyle = `rgba(8,10,30,${veil * 0.38})`;
        ctx.fillRect(0, 0, w, h);
      }

      // ── Score popups ──
      ctx.textAlign = 'center';
      for (const p of physics.popupsRef.current as ScorePopup[]) {
        ctx.save();
        ctx.globalAlpha = 1 - p.age / p.ttl;
        ctx.font = `900 20px ${HUD_FONT}`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(8,14,18,0.85)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      }

      // ── HUD ──
      const pulse = 1 + physics.catchPulseRef.current * 0.25;
      ctx.save();
      ctx.translate(16, 30);
      ctx.scale(pulse, pulse);
      ctx.textAlign = 'left';
      ctx.font = `900 24px ${HUD_FONT}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(8,14,18,0.85)';
      const scoreTxt = `${physics.scoreRef.current.toLocaleString()} chips`;
      ctx.strokeText(scoreTxt, 0, 0);
      ctx.fillStyle = '#7ff3ff';
      ctx.fillText(scoreTxt, 0, 0);
      ctx.restore();
      ctx.textAlign = 'left';
      ctx.font = `700 13px ${HUD_FONT}`;
      ctx.fillStyle = 'rgba(223,242,247,0.75)';
      ctx.fillText(`⭐ ×${physics.perfectsRef.current}`, 16, 50);

      const tl = physics.timeLeftRef.current;
      const urgent = tl <= 5;
      ctx.textAlign = 'right';
      ctx.font = `900 24px ${HUD_FONT}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(8,14,18,0.85)';
      const timeTxt = `${Math.ceil(tl)}s`;
      const tx = w - 16 + (urgent ? (jitter(t * 30, 3) - 0.5) * 3 : 0);
      ctx.strokeText(timeTxt, tx, 30);
      ctx.fillStyle = urgent ? '#ff5d4d' : '#dff2f7';
      ctx.fillText(timeTxt, tx, 30);

      // First-timer hint until the first hold.
      if (!heldOnceRef.current && physics.statusRef.current === 'running') {
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 3);
        ctx.font = `700 14px ${HUD_FONT}`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(8,14,18,0.8)';
        const hint = 'PADDLE under the shadow · HOLD, release at the top of the breach';
        ctx.strokeText(hint, w / 2, h - 14);
        ctx.fillStyle = '#dff2f7';
        ctx.fillText(hint, w / 2, h - 14);
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onUp);
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
