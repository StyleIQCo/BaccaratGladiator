// ═══════════════════════════════════════════════════════════════════
//  SNOQUALMIE NIGHT SHRED — canvas renderer.
//
//  React's only jobs here: mount the <canvas>, wire pointer events,
//  own the rAF loop's lifecycle. Every frame goes straight through
//  physics.step() → draw() on refs — zero setState during play.
//  (The Tailwind HUD up in SnowboardShredGame gets a throttled,
//  deduped onHud sample — a handful of renders per second, never 60.)
//
//  Art is 100% procedural: a moonlit night-session palette (deep
//  navy → purple), twinkling stars, ridge silhouettes at the horizon,
//  neon slalom gates (pink + cyan poles, translucent laser), snow-
//  tipped pines, glowing kickers, and the rider — crouched, carving,
//  360-ing at 1.5× scale off every kicker.
//
//  Renderer performance notes:
//    • DPR capped at 2 — 3× iPhone fill rate for zero visible gain.
//    • NO shadowBlur anywhere: neon glow is layered translucent
//      strokes/arcs. shadowBlur is a mobile GPU stall in a fast game.
//    • Night gradient, star field, speckle + speed-line pools are
//      built once per resize; per-frame they only advance and wrap.
//    • Pseudo-3D: entities scale 0.7 → 1.0 as they climb from the
//      bottom edge (far downhill) to the rider's row. The hitbox row
//      is where scale hits 1, so what you see is what you collide.
//    • Pointer → logical-x uses a cached bounding rect (refreshed on
//      resize), not a layout query per pointermove.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import {
  useSnowboardPhysics, getPlayerY, ENTITY_STATS, MPH_PER_PX, PLAYER_H,
  type RunSummary, type ScorePopup, type TrailEntity,
} from './useSnowboardPhysics';
import {
  primeAudio, startWind, updateWind, stopWind,
  sfxStart, sfxGate, sfxGateMissed, sfxWipeout, sfxRamp, sfxLand, sfxRunComplete,
} from './snowboardSfx';

export interface HudSample {
  mph: number;
  combo: number;
  time: number;       // whole seconds remaining
  speedFrac: number;  // quantized to 0.05 for the gauge bar
  score: number;
}

export interface SnoqualmieCanvasProps {
  onGameOver: (summary: RunSummary) => void;
  /** Throttled + deduped — fires only when a displayed value changes. */
  onHud?: (sample: HudSample) => void;
  runSeconds?: number;
  className?: string;
}

const HUD_FONT = '"Chalkboard SE", "Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';

// Night-session palette.
const PINK = '#ff4fd8';
const CYAN = '#29e6ff';
const ICE = 'rgba(150, 205, 255,';    // speed lines — append alpha)

const TRAIL_MAX = 20;                 // carve-trail points (~2/3 s of spray)
const TRAIL_EMIT = 1 / 30;            // seconds between emitted points
const MAX_FX = 48;                    // live spray particles, hard cap

// ── Deterministic helpers (no Math.random in the render loop) ──────

/** mulberry32 — tiny seeded PRNG for the ambient pools. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-entity jitter in [0,1) keyed off the spawn seed. */
function jitter(seed: number, i: number): number {
  const x = Math.sin(seed + i * 7.13) * 43758.5453;
  return x - Math.floor(x);
}

// ── Ambient scenery (rebuilt per resize, advanced per frame) ───────

interface Mote { x: number; y: number; s: number; v: number }
interface Star { x: number; y: number; r: number; ph: number }
interface Night {
  grad: CanvasGradient;
  stars: Star[];
  ridgeFar: number[];    // y-offsets across the horizon band
  ridgeNear: number[];
  speckles: Mote[];      // slow snow texture — sells the ground moving
  lines: Mote[];         // fast ice-blue streaks — sells SPEED
  rng: () => number;
}

