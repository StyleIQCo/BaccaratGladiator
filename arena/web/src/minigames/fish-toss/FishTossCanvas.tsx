// ═══════════════════════════════════════════════════════════════════
//  PIKE PLACE FISH TOSS — canvas renderer.
//
//  React's only jobs here: mount the <canvas>, wire pointer events,
//  own the rAF loop's lifecycle. Every frame goes straight through
//  physics.step() → draw() on refs — zero setState during play.
//
//  Art is 100% procedural (arc / bezier / fillStyle): a drizzly dusk
//  over the bay, string lights, the striped market stall with its ice
//  bed, wet dock planks — and TWO MONGERS in full canon (see
//  README.md): safety-orange waterproof bib overalls over red-plaid
//  flannel, teal knit beanies, yellow rubber gloves. The thrower
//  winds up and hurls from the stall; the catcher (the player) slides
//  the right edge, whooping market chants on every catch.
//
//  Renderer performance notes (same contract as HotdogCanvas):
//    • DPR capped at 2 — fill-rate over vanity.
//    • Sky gradient + glint/drizzle fields built once per resize;
//      they advance by dt and wrap — no per-frame allocs.
//    • Celebration particles reuse the physics arrays' in-place
//      compaction trick, capped at 48 live particles.
//    • Pointer → logical-y uses a cached bounding rect (refreshed on
//      resize), not a layout query per pointermove.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import {
  useFishTossPhysics, getCatcherBox, getThrowerHand, FISH_STATS, DOCK_H,
  type TossedFish, type GameOverReason, type HazardMode, type FishKind, type ScorePopup,
} from './useFishTossPhysics';

export interface FishTossCanvasProps {
  onGameOver: (finalScore: number, reason: GameOverReason) => void;
  hazardMode?: HazardMode;
  runSeconds?: number;
  className?: string;
}

// Bouncy arcade-ish stack — best native match on iOS first, then Android/desktop.
const HUD_FONT = '"Chalkboard SE", "Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';

// What the catcher hollers per catch — market-chant energy.
const PHRASES: Record<Exclude<FishKind, 'old_boot'>, string[]> = {
  sockeye:        ['FRESH ONE!', 'HEY-OH!', 'GOT IT!'],
  herring:        ['SNACK SIZE!', 'TINY ONE!', 'HUP!'],
  rainbow_trout:  ['BEAUTY!', 'SHINY!', 'OH YEAH!'],
  dungeness_crab: ['CRAB UP!', 'PINCHY!', 'EASY NOW!'],
  king_salmon:    ['KIIING!', 'BIG MONEY!', 'WHOA!'],
};

/** The catcher's current "market holler": t counts up from the catch. */
interface Reaction { t: number; dur: number; phrase: string; big: boolean }

interface Fx {
  kind: 'ice' | 'drop' | 'splash';
  x: number; y: number; vx: number; vy: number;
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

/** Stable per-fish jitter in [0,1) keyed off the fish's spawn seed. */
function jitter(seed: number, i: number): number {
  const x = Math.sin(seed + i * 7.13) * 43758.5453;
  return x - Math.floor(x);
}

interface Streak { x: number; y: number; s: number; v: number }
interface Backdrop {
  sky: CanvasGradient;
  water: CanvasGradient;
  glints: Streak[];      // drifting light-catch dashes on the bay
  drizzle: Streak[];     // the PNW is doing its thing
  bulbs: Array<{ x: number; y: number }>;
}

function buildBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): Backdrop {
  const horizon = h * 0.4;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#0d2331');
  sky.addColorStop(1, '#2a5b6e');
  const water = ctx.createLinearGradient(0, horizon, 0, h - DOCK_H);
  water.addColorStop(0, '#1d4557');
  water.addColorStop(1, '#123241');
  const rng = mulberry32(0xf15b0a7);
  const glints: Streak[] = [];
  for (let i = 0; i < 12; i++) {
    glints.push({ x: rng() * w, y: horizon + rng() * (h - DOCK_H - horizon), s: 0.4 + rng() * 0.8, v: 8 + rng() * 14 });
  }
  const drizzle: Streak[] = [];
  for (let i = 0; i < 16; i++) {
    drizzle.push({ x: rng() * w, y: rng() * h, s: 0.5 + rng() * 0.8, v: 380 + rng() * 240 });
  }
  // Two sagging strings of café bulbs across the top.
  const bulbs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    bulbs.push({ x: t * w, y: 26 + Math.sin(t * Math.PI) * 26 });
  }
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    bulbs.push({ x: t * w, y: 64 + Math.sin(t * Math.PI) * 20 });
  }
  return { sky, water, glints, drizzle, bulbs };
}