function buildNight(ctx: CanvasRenderingContext2D, w: number, h: number): Night {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#07071f');      // zenith
  grad.addColorStop(0.18, '#101038');   // horizon glow
  grad.addColorStop(0.45, '#1a1345');   // upper slope
  grad.addColorStop(1, '#241a55');      // deep purple runout
  const rng = mulberry32(0x5109c0de);
  const stars: Star[] = [];
  for (let i = 0; i < 42; i++) {
    stars.push({ x: rng() * w, y: rng() * h * 0.14, r: 0.6 + rng() * 1.1, ph: rng() * Math.PI * 2 });
  }
  const ridgeFar: number[] = [];
  const ridgeNear: number[] = [];
  for (let i = 0; i <= 12; i++) {
    ridgeFar.push(rng() * 26);
    ridgeNear.push(rng() * 40);
  }
  const speckles: Mote[] = [];
  for (let i = 0; i < 46; i++) {
    speckles.push({ x: rng() * w, y: rng() * h, s: 0.6 + rng() * 1.2, v: 0.55 + rng() * 0.3 });
  }
  const lines: Mote[] = [];
  for (let i = 0; i < 14; i++) {
    lines.push({ x: rng() * w, y: rng() * h, s: 0.5 + rng() * 0.9, v: 1.3 + rng() * 0.5 });
  }
  return { grad, stars, ridgeFar, ridgeNear, speckles, lines, rng };
}

function drawBackdrop(ctx: CanvasRenderingContext2D, night: Night, w: number, h: number, t: number): void {
  ctx.fillStyle = night.grad;
  ctx.fillRect(0, 0, w, h);

  // Moon + halo (three arcs — no gradients allocated per frame).
  const mx = w * 0.78, my = h * 0.055;
  ctx.fillStyle = 'rgba(220, 230, 255, 0.07)'; dot(ctx, mx, my, 34);
  ctx.fillStyle = 'rgba(220, 230, 255, 0.12)'; dot(ctx, mx, my, 22);
  ctx.fillStyle = '#e8ecff'; dot(ctx, mx, my, 13);

  for (const s of night.stars) {
    const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.9 + s.ph));
    ctx.fillStyle = `rgba(210, 225, 255, ${(tw * 0.8).toFixed(3)})`;
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }

  // Ridge silhouettes across the horizon — the static frame that makes
  // everything scrolling below it read as OUR motion.
  const seg = w / 12;
  ctx.fillStyle = '#0c0c30';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.16);
  night.ridgeFar.forEach((o, i) => ctx.lineTo(i * seg, h * 0.16 - o));
  ctx.lineTo(w, h * 0.2); ctx.lineTo(0, h * 0.2);
  ctx.fill();
  ctx.fillStyle = '#12103a';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.2);
  night.ridgeNear.forEach((o, i) => ctx.lineTo(i * seg, h * 0.2 - o));
  ctx.lineTo(w, h * 0.24); ctx.lineTo(0, h * 0.24);
  ctx.fill();
}