// ── Path helpers ───────────────────────────────────────────────────

function capsule(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 + r, cy - r);
  ctx.lineTo(cx + w / 2 - r, cy - r);
  ctx.arc(cx + w / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(cx - w / 2 + r, cy + r);
  ctx.arc(cx - w / 2 + r, cy, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
}

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

// ── The mongers (canon: orange bib waders, flannel, beanie, gloves) ─

const OVERALL = '#f97316';
const OVERALL_DARK = '#ea580c';
const HIVIS = '#fbbf24';
const FLANNEL = '#b3402f';
const FLANNEL_DARK = '#7c261b';
const BEANIE = '#2f6d75';
const BEANIE_BAND = '#3d8891';
const SKIN = '#f2c9a0';
const GLOVE = '#ffd23f';
const BOOT_DARK = '#33272a';

function flannelSleeve(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number): void {
  ctx.strokeStyle = FLANNEL;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // A couple of darker cross-bands sell the plaid without a pattern fill.
  ctx.strokeStyle = FLANNEL_DARK;
  ctx.lineWidth = w * 0.3;
  for (const t of [0.35, 0.7]) {
    const mx = x1 + (x2 - x1) * t, my = y1 + (y2 - y1) * t;
    const nx = -(y2 - y1), ny = x2 - x1;
    const nl = Math.hypot(nx, ny) || 1;
    ctx.beginPath();
    ctx.moveTo(mx - (nx / nl) * w * 0.45, my - (ny / nl) * w * 0.45);
    ctx.lineTo(mx + (nx / nl) * w * 0.45, my + (ny / nl) * w * 0.45);
    ctx.stroke();
  }
}

function beanieHead(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, grin: number, facing: number): void {
  ctx.fillStyle = SKIN;
  dot(ctx, cx, cy, r);
  // Knit dome + fold band, ribbed.
  ctx.fillStyle = BEANIE;
  ctx.beginPath(); ctx.arc(cx, cy - r * 0.08, r, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = BEANIE_BAND;
  rr(ctx, cx - r * 1.04, cy - r * 0.42, r * 2.08, r * 0.44, r * 0.2); ctx.fill();
  ctx.strokeStyle = BEANIE_BAND; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  for (const o of [-0.45, 0, 0.45]) {
    ctx.beginPath(); ctx.moveTo(cx + o * r, cy - r); ctx.lineTo(cx + o * r, cy - r * 0.5); ctx.stroke();
  }
  // Face: eyes lead in the throwing/catching direction; grin scales with joy.
  ctx.fillStyle = BOOT_DARK;
  dot(ctx, cx + facing * r * 0.3, cy + r * 0.1, r * 0.11);
  dot(ctx, cx + facing * r * 0.68, cy + r * 0.1, r * 0.11);
  ctx.strokeStyle = BOOT_DARK; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx + facing * r * 0.45, cy + r * 0.42, r * (0.22 + grin * 0.2), 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  if (grin > 0.4) { // open-mouth holler
    ctx.fillStyle = '#7c2d2d';
    dot(ctx, cx + facing * r * 0.45, cy + r * 0.52, r * 0.16 * grin);
  }
}

/** Legs + bib torso shared by both mongers (drawn facing +x; flip via scale). */
function mongerBody(ctx: CanvasRenderingContext2D, cx: number, groundY: number, s: number): void {
  // Boots
  ctx.fillStyle = BOOT_DARK;
  rr(ctx, cx - 24 * s, groundY - 10 * s, 20 * s, 10 * s, 4 * s); ctx.fill();
  rr(ctx, cx + 4 * s, groundY - 10 * s, 20 * s, 10 * s, 4 * s); ctx.fill();
  // Wader legs with hi-vis cuffs
  ctx.fillStyle = OVERALL;
  rr(ctx, cx - 20 * s, groundY - 42 * s, 16 * s, 34 * s, 5 * s); ctx.fill();
  rr(ctx, cx + 4 * s, groundY - 42 * s, 16 * s, 34 * s, 5 * s); ctx.fill();
  ctx.fillStyle = HIVIS;
  ctx.fillRect(cx - 20 * s, groundY - 18 * s, 16 * s, 5 * s);
  ctx.fillRect(cx + 4 * s, groundY - 18 * s, 16 * s, 5 * s);
  // Hips + bib panel over the flannel torso
  ctx.fillStyle = OVERALL;
  rr(ctx, cx - 22 * s, groundY - 58 * s, 44 * s, 20 * s, 6 * s); ctx.fill();
  rr(ctx, cx - 16 * s, groundY - 86 * s, 32 * s, 32 * s, 5 * s); ctx.fill();
  ctx.fillStyle = OVERALL_DARK; // chest pocket
  rr(ctx, cx - 8 * s, groundY - 78 * s, 16 * s, 10 * s, 3 * s); ctx.fill();
  // Straps + buckles
  ctx.strokeStyle = OVERALL; ctx.lineWidth = 6 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 12 * s, groundY - 86 * s); ctx.lineTo(cx - 16 * s, groundY - 98 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 12 * s, groundY - 86 * s); ctx.lineTo(cx + 16 * s, groundY - 98 * s); ctx.stroke();
  ctx.fillStyle = HIVIS;
  dot(ctx, cx - 11 * s, groundY - 84 * s, 2.6 * s);
  dot(ctx, cx + 11 * s, groundY - 84 * s, 2.6 * s);
}

/**
 * The stall monger. armPhase ∈ [0,1]: 1 = arm cocked behind the head,
 * 0 = follow-through pointing at the catcher. throwPulse drives it.
 */
function drawThrower(ctx: CanvasRenderingContext2D, x: number, groundY: number, armPhase: number, bob: number): void {
  const s = 1;
  const cy = groundY + Math.sin(bob) * 1.5;
  mongerBody(ctx, x, cy, s);
  // Off arm rests on the counter line.
  flannelSleeve(ctx, x - 14, cy - 80, x - 30, cy - 62, 9);
  ctx.fillStyle = GLOVE; dot(ctx, x - 31, cy - 61, 5);
  // Throwing arm sweeps ~2 radians during the pulse.
  const a = -2.1 * armPhase + 0.55 * (1 - armPhase); // cocked → follow-through
  const ax = x + 12, ay = cy - 84;
  const hx = ax + Math.cos(a) * 30, hy = ay + Math.sin(a) * 30;
  flannelSleeve(ctx, ax, ay, hx, hy, 9);
  ctx.fillStyle = GLOVE; dot(ctx, hx, hy, 5.5);
  beanieHead(ctx, x + 2, cy - 106, 13, 0.3 + armPhase * 0.5, 1);
}

/** The player. Arms reach left for the incoming fish; they clamp on a catch. */
function drawCatcher(ctx: CanvasRenderingContext2D, x: number, y: number, catchPulse: number, bob: number): void {
  const s = 1;
  const groundY = y + 52 + Math.sin(bob) * 1.2;
  mongerBody(ctx, x, groundY, s);
  const clamp = catchPulse * 14; // arms squeeze together on the catch
  flannelSleeve(ctx, x - 6, groundY - 84, x - 36, groundY - 96 + clamp, 9);
  flannelSleeve(ctx, x - 8, groundY - 72, x - 38, groundY - 58 - clamp, 9);
  ctx.fillStyle = GLOVE;
  dot(ctx, x - 38, groundY - 96 + clamp, 5.5);
  dot(ctx, x - 40, groundY - 58 - clamp, 5.5);
  beanieHead(ctx, x + 2, groundY - 106, 13, 0.25 + catchPulse, -1);
}

// ── The catch of the day ───────────────────────────────────────────

function drawFishBody(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  body: string, back: string, tail: string,
): void {
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 4, 0);
  ctx.lineTo(-w / 2 - h * 0.5, -h * 0.55);
  ctx.lineTo(-w / 2 - h * 0.5, h * 0.55);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = back; ctx.lineWidth = h * 0.22; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.26); ctx.quadraticCurveTo(0, -h * 0.5, w * 0.32, -h * 0.2); ctx.stroke();
  ctx.fillStyle = '#1d1d24';
  dot(ctx, w * 0.32, -h * 0.08, Math.max(1.6, h * 0.09));
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; // wet glint
  ctx.beginPath(); ctx.ellipse(-w * 0.12, -h * 0.16, w * 0.18, h * 0.1, -0.3, 0, Math.PI * 2); ctx.fill();
}

function drawFish(ctx: CanvasRenderingContext2D, f: TossedFish): void {
  const st = FISH_STATS[f.kind];
  ctx.save();
  ctx.translate(f.x, f.y);
  // Fish fly nose-first along their arc; crabs and the boot just tumble.
  const along = Math.atan2(f.vy, f.vx);
  const rot = f.kind === 'dungeness_crab' || f.kind === 'old_boot' ? f.spin : along * 0.6 + f.spin * 0.4;
  ctx.rotate(rot);

  switch (f.kind) {
    case 'sockeye':   // spawning colours: crimson body, green head
      drawFishBody(ctx, st.w, st.h, '#c1272d', '#8f1d24', '#a02026');
      ctx.fillStyle = '#2f5236';
      ctx.beginPath(); ctx.ellipse(st.w * 0.32, 0, st.w * 0.18, st.h * 0.46, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1d1d24'; dot(ctx, st.w * 0.34, -st.h * 0.08, 1.8);
      break;
    case 'herring':
      drawFishBody(ctx, st.w, st.h, '#cfd8dc', '#5b7fa6', '#9fb3bc');
      break;
    case 'rainbow_trout': {
      drawFishBody(ctx, st.w, st.h, '#d98ea4', '#6d8a5b', '#b06e83');
      ctx.strokeStyle = '#ff6b9d'; ctx.lineWidth = st.h * 0.16; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-st.w * 0.32, 0); ctx.lineTo(st.w * 0.3, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(40,40,50,0.5)';
      for (let i = 0; i < 4; i++) {
        dot(ctx, -st.w * 0.3 + jitter(f.seed, i) * st.w * 0.6, (jitter(f.seed, i + 9) - 0.5) * st.h * 0.5, 1.3);
      }
      break;
    }
    case 'dungeness_crab': {
      ctx.fillStyle = '#b23d1f';
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          ctx.strokeStyle = '#b23d1f'; ctx.lineWidth = 3; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(side * st.w * 0.2, st.h * 0.1);
          ctx.lineTo(side * st.w * (0.42 + i * 0.06), st.h * (0.4 + i * 0.16));
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#d24d2a';
      ctx.beginPath(); ctx.ellipse(0, 0, st.w / 2, st.h / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8663d';
      ctx.beginPath(); ctx.ellipse(0, -st.h * 0.12, st.w * 0.38, st.h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d24d2a'; // claws up front
      dot(ctx, st.w * 0.42, -st.h * 0.32, st.h * 0.2);
      dot(ctx, -st.w * 0.42, -st.h * 0.32, st.h * 0.2);
      ctx.fillStyle = '#1d1d24';
      dot(ctx, -st.w * 0.1, -st.h * 0.42, 1.6);
      dot(ctx, st.w * 0.1, -st.h * 0.42, 1.6);
      break;
    }
    case 'king_salmon':
      drawFishBody(ctx, st.w, st.h, '#b8c4cc', '#3f6d7d', '#8fa3ad');
      ctx.fillStyle = '#e8eef0'; // pale belly
      ctx.beginPath(); ctx.ellipse(0, st.h * 0.18, st.w * 0.4, st.h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8fa3ad'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(st.w * 0.24, 0, st.h * 0.3, -1.1, 1.1); ctx.stroke(); // gill plate
      break;
    case 'old_boot': {
      ctx.fillStyle = '#6b4a2f';
      rr(ctx, -st.w * 0.28, -st.h * 0.5, st.w * 0.5, st.h * 0.66, 4); ctx.fill();       // shaft
      rr(ctx, -st.w * 0.28, -st.h * 0.02, st.w, st.h * 0.4, 5); ctx.fill();             // foot
      ctx.fillStyle = '#3d2b1f';
      rr(ctx, -st.w * 0.32, st.h * 0.28, st.w * 1.08, st.h * 0.18, 3); ctx.fill();      // sole
      ctx.strokeStyle = '#3d2b1f'; ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-st.w * 0.24, -st.h * (0.36 - i * 0.14));
        ctx.lineTo(st.w * 0.16, -st.h * (0.28 - i * 0.14));
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(140,160,120,0.6)'; // stink wisps
      ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -st.h * 0.6); ctx.quadraticCurveTo(4, -st.h * 0.8, 0, -st.h * 0.95); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ── Component ──────────────────────────────────────────────────────

export function FishTossCanvas({ onGameOver, hazardMode, runSeconds, className }: FishTossCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxRef = useRef<Fx[]>([]);
  const reactionRef = useRef<Reaction | null>(null);
  const phraseTick = useRef(0);

  const physics = useFishTossPhysics({
    runSeconds,
    hazardMode,
    onGameOver,
    onCatch: kind => {
      if (kind === 'old_boot') {
        reactionRef.current = { t: 0, dur: 1.1, phrase: 'YUCK!', big: true };
        return;
      }
      const options = PHRASES[kind];
      reactionRef.current = {
        t: 0,
        dur: kind === 'king_salmon' ? 1.2 : 0.85,
        phrase: options[phraseTick.current++ % options.length],
        big: kind === 'king_salmon' || kind === 'dungeness_crab',
      };
      catchBurstRef.current = 1; // loop reads this to emit ice + droplets at the box
    },
    onMiss: (_kind, x, y) => {
      missQueueRef.current.push(x, y); // loop drains into splash particles
    },
  });
  const catchBurstRef = useRef(0);
  const missQueueRef = useRef<number[]>([]);

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
      physics.setPointerY(e.clientY - rect.top);
    };
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerdown', onPointer);

    let raf = 0;
    let last = performance.now();
    let t = 0; // ambient clock (lights, bob, glints)

    const emitFx = (kind: Fx['kind'], x: number, y: number, n: number, color: string) => {
      const fx = fxRef.current;
      for (let i = 0; i < n && fx.length < 48; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = kind === 'splash' ? 60 + Math.random() * 120 : 90 + Math.random() * 160;
        fx.push({
          kind, x, y,
          vx: Math.cos(a) * sp * (kind === 'splash' ? 0.6 : 1),
          vy: Math.sin(a) * sp - (kind === 'splash' ? 120 : 60),
          rot: Math.random() * Math.PI, rv: (Math.random() - 0.5) * 8,
          age: 0, ttl: 0.5 + Math.random() * 0.4, s: 2 + Math.random() * 3,
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

      // Drain FX requests queued by physics callbacks (allocation-light).
      if (catchBurstRef.current > 0) {
        const box = getCatcherBox(w, physics.playerYRef.current);
        emitFx('ice', box.cx - 20, box.cy - 10, 10, '#cfeef5');
        emitFx('drop', box.cx - 24, box.cy, 6, '#7fc4d8');
        catchBurstRef.current = 0;
      }
      const mq = missQueueRef.current;
      for (let i = 0; i < mq.length; i += 2) emitFx('splash', mq[i], mq[i + 1], 8, '#9fd4e0');
      mq.length = 0;

      // ── Scene ──
      const shake = physics.shakeRef.current;
      ctx.save();
      if (shake > 0) {
        ctx.translate((jitter(t * 60, 1) - 0.5) * shake * 22, (jitter(t * 60, 2) - 0.5) * shake * 22);
      }

      const horizon = h * 0.4;
      ctx.fillStyle = backdrop.sky;
      ctx.fillRect(0, 0, w, horizon);
      ctx.fillStyle = backdrop.water;
      ctx.fillRect(0, horizon, w, h - DOCK_H - horizon);
      // Far shoreline lights
      ctx.fillStyle = 'rgba(255,217,138,0.5)';
      for (let i = 0; i < 9; i++) dot(ctx, (i / 9) * w + 14, horizon - 3, 1.4);
      // Bay glints drift and wrap
      ctx.strokeStyle = 'rgba(180,225,235,0.28)';
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (const g of backdrop.glints) {
        g.x += g.v * dt; if (g.x > w + 20) g.x = -20;
        ctx.beginPath(); ctx.moveTo(g.x - 8 * g.s, g.y); ctx.lineTo(g.x + 8 * g.s, g.y); ctx.stroke();
      }

      // String lights: warm halos, no shadowBlur.
      ctx.strokeStyle = 'rgba(30,45,54,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      backdrop.bulbs.forEach((b, i) => (i === 0 || i === 9 ? ctx.moveTo(b.x, b.y) : ctx.lineTo(b.x, b.y)));
      ctx.stroke();
      for (let i = 0; i < backdrop.bulbs.length; i++) {
        const b = backdrop.bulbs[i];
        const sway = Math.sin(t * 1.4 + i) * 1.4;
        ctx.fillStyle = 'rgba(255,217,138,0.16)';
        dot(ctx, b.x + sway, b.y, 7);
        ctx.fillStyle = '#ffd98a';
        dot(ctx, b.x + sway, b.y, 2.6);
      }

      // ── The stall (left) ──
      const stallX = w * 0.02, stallW = w * 0.24;
      const counterY = h - DOCK_H - 46;
      ctx.fillStyle = '#3a2c1e';                                    // posts
      ctx.fillRect(stallX + 6, 96, 7, counterY - 96);
      ctx.fillRect(stallX + stallW - 13, 96, 7, counterY - 96);
      // Striped awning with scalloped hem
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#f4ede0' : '#c02a2a';
        ctx.fillRect(stallX + (i * stallW) / 6, 70, stallW / 6 + 1, 26);
      }
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#f4ede0' : '#c02a2a';
        ctx.beginPath(); ctx.arc(stallX + (i + 0.5) * (stallW / 6), 96, stallW / 12, 0, Math.PI); ctx.fill();
      }
      // Hanging sign
      ctx.fillStyle = '#243b44';
      rr(ctx, stallX + stallW * 0.16, 110, stallW * 0.68, 24, 5); ctx.fill();
      ctx.fillStyle = '#ffb347';
      ctx.font = `900 12px ${HUD_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('PIKE PLACE MARKET', stallX + stallW * 0.5, 126);
      // Counter + ice bed with tails poking out
      ctx.fillStyle = '#4a3626';
      rr(ctx, stallX, counterY, stallW, 40, 6); ctx.fill();
      ctx.fillStyle = '#dff2f7';
      ctx.beginPath(); ctx.ellipse(stallX + stallW / 2, counterY + 4, stallW * 0.44, 12, 0, Math.PI, 0); ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 1 ? '#a02026' : '#8fa3ad';
        const fx0 = stallX + stallW * (0.28 + i * 0.2);
        ctx.beginPath();
        ctx.moveTo(fx0, counterY - 2);
        ctx.lineTo(fx0 - 7, counterY - 14);
        ctx.lineTo(fx0 + 7, counterY - 14);
        ctx.closePath(); ctx.fill();
      }

      // ── Dock planks + wet sheen ──
      ctx.fillStyle = '#423322';
      ctx.fillRect(0, h - DOCK_H, w, DOCK_H);
      ctx.strokeStyle = 'rgba(20,14,8,0.8)'; ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(0, h - DOCK_H + (i * DOCK_H) / 4); ctx.lineTo(w, h - DOCK_H + (i * DOCK_H) / 4); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(20,14,8,0.5)';
      for (let x0 = 30; x0 < w; x0 += 84) {
        ctx.beginPath(); ctx.moveTo(x0, h - DOCK_H); ctx.lineTo(x0, h); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(190,225,235,0.08)'; // rain sheen
      ctx.beginPath(); ctx.ellipse(w * 0.35, h - DOCK_H * 0.4, w * 0.22, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w * 0.72, h - DOCK_H * 0.7, w * 0.14, 5, 0, 0, Math.PI * 2); ctx.fill();

      // ── Actors ──
      drawThrower(ctx, w * 0.13, h - DOCK_H + 6, physics.throwPulseRef.current, t * 2.1);
      const catcherBox = getCatcherBox(w, physics.playerYRef.current);
      drawCatcher(ctx, catcherBox.cx + 8, catcherBox.cy, physics.catchPulseRef.current, t * 2.6);

      // Catcher's holler bubble
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
          ctx.font = `900 ${reaction.big ? 24 : 18}px ${HUD_FONT}`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,15,20,0.85)';
          const ry = catcherBox.cy - 92 - pop * 12;
          ctx.strokeText(reaction.phrase, catcherBox.cx - 30, ry);
          ctx.fillStyle = reaction.big ? '#ffb347' : '#dff2f7';
          ctx.fillText(reaction.phrase, catcherBox.cx - 30, ry);
          ctx.restore();
        }
      }

      // ── Fish in flight ──
      for (const f of physics.fishRef.current) drawFish(ctx, f);

      // ── Particles (in-place compaction) ──
      const fx = fxRef.current;
      let write = 0;
      for (let i = 0; i < fx.length; i++) {
        const p = fx[i];
        p.age += dt;
        if (p.age >= p.ttl) continue;
        p.vy += 500 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.rv * dt;
        const a = 1 - p.age / p.ttl;
        ctx.save();
        ctx.globalAlpha = a;
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
      for (const p of physics.popupsRef.current as ScorePopup[]) {
        const a = 1 - p.age / p.ttl;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.font = `900 20px ${HUD_FONT}`;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,15,20,0.85)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      }

      // ── Drizzle (over everything — it's Seattle) ──
      ctx.strokeStyle = 'rgba(190,220,235,0.22)';
      ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (const d of backdrop.drizzle) {
        d.y += d.v * dt; d.x -= d.v * 0.12 * dt;
        if (d.y > h + 14) { d.y = -14; d.x = Math.random() * (w + 40); }
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 2.4 * d.s, d.y + 12 * d.s); ctx.stroke();
      }

      // ── Hazard flash ──
      if (physics.hazardFlashRef.current > 0) {
        ctx.fillStyle = `rgba(220,50,40,${physics.hazardFlashRef.current * 0.28})`;
        ctx.fillRect(0, 0, w, h);
      }

      // ── HUD ──
      const pulse = 1 + physics.catchPulseRef.current * 0.25;
      ctx.save();
      ctx.translate(16, 30);
      ctx.scale(pulse, pulse);
      ctx.textAlign = 'left';
      ctx.font = `900 24px ${HUD_FONT}`;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,15,20,0.85)';
      const scoreTxt = `${physics.scoreRef.current.toLocaleString()} pts`;
      ctx.strokeText(scoreTxt, 0, 0);
      ctx.fillStyle = '#ffb347';
      ctx.fillText(scoreTxt, 0, 0);
      ctx.restore();
      ctx.textAlign = 'left';
      ctx.font = `700 13px ${HUD_FONT}`;
      ctx.fillStyle = 'rgba(223,242,247,0.75)';
      ctx.fillText(`🐟 ×${physics.caughtRef.current}`, 16, 50);

      const tl = physics.timeLeftRef.current;
      const urgent = tl <= 5;
      ctx.textAlign = 'right';
      ctx.font = `900 24px ${HUD_FONT}`;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,15,20,0.85)';
      const timeTxt = `${Math.ceil(tl)}s`;
      const tx = w - 16 + (urgent ? (jitter(t * 30, 3) - 0.5) * 3 : 0);
      ctx.strokeText(timeTxt, tx, 30);
      ctx.fillStyle = urgent ? '#ff5d4d' : '#dff2f7';
      ctx.fillText(timeTxt, tx, 30);

      ctx.restore(); // shake
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerdown', onPointer);
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