/** Ground texture + speed lines. Advance ∝ scroll speed, wrap at edges. */
function drawGroundMotion(
  ctx: CanvasRenderingContext2D, night: Night, w: number, h: number,
  scrollV: number, speedFrac: number, dt: number, running: boolean,
): void {
  for (const m of night.speckles) {
    if (running) m.y -= scrollV * m.v * dt;
    if (m.y < -4) { m.y = h + 4; m.x = night.rng() * w; }
    ctx.fillStyle = `rgba(200, 215, 255, ${(0.1 + 0.14 * m.s).toFixed(3)})`;
    ctx.fillRect(m.x, m.y, 1.6 * m.s, 1.6 * m.s);
  }
  // Ice-blue verticals: longer, brighter, faster as speed builds.
  const alpha = 0.1 + speedFrac * 0.34;
  ctx.lineWidth = 2;
  for (const l of night.lines) {
    if (running) l.y -= scrollV * l.v * dt;
    const len = (20 + 52 * speedFrac) * l.s;
    if (l.y < -len) { l.y = h + 10; l.x = night.rng() * w; }
    ctx.strokeStyle = `${ICE} ${(alpha * l.s).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(l.x, l.y + len);
    ctx.stroke();
  }
  // Trail walls: darkened banks pull the eye down the run's throat.
  ctx.fillStyle = 'rgba(6, 6, 26, 0.5)';
  ctx.fillRect(0, 0, 16, h);
  ctx.fillRect(w - 16, 0, 16, h);
}

// ── Path helpers ───────────────────────────────────────────────────

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function tri(ctx: CanvasRenderingContext2D, x: number, y: number, hw: number, hh: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - hh);
  ctx.lineTo(x + hw, y + hh);
  ctx.lineTo(x - hw, y + hh);
  ctx.closePath();
}

/** Vertical stadium — the board. */
function boardPath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const r = w / 2;
  ctx.beginPath();
  ctx.moveTo(-r, -h / 2 + r);
  ctx.arc(0, -h / 2 + r, r, Math.PI, 0);
  ctx.lineTo(r, h / 2 - r);
  ctx.arc(0, h / 2 - r, r, 0, Math.PI);
  ctx.closePath();
}

/** Neon pole: layered translucent arcs — glow without shadowBlur. */
function neonPole(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, pulse: number): void {
  ctx.globalAlpha = 0.1 + pulse * 0.06;
  ctx.fillStyle = color; dot(ctx, x, y, 15);
  ctx.globalAlpha = 0.22 + pulse * 0.1;
  dot(ctx, x, y, 9);
  ctx.globalAlpha = 1;
  dot(ctx, x, y, 4.5);
  ctx.fillStyle = '#ffffff';
  dot(ctx, x, y, 1.8);
}

// ── Entity art ─────────────────────────────────────────────────────

function drawGate(ctx: CanvasRenderingContext2D, e: TrailEntity, t: number): void {
  const half = e.gapW / 2;
  const pulse = 0.5 + 0.5 * Math.sin(t * 5 + e.seed);
  const lx = e.x - half, rx = e.x + half;
  // The laser: pink from the left pole, cyan from the right, a white
  // core where they meet — reads as a blend, allocates nothing.
  ctx.lineWidth = 7;
  ctx.strokeStyle = `rgba(255, 79, 216, ${(0.12 + pulse * 0.06).toFixed(3)})`;
  ctx.beginPath(); ctx.moveTo(lx, e.y); ctx.lineTo(e.x, e.y); ctx.stroke();
  ctx.strokeStyle = `rgba(41, 230, 255, ${(0.12 + pulse * 0.06).toFixed(3)})`;
  ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(rx, e.y); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgba(255, 255, 255, ${(0.3 + pulse * 0.25).toFixed(3)})`;
  ctx.beginPath(); ctx.moveTo(lx, e.y); ctx.lineTo(rx, e.y); ctx.stroke();

  neonPole(ctx, lx, e.y, PINK, pulse);
  neonPole(ctx, rx, e.y, CYAN, pulse);

  if (e.scored) {
    // Post-cross flare so a cleared gate visibly "spends" itself.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(lx, e.y); ctx.lineTo(rx, e.y); ctx.stroke();
  }
}

function drawTree(ctx: CanvasRenderingContext2D, e: TrailEntity): void {
  const s = 0.85 + jitter(e.seed, 1) * 0.35;   // per-tree size personality
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(s, s);
  ctx.fillStyle = '#2c1c10';                    // trunk stub
  ctx.fillRect(-3, 18, 6, 10);
  // Three overlapping tiers, dark green, each with a snow-white tip.
  const tiers: [number, number, number, string][] = [
    [14, 22, 20, '#0d3b24'],
    [4, 19, 16, '#12482c'],
    [-6, 15, 13, '#175534'],
  ];
  for (const [cy, hw, hh, col] of tiers) {
    ctx.fillStyle = col;
    tri(ctx, 0, cy, hw, hh);
    ctx.fill();
    ctx.fillStyle = '#eaf4ff';                  // moonlit snow tip
    tri(ctx, 0, cy - hh * 0.55, hw * 0.32, hh * 0.4);
    ctx.fill();
  }
  ctx.restore();
}

function drawRock(ctx: CanvasRenderingContext2D, e: TrailEntity): void {
  const s = 0.85 + jitter(e.seed, 2) * 0.3;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(s, s);
  ctx.fillStyle = '#3c4258';
  ctx.beginPath();
  ctx.moveTo(-20, 13); ctx.lineTo(-14, -8); ctx.lineTo(-2, -14);
  ctx.lineTo(13, -9); ctx.lineTo(21, 8); ctx.lineTo(12, 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2b3044';                    // shaded facet
  ctx.beginPath();
  ctx.moveTo(-2, -14); ctx.lineTo(13, -9); ctx.lineTo(21, 8); ctx.lineTo(4, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e6efff';                    // snow cap
  ctx.beginPath();
  ctx.moveTo(-14, -8); ctx.lineTo(-2, -14); ctx.lineTo(13, -9); ctx.lineTo(2, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRamp(ctx: CanvasRenderingContext2D, e: TrailEntity, t: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 + e.seed);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.fillStyle = '#c7d6f2';                    // packed-snow deck
  ctx.beginPath();
  ctx.moveTo(-30, 18); ctx.lineTo(-20, -16); ctx.lineTo(20, -16); ctx.lineTo(30, 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#93a8d6';                    // undercut shadow at the lip
  ctx.beginPath();
  ctx.moveTo(-20, -16); ctx.lineTo(20, -16); ctx.lineTo(17, -11); ctx.lineTo(-17, -11);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(41, 230, 255, ${(0.5 + pulse * 0.5).toFixed(3)})`; // neon lip
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-20, -16); ctx.lineTo(20, -16); ctx.stroke();
  ctx.strokeStyle = `rgba(41, 230, 255, ${(0.35 + pulse * 0.3).toFixed(3)})`; // GO chevrons
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const cy = 10 - i * 11;
    ctx.beginPath();
    ctx.moveTo(-9, cy); ctx.lineTo(0, cy - 7); ctx.lineTo(9, cy);
    ctx.stroke();
  }
  ctx.restore();
}

// ── The rider ──────────────────────────────────────────────────────

function drawRider(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, tilt: number,
  rider: 'carving' | 'airborne' | 'wiped_out',
  airFrac: number, invuln: number, t: number,
): void {
  ctx.save();

  // i-frames: hard blink — the universal arcade "can't be hurt" signal.
  if (invuln > 0 && Math.sin(t * 24) > 0) ctx.globalAlpha = 0.3;

  const hop = rider === 'airborne' ? Math.sin(Math.PI * airFrac) * 36 : 0;

  // Ground shadow stays on the snow — its shrink IS the altitude cue.
  const shScale = 1 - hop / 90;
  ctx.fillStyle = `rgba(4, 4, 20, ${(0.35 * shScale).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x, y + PLAYER_H / 2 - 4, 20 * shScale, 7 * shScale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(x, y - hop);
  if (rider === 'airborne') {
    // The trick: one full 360 across the airtime, 1.5× at the apex.
    const s = 1 + 0.5 * Math.sin(Math.PI * airFrac);
    ctx.scale(s, s);
    ctx.rotate(Math.PI * 2 * airFrac);
  } else if (rider === 'wiped_out') {
    ctx.rotate(Math.sin(t * 13) * 0.6);         // ragdoll flail
  } else {
    ctx.rotate(tilt);                           // lean into the carve
  }

  // Board (under everything).
  ctx.save();
  ctx.rotate(rider === 'carving' ? tilt * 0.6 : 0);   // board angles harder than the body
  boardPath(ctx, 13, 48);
  ctx.fillStyle = '#f43fa6';
  ctx.fill();
  ctx.strokeStyle = '#ffd0ec';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#1a1030';                    // deck stripe
  ctx.fillRect(-2, -17, 4, 34);
  ctx.restore();

  if (rider === 'wiped_out') {
    // Yard-sale heap: tucked ball, legs up, stars optional.
    ctx.fillStyle = '#2ee6d6';
    dot(ctx, 0, -2, 10);
    ctx.fillStyle = '#26314e';
    dot(ctx, -7, 6, 5); dot(ctx, 8, 5, 5);      // boots somewhere unhelpful
    ctx.fillStyle = '#ffd9b8';
    dot(ctx, 3, -12, 6);                        // dazed head
    ctx.fillStyle = PINK;
    ctx.beginPath(); ctx.arc(3, -15, 6, Math.PI, 0); ctx.fill();  // beanie hanging on
  } else {
    // Crouched rider, top-down-ish: boots planted, knees driving, torso
    // low over the board, arms out for balance.
    ctx.fillStyle = '#151f38';                                    // boots
    ctx.fillRect(-6, -14, 12, 7);
    ctx.fillRect(-6, 8, 12, 7);
    ctx.strokeStyle = '#26314e';                                  // bent legs
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-3, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(-3, 3); ctx.stroke();
    ctx.fillStyle = '#2ee6d6';                                    // jacket
    ctx.beginPath();
    ctx.ellipse(-2, 0, 8, 12, tilt * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2ee6d6';                                  // arms out
    ctx.lineWidth = 5;
    const flail = rider === 'airborne' ? Math.sin(airFrac * Math.PI * 2) * 4 : 0;
    ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(-15, -10 - flail); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, 6); ctx.lineTo(-15, 10 + flail); ctx.stroke();
    ctx.fillStyle = '#ffd9b8';                                    // head
    dot(ctx, 2, 0, 6);
    ctx.fillStyle = PINK;                                         // beanie
    ctx.beginPath(); ctx.arc(2, 0, 6, -Math.PI * 0.75, Math.PI * 0.75); ctx.fill();
    dot(ctx, 6, 0, 2.5);                                          // pom
    ctx.fillStyle = CYAN;                                         // goggle glint
    ctx.fillRect(-2, -4, 3, 8);
  }
  ctx.restore();
}

// ── Carve trail + spray FX ─────────────────────────────────────────

interface TrailPt { x: number; y: number }
interface Fx { x: number; y: number; vx: number; vy: number; age: number; ttl: number; s: number }

function drawTrail(ctx: CanvasRenderingContext2D, pts: TrailPt[]): void {
  // Oldest → newest: width and alpha both grow toward the board, so the
  // spray reads as freshly-cut edge dissolving up-slope behind you.
  ctx.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    const k = i / pts.length;
    ctx.strokeStyle = `rgba(235, 245, 255, ${(k * 0.4).toFixed(3)})`;
    ctx.lineWidth = 1.5 + k * 5.5;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

function spawnSpray(fx: Fx[], x: number, y: number, count: number, wide: number): void {
  for (let i = 0; i < count && fx.length < MAX_FX; i++) {
    fx.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * wide,
      vy: 30 + Math.random() * 70,
      age: 0,
      ttl: 0.3 + Math.random() * 0.3,
      s: 1.5 + Math.random() * 2,
    });
  }
}

function updateAndDrawFx(ctx: CanvasRenderingContext2D, fx: Fx[], dt: number): void {
  for (const p of fx) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  let write = 0;
  for (let i = 0; i < fx.length; i++) {
    if (fx[i].age < fx[i].ttl) fx[write++] = fx[i];
  }
  fx.length = write;
  for (const p of fx) {
    ctx.fillStyle = `rgba(230, 242, 255, ${((1 - p.age / p.ttl) * 0.7).toFixed(3)})`;
    ctx.fillRect(p.x, p.y, p.s, p.s);
  }
}

function drawPopups(ctx: CanvasRenderingContext2D, popups: ScorePopup[], w: number): void {
  ctx.textAlign = 'center';
  for (const p of popups) {
    const k = p.age / p.ttl;
    const scale = k < 0.15 ? 0.6 + (k / 0.15) * 0.4 : 1;          // pop-in
    ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
    ctx.font = `900 ${Math.round(19 * scale)}px ${HUD_FONT}`;
    const x = Math.min(Math.max(p.x, 60), w - 60);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(6, 6, 26, 0.85)';
    ctx.strokeText(p.text, x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, x, p.y);
  }
  ctx.globalAlpha = 1;
}

// ── The component ──────────────────────────────────────────────────

export function SnoqualmieCanvas({ onGameOver, onHud, runSeconds, className }: SnoqualmieCanvasProps) {
  const fxRef = useRef<Fx[]>([]);
  const pendingSprayRef = useRef<'wipeout' | 'land' | null>(null);

  const physics = useSnowboardPhysics({
    runSeconds,
    onGameOver: summary => {
      stopWind();            // the mountain goes quiet under the results card
      sfxRunComplete();
      onGameOver(summary);
    },
    onEvent: (ev, combo) => {
      switch (ev) {
        case 'gate': sfxGate(combo); break;
        case 'gate_missed': sfxGateMissed(); break;
        case 'wipeout': sfxWipeout(); pendingSprayRef.current = 'wipeout'; break;
        case 'ramp': sfxRamp(); break;
        case 'land': sfxLand(); pendingSprayRef.current = 'land'; break;
      }
    },
  });

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrap || !canvas || !ctx) return;

    const view = { w: 0, h: 0, dpr: 1, left: 0 };
    let night: Night | null = null;

    const fit = () => {
      const rect = wrap.getBoundingClientRect();
      view.w = rect.width;
      view.h = rect.height;
      view.left = rect.left;
      view.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * view.dpr);
      canvas.height = Math.round(rect.height * view.dpr);
      night = buildNight(ctx, view.w, view.h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    // Drag anywhere on the canvas; hover also steers on desktop.
    const onPointer = (e: PointerEvent) => {
      physics.setPointerX(e.clientX - view.left);
    };
    const onPointerDown = (e: PointerEvent) => {
      primeAudio();     // second line of defense for the iOS gesture rule
      startWind();      // no-ops if the bed is already blowing
      onPointer(e);
    };
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerdown', onPointerDown);

    physics.start(view.w);
    sfxStart();
    startWind();        // audible immediately if the SHRED tap primed audio

    // Renderer-local state (cosmetic only — not gameplay).
    const trail: TrailPt[] = [];
    let trailClock = 0;
    let sprayClock = 0;
    const lastHud: HudSample = { mph: -1, combo: -1, time: -1, speedFrac: -1, score: -1 };

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = now / 1000;

      physics.step(dt, view.w, view.h);

      const { w, h } = view;
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!night) return;

      const running = physics.statusRef.current === 'running';
      const speed = physics.speedRef.current;
      const speedFrac = physics.speedFracRef.current;
      const px = physics.playerXRef.current;
      const vx = physics.playerVxRef.current;
      const playerY = getPlayerY(h);
      const rider = physics.riderRef.current;

      // ── Backdrop + motion layers (frozen with the world at game over) ──
      drawBackdrop(ctx, night, w, h, t);
      drawGroundMotion(ctx, night, w, h, speed, speedFrac, dt, running);

      // ── Carve trail bookkeeping ──
      if (running) {
        for (const p of trail) p.y -= speed * dt;     // spray rides the world
        trailClock += dt;
        if (rider === 'carving' && trailClock >= TRAIL_EMIT) {
          trailClock = 0;
          trail.push({ x: px - Math.sin(vx * 0.001) * 6, y: playerY + PLAYER_H / 2 });
          if (trail.length > TRAIL_MAX) trail.shift();
        }
        // Hard carving kicks up extra powder off the tail.
        const carveFrac = Math.min(Math.abs(vx) / 520, 1);
        sprayClock += dt;
        if (rider === 'carving' && carveFrac > 0.4 && sprayClock > 0.05) {
          sprayClock = 0;
          spawnSpray(fxRef.current, px - Math.sign(vx) * 10, playerY + 16, 2, 120);
        }
        updateWind(speedFrac, carveFrac);
      }

      // ── World (shaken as one group after a wipeout) ──
      const shake = physics.shakeRef.current;
      ctx.save();
      if (shake > 0) {
        ctx.translate(Math.sin(t * 71) * shake * 14, Math.cos(t * 67) * shake * 10);
      }

      drawTrail(ctx, trail);

      if (pendingSprayRef.current) {
        spawnSpray(fxRef.current, px, playerY + 10, pendingSprayRef.current === 'wipeout' ? 14 : 8, 260);
        pendingSprayRef.current = null;
      }

      // Pseudo-3D: grow from 0.7 at the bottom edge (far downhill) to
      // 1.0 at the rider's row — where the physics hitbox lives.
      for (const e of physics.entitiesRef.current) {
        const appr = Math.min(Math.max((h - e.y) / Math.max(h - playerY, 1), 0), 1);
        const ds = 0.7 + 0.3 * appr;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.scale(ds, ds);
        ctx.translate(-e.x, -e.y);
        switch (e.kind) {
          case 'gate': drawGate(ctx, e, t); break;
          case 'tree': drawTree(ctx, e); break;
          case 'rock': drawRock(ctx, e); break;
          case 'ramp': drawRamp(ctx, e, t); break;
        }
        ctx.restore();
      }

      const tilt = Math.min(Math.max(vx * 0.0009, -0.5), 0.5);
      drawRider(ctx, px, playerY, tilt, rider, physics.airFracRef.current, physics.invulnRef.current, t);

      updateAndDrawFx(ctx, fxRef.current, running ? dt : 0);
      drawPopups(ctx, physics.popupsRef.current, w);
      ctx.restore();

      // ── Screen-space feedback ──
      const flash = physics.wipeFlashRef.current;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255, 40, 20, ${(flash * 0.26).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (physics.timeLeftRef.current <= 5 && running) {
        ctx.strokeStyle = `rgba(41, 230, 255, ${(0.25 + 0.2 * Math.sin(t * 10)).toFixed(3)})`;
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, w - 6, h - 6);       // the lodge lights are close
      }

      // ── HUD sample: quantized + deduped, so React sees a handful of
      //    updates per second instead of sixty. ──
      if (onHud && running) {
        const mph = Math.round(speed * MPH_PER_PX);
        const combo = physics.comboRef.current;
        const time = Math.ceil(physics.timeLeftRef.current);
        const sf = Math.round(speedFrac * 20) / 20;
        const score = physics.scoreRef.current;
        if (mph !== lastHud.mph || combo !== lastHud.combo || time !== lastHud.time
          || sf !== lastHud.speedFrac || score !== lastHud.score) {
          lastHud.mph = mph; lastHud.combo = combo; lastHud.time = time;
          lastHud.speedFrac = sf; lastHud.score = score;
          onHud({ mph, combo, time, speedFrac: sf, score });
        }
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerdown', onPointerDown);
      stopWind();
    };
    // onHud is read from the closure but intentionally not a dep: the
    // wrapper passes a stable useCallback, and the loop must mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physics]);

  return (
    <div ref={wrapRef} className={className ?? 'h-full w-full'}>
      {/* touch-action:none — the drag IS the game; never let iOS scroll/bounce eat it */}
      <canvas ref={canvasRef} className="h-full w-full" style={{ touchAction: 'none', display: 'block' }} />
    </div>
  );
}
