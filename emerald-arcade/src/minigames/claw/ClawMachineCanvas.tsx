'use client';

// ═══════════════════════════════════════════════════════════════════
//  EMERALD CITY CLAW — canvas renderer.
//
//  Runs on the shared useArcadeEngine (fixed-timestep update feeds
//  useClawPhysics; render draws once per rAF). No DOM in the scene,
//  no React state in the hot path — the wrapper's buttons reach the
//  sim through an imperative apiRef, and touch-drags on the glass
//  steer the trolley directly.
//
//  The sim runs in a fixed 400×560 WORLD space; this component owns
//  the fit-and-center transform, so physics are identical on every
//  device (engine convention: speeds never scale with the screen).
//
//  Layers, back to front:
//    1. Backdrop (offscreen-cached per resize): cabinet shell, the
//       marquee, interior back wall with a Seattle skyline decal,
//       the pit floor, the chute + divider, WIN sign.
//    2. Dynamic scene (world transform + screen shake): rail,
//       trolley, swaying cable, the 3-prong claw with animated hinge
//       angles, every item as native vector art (the Chihuly orb
//       gets its pulsing golden legendary aura), particles.
//    3. Glass overlay (offscreen-cached): diagonal reflection
//       streaks + vignette across the front pane.
//    4. Neon frame: pink/cyan border lights, alive with a slow pulse
//       and an occasional flicker.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import {
  useArcadeEngine,
  type ArcadePointer,
  type ArcadeSize,
} from '../../hooks/useArcadeEngine';
import {
  CHUTE_HOME_X,
  CHUTE_WALL_TOP,
  CHUTE_WALL_X,
  CLAW_NECK,
  FLOOR_Y,
  PALM_R,
  RAIL_Y,
  RUN_TOKENS_DEFAULT,
  WALL_L,
  WALL_R,
  WORLD_H,
  WORLD_W,
  useClawPhysics,
  type ClawBody,
  type ClawItemType,
  type ClawPhase,
  type ClawPrize,
  type ClawSim,
  type MotorKind,
} from './useClawPhysics';

// ── Public surface ─────────────────────────────────────────────────

export interface ClawCanvasApi {
  /** Hold −1 (left) / +1 (right), release with 0. */
  setDir: (dir: -1 | 0 | 1) => void;
  drop: () => void;
}

export interface ClawMachineCanvasProps {
  tokens?: number;
  seed?: number;
  /** Imperative controls for the wrapper's LEFT/RIGHT/DROP overlay. */
  apiRef?: MutableRefObject<ClawCanvasApi | null>;
  onPhaseChange?: (phase: ClawPhase) => void;
  onImpact?: (strength: number) => void;
  onGrab?: (hit: boolean, type?: ClawItemType, quality?: number) => void;
  onSlip?: (type: ClawItemType) => void;
  onPrize?: (prize: ClawPrize) => void;
  onMotor?: (kind: MotorKind, on: boolean) => void;
  onDeny?: () => void;
  onHudTick?: (tokensLeft: number, chips: number) => void;
  onGameOver?: (chips: number, prizes: ClawPrize[]) => void;
  className?: string;
}

// ── Palette ────────────────────────────────────────────────────────

const NEON_PINK = '#ff5ce1';
const NEON_CYAN = '#37e5ff';
const STEEL_HI = '#dfe8f2';
const STEEL_MID = '#8b99ad';
const STEEL_LO = '#46536a';

interface View {
  s: number;
  ox: number;
  oy: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  size: number;
  color: string;
  gravity: number;
}

interface Fx {
  particles: Particle[];
  shake: number;
  chuteFlash: number;
  time: number;
}

const MAX_PARTICLES = 120;

function spawnBurst(
  fx: Fx,
  x: number,
  y: number,
  count: number,
  color: string,
  speed: number,
  gravity: number,
  ttl: number,
) {
  for (let i = 0; i < count; i++) {
    if (fx.particles.length >= MAX_PARTICLES) fx.particles.shift();
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.35 + Math.random() * 0.65);
    fx.particles.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - speed * 0.4,
      age: 0,
      ttl: ttl * (0.6 + Math.random() * 0.4),
      size: 1.5 + Math.random() * 2.5,
      color,
      gravity,
    });
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── Static layers (painted once per resize) ────────────────────────

function fitView(size: ArcadeSize): View {
  const s = Math.min(size.w / WORLD_W, size.h / WORLD_H);
  return { s, ox: (size.w - WORLD_W * s) / 2, oy: (size.h - WORLD_H * s) / 2 };
}

function paintBackdrop(size: ArcadeSize, view: View): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(size.w * size.dpr));
  off.height = Math.max(1, Math.round(size.h * size.dpr));
  const ctx = off.getContext('2d')!;
  ctx.scale(size.dpr, size.dpr);

  // Arcade-floor void behind the cabinet (letterbox area).
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, size.w, size.h);

  ctx.translate(view.ox, view.oy);
  ctx.scale(view.s, view.s);

  // Cabinet shell.
  const shell = ctx.createLinearGradient(0, 0, WORLD_W, 0);
  shell.addColorStop(0, '#101726');
  shell.addColorStop(0.5, '#1a2436');
  shell.addColorStop(1, '#0d1320');
  roundRect(ctx, 8, 6, WORLD_W - 16, WORLD_H - 12, 18);
  ctx.fillStyle = shell;
  ctx.fill();

  // Marquee band.
  const marq = ctx.createLinearGradient(0, 10, 0, 52);
  marq.addColorStop(0, '#0a0f1b');
  marq.addColorStop(1, '#141d30');
  roundRect(ctx, 16, 12, WORLD_W - 32, 40, 10);
  ctx.fillStyle = marq;
  ctx.fill();
  ctx.font = "800 19px 'Avenir Next', Futura, 'Trebuchet MS', system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = NEON_CYAN;
  ctx.shadowColor = NEON_CYAN;
  ctx.shadowBlur = 12;
  ctx.fillText('EMERALD CITY CLAW', WORLD_W / 2, 33);
  ctx.shadowBlur = 0;
  // Marquee bulbs.
  for (let i = 0; i < 12; i++) {
    const bx = 30 + (i * (WORLD_W - 60)) / 11;
    ctx.beginPath();
    ctx.arc(bx, i % 2 === 0 ? 17 : 47, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,92,225,0.8)' : 'rgba(255,215,94,0.8)';
    ctx.fill();
  }

  // Glass interior: deep rainy-night back wall.
  const wall = ctx.createLinearGradient(0, 56, 0, FLOOR_Y);
  wall.addColorStop(0, '#0a1524');
  wall.addColorStop(0.7, '#0e1e33');
  wall.addColorStop(1, '#122741');
  ctx.fillStyle = wall;
  ctx.fillRect(WALL_L - 6, 56, WALL_R - WALL_L + 12, FLOOR_Y - 56 + 24);

  // Seattle skyline decal on the back wall.
  ctx.fillStyle = 'rgba(6, 12, 22, 0.9)';
  ctx.beginPath();
  ctx.moveTo(WALL_L, FLOOR_Y);
  const towers = [
    [40, 380], [72, 352], [96, 396], [128, 344], [150, 372], [182, 330],
    [214, 372], [238, 348], [268, 388], [296, 340], [326, 368], [352, 384],
  ];
  let px = WALL_L;
  for (const [tx, ty] of towers) {
    ctx.lineTo(px, ty);
    ctx.lineTo(tx, ty);
    px = tx;
  }
  ctx.lineTo(WALL_R, 392);
  ctx.lineTo(WALL_R, FLOOR_Y);
  ctx.closePath();
  ctx.fill();
  // Space Needle silhouette.
  ctx.fillStyle = 'rgba(8, 16, 28, 0.95)';
  ctx.fillRect(196, 320, 5, 74);
  ctx.beginPath();
  ctx.ellipse(198.5, 318, 17, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(197, 300, 3, 16);
  // A few lit windows.
  ctx.fillStyle = 'rgba(255, 214, 140, 0.28)';
  for (const [wx, wy] of [[60, 370], [130, 356], [246, 362], [304, 352], [340, 376]]) {
    ctx.fillRect(wx, wy, 3, 4);
  }

  // Pit floor: steel deck plate.
  const deck = ctx.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 22);
  deck.addColorStop(0, '#2a3a52');
  deck.addColorStop(1, '#141d2e');
  ctx.fillStyle = deck;
  ctx.fillRect(CHUTE_WALL_X, FLOOR_Y, WALL_R + 6 - CHUTE_WALL_X, 22);
  ctx.strokeStyle = 'rgba(120, 140, 170, 0.25)';
  ctx.lineWidth = 1;
  for (let x = CHUTE_WALL_X + 14; x < WALL_R; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, FLOOR_Y + 3);
    ctx.lineTo(x + 10, FLOOR_Y + 3);
    ctx.stroke();
  }

  // The chute: a dark drop shaft with a glowing WIN mouth.
  const shaft = ctx.createLinearGradient(0, CHUTE_WALL_TOP, 0, WORLD_H);
  shaft.addColorStop(0, '#060a13');
  shaft.addColorStop(1, '#010205');
  ctx.fillStyle = shaft;
  ctx.fillRect(WALL_L - 6, FLOOR_Y, CHUTE_WALL_X - WALL_L + 6, WORLD_H - FLOOR_Y - 6);

  // Divider wall between chute and pit.
  const div = ctx.createLinearGradient(CHUTE_WALL_X - 4, 0, CHUTE_WALL_X + 4, 0);
  div.addColorStop(0, STEEL_LO);
  div.addColorStop(0.5, STEEL_MID);
  div.addColorStop(1, '#2c3850');
  ctx.fillStyle = div;
  ctx.fillRect(CHUTE_WALL_X - 3.5, CHUTE_WALL_TOP, 7, FLOOR_Y - CHUTE_WALL_TOP + 20);
  ctx.fillStyle = STEEL_HI;
  ctx.fillRect(CHUTE_WALL_X - 3.5, CHUTE_WALL_TOP, 7, 2.5);

  // WIN sign over the chute mouth.
  ctx.font = "800 12px 'Avenir Next', Futura, system-ui, sans-serif";
  ctx.fillStyle = '#ffd75e';
  ctx.shadowColor = '#ffd75e';
  ctx.shadowBlur = 10;
  ctx.fillText('★ WIN ★', (WALL_L + CHUTE_WALL_X) / 2 - 3, CHUTE_WALL_TOP - 10);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255, 215, 94, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(WALL_L + 8, FLOOR_Y + 4);
  ctx.lineTo((WALL_L + CHUTE_WALL_X) / 2 - 3, FLOOR_Y + 14);
  ctx.lineTo(CHUTE_WALL_X - 12, FLOOR_Y + 4);
  ctx.stroke();

  // Side glass edge highlights.
  ctx.fillStyle = 'rgba(150, 200, 255, 0.10)';
  ctx.fillRect(WALL_L - 6, 56, 3, FLOOR_Y - 40);
  ctx.fillRect(WALL_R + 3, 56, 3, FLOOR_Y - 40);

  // Cabinet base: coin door + speaker dots.
  roundRect(ctx, 24, WORLD_H - 46, 66, 30, 6);
  ctx.fillStyle = '#0a0f1b';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 92, 225, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 215, 94, 0.75)';
  ctx.fillRect(52, WORLD_H - 38, 10, 3);
  ctx.fillStyle = 'rgba(140, 160, 190, 0.4)';
  for (let i = 0; i < 15; i++) {
    ctx.beginPath();
    ctx.arc(WORLD_W - 60 + (i % 5) * 9, WORLD_H - 40 + Math.floor(i / 5) * 9, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  return off;
}

function paintGlassOverlay(size: ArcadeSize, view: View): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(size.w * size.dpr));
  off.height = Math.max(1, Math.round(size.h * size.dpr));
  const ctx = off.getContext('2d')!;
  ctx.scale(size.dpr, size.dpr);
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.s, view.s);

  // Clip to the glass pane.
  ctx.beginPath();
  ctx.rect(WALL_L - 6, 56, WALL_R - WALL_L + 12, FLOOR_Y - 34);
  ctx.clip();

  // Diagonal reflection streaks.
  for (const [start, width, alpha] of [
    [0.12, 30, 0.05],
    [0.3, 14, 0.07],
    [0.62, 44, 0.045],
    [0.84, 10, 0.06],
  ]) {
    const x0 = WALL_L + (WALL_R - WALL_L) * start;
    const g = ctx.createLinearGradient(x0, 56, x0 + width, 56);
    g.addColorStop(0, 'rgba(200, 225, 255, 0)');
    g.addColorStop(0.5, `rgba(200, 225, 255, ${alpha})`);
    g.addColorStop(1, 'rgba(200, 225, 255, 0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.transform(1, 0, -0.32, 1, 0, 0); // shear for the diagonal
    ctx.fillRect(x0 + 120, 56, width, FLOOR_Y);
    ctx.restore();
  }

  // Dark reflection vignette pooling at the pane edges.
  const vig = ctx.createRadialGradient(
    WORLD_W / 2, 260, 120,
    WORLD_W / 2, 260, 320,
  );
  vig.addColorStop(0, 'rgba(2, 4, 10, 0)');
  vig.addColorStop(1, 'rgba(2, 4, 10, 0.42)');
  ctx.fillStyle = vig;
  ctx.fillRect(WALL_L - 6, 56, WALL_R - WALL_L + 12, FLOOR_Y);

  return off;
}

// ── Item art (drawn at body origin, rotated) ───────────────────────

function drawCan(ctx: CanvasRenderingContext2D, r: number) {
  const w = r * 1.5;
  const h = r * 2.05;
  const body = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  body.addColorStop(0, '#8f2d2d');
  body.addColorStop(0.35, '#e0dede');
  body.addColorStop(0.5, '#f7f4f0');
  body.addColorStop(0.7, '#d43c3c');
  body.addColorStop(1, '#7c2424');
  roundRect(ctx, -w / 2, -h / 2, w, h, 3);
  ctx.fillStyle = body;
  ctx.fill();
  // White label band + the red R.
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(-w / 2 + 1, -h * 0.18, w - 2, h * 0.4);
  ctx.fillStyle = '#c22f2f';
  ctx.font = `900 ${Math.round(r * 0.9)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R', 0, h * 0.02);
  // Lid.
  ctx.fillStyle = '#aab4c2';
  ctx.beginPath();
  ctx.ellipse(0, -h / 2 + 1, w / 2 - 1, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSalmon(ctx: CanvasRenderingContext2D, r: number) {
  const L = r * 1.55;
  const body = ctx.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
  body.addColorStop(0, '#c9d6de');
  body.addColorStop(0.45, '#f2938a');
  body.addColorStop(1, '#c95f63');
  // Body.
  ctx.beginPath();
  ctx.moveTo(-L, 0);
  ctx.quadraticCurveTo(-r * 0.3, -r * 0.72, L * 0.62, -r * 0.18);
  ctx.quadraticCurveTo(L * 0.86, 0, L * 0.62, r * 0.18);
  ctx.quadraticCurveTo(-r * 0.3, r * 0.72, -L, 0);
  ctx.fillStyle = body;
  ctx.fill();
  // Tail.
  ctx.beginPath();
  ctx.moveTo(-L * 0.86, 0);
  ctx.lineTo(-L * 1.24, -r * 0.5);
  ctx.lineTo(-L * 1.12, 0);
  ctx.lineTo(-L * 1.24, r * 0.5);
  ctx.closePath();
  ctx.fillStyle = '#b8555c';
  ctx.fill();
  // Eye + gill.
  ctx.fillStyle = '#132030';
  ctx.beginPath();
  ctx.arc(L * 0.52, -r * 0.08, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 60, 66, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(L * 0.3, 0, r * 0.34, -1.1, 1.1);
  ctx.stroke();
}

function drawKraken(ctx: CanvasRenderingContext2D, r: number) {
  // Round plush mantle.
  const body = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.2, 0, 0, r);
  body.addColorStop(0, '#3fd1e8');
  body.addColorStop(0.6, '#0f7f9e');
  body.addColorStop(1, '#0a4e66');
  ctx.beginPath();
  ctx.arc(0, -r * 0.12, r * 0.82, Math.PI, 0);
  ctx.quadraticCurveTo(r * 0.82, r * 0.5, r * 0.6, r * 0.6);
  // Tentacle stubs along the bottom.
  for (let i = 0; i < 4; i++) {
    const x0 = r * 0.6 - (i * r * 1.2) / 3.2;
    ctx.arc(x0 - r * 0.14, r * 0.6, r * 0.18, 0, Math.PI);
  }
  ctx.quadraticCurveTo(-r * 0.82, r * 0.5, -r * 0.82, -r * 0.12);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  // Big plush eyes.
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#eef7fb';
    ctx.beginPath();
    ctx.ellipse(s * r * 0.32, -r * 0.14, r * 0.2, r * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0c1a2a';
    ctx.beginPath();
    ctx.arc(s * r * 0.3, -r * 0.1, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
  // The S anchor mark.
  ctx.strokeStyle = '#d6f4fc';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, r * 0.24, r * 0.13, 0.6, Math.PI * 1.5);
  ctx.stroke();
}

function drawNeedle(ctx: CanvasRenderingContext2D, r: number) {
  // Die-cast souvenir: the saucer rides high, legs splay to a base.
  const top = -r * 1.9;
  ctx.strokeStyle = '#c8d2de';
  ctx.lineWidth = 2.2;
  // Legs.
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, r * 0.85);
  ctx.quadraticCurveTo(-r * 0.2, -r * 0.4, 0, top + r * 0.55);
  ctx.moveTo(r * 0.7, r * 0.85);
  ctx.quadraticCurveTo(r * 0.2, -r * 0.4, 0, top + r * 0.55);
  ctx.stroke();
  // Core column.
  ctx.fillStyle = '#aeb9c8';
  ctx.fillRect(-1.6, top + r * 0.5, 3.2, r * 2.2);
  // Base disc.
  ctx.beginPath();
  ctx.ellipse(0, r * 0.9, r * 0.8, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#8794a6';
  ctx.fill();
  // Saucer.
  const sau = ctx.createLinearGradient(0, top - 4, 0, top + 6);
  sau.addColorStop(0, '#f0f5fa');
  sau.addColorStop(1, '#9aa8ba');
  ctx.beginPath();
  ctx.ellipse(0, top, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = sau;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, top - r * 0.14, r * 0.5, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#c8d2de';
  ctx.fill();
  // Spire + beacon.
  ctx.strokeStyle = '#c8d2de';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, top - r * 0.24);
  ctx.lineTo(0, top - r * 0.62);
  ctx.stroke();
  ctx.fillStyle = '#ff4d5e';
  ctx.beginPath();
  ctx.arc(0, top - r * 0.66, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawTroll(ctx: CanvasRenderingContext2D, r: number) {
  // A hunched stone mass, one hubcap eye, knuckles over a VW Beetle.
  const stone = ctx.createRadialGradient(-r * 0.3, -r * 0.5, r * 0.2, 0, 0, r * 1.1);
  stone.addColorStop(0, '#9aa2ac');
  stone.addColorStop(0.65, '#6b7480');
  stone.addColorStop(1, '#464e5a');
  ctx.beginPath();
  ctx.moveTo(-r, r * 0.7);
  ctx.quadraticCurveTo(-r * 1.05, -r * 0.25, -r * 0.45, -r * 0.72);
  ctx.quadraticCurveTo(0, -r * 1.05, r * 0.55, -r * 0.66);
  ctx.quadraticCurveTo(r * 1.05, -r * 0.2, r * 0.95, r * 0.45);
  ctx.quadraticCurveTo(r * 0.6, r * 0.85, 0, r * 0.85);
  ctx.quadraticCurveTo(-r * 0.6, r * 0.85, -r, r * 0.7);
  ctx.closePath();
  ctx.fillStyle = stone;
  ctx.fill();
  // Brow shadow + hubcap eye.
  ctx.fillStyle = 'rgba(30, 36, 46, 0.55)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.16, -r * 0.4, r * 0.42, r * 0.16, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d8dde4';
  ctx.beginPath();
  ctx.arc(-r * 0.14, -r * 0.24, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#20262f';
  ctx.beginPath();
  ctx.arc(-r * 0.1, -r * 0.22, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  // Knuckles.
  ctx.fillStyle = '#5d6672';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(r * 0.28 + i * r * 0.24, r * 0.52, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  // The Beetle under the hand.
  ctx.fillStyle = '#4d7fb5';
  ctx.beginPath();
  ctx.arc(r * 0.52, r * 0.76, r * 0.2, Math.PI, 0);
  ctx.fill();
}

function drawOrb(ctx: CanvasRenderingContext2D, r: number, t: number) {
  // Legendary golden aura, pulsing.
  const pulse = 0.72 + 0.28 * Math.sin(t * 2.6);
  ctx.save();
  ctx.shadowColor = 'rgba(255, 208, 84, 0.95)';
  ctx.shadowBlur = 14 + 8 * pulse;
  ctx.strokeStyle = `rgba(255, 215, 94, ${0.5 + 0.3 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r + 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // Blown glass: swirled color under a glossy shell.
  const glass = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r);
  glass.addColorStop(0, '#fef8ea');
  glass.addColorStop(0.35, '#ffb35e');
  glass.addColorStop(0.68, '#e05a9b');
  glass.addColorStop(1, '#5a2bb0');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = glass;
  ctx.fill();
  // Swirl ribbons.
  ctx.strokeStyle = 'rgba(255, 244, 214, 0.5)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(r * 0.1, r * 0.05, r * 0.62, 0.4, 2.2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(90, 43, 176, 0.45)';
  ctx.beginPath();
  ctx.arc(-r * 0.12, r * 0.1, r * 0.4, 2.6, 4.6);
  ctx.stroke();
  // Specular.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.38, -r * 0.42, r * 0.16, r * 0.1, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawItem(ctx: CanvasRenderingContext2D, b: ClawBody, t: number) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  switch (b.def.type) {
    case 'rainier-can':
      drawCan(ctx, b.r);
      break;
    case 'flying-salmon':
      drawSalmon(ctx, b.r);
      break;
    case 'kraken-plush':
      drawKraken(ctx, b.r);
      break;
    case 'space-needle':
      drawNeedle(ctx, b.r);
      break;
    case 'fremont-troll':
      drawTroll(ctx, b.r);
      break;
    case 'chihuly-orb':
      drawOrb(ctx, b.r, t);
      break;
  }
  ctx.restore();
}

// ── Mechanical assembly ────────────────────────────────────────────

function drawRailAndTrolley(ctx: CanvasRenderingContext2D, sim: ClawSim) {
  // The motorized rail.
  const rail = ctx.createLinearGradient(0, RAIL_Y - 7, 0, RAIL_Y + 5);
  rail.addColorStop(0, STEEL_MID);
  rail.addColorStop(0.5, '#39445a');
  rail.addColorStop(1, '#232c3e');
  ctx.fillStyle = rail;
  ctx.fillRect(WALL_L - 6, RAIL_Y - 7, WALL_R - WALL_L + 12, 12);
  ctx.fillStyle = 'rgba(220, 232, 245, 0.35)';
  ctx.fillRect(WALL_L - 6, RAIL_Y - 7, WALL_R - WALL_L + 12, 1.5);
  // Rail bolts.
  ctx.fillStyle = '#1a2232';
  for (let x = WALL_L + 8; x < WALL_R; x += 34) {
    ctx.beginPath();
    ctx.arc(x, RAIL_Y - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trolley carriage.
  const tx = sim.trolleyX;
  const box = ctx.createLinearGradient(tx - 17, 0, tx + 17, 0);
  box.addColorStop(0, STEEL_LO);
  box.addColorStop(0.5, STEEL_HI);
  box.addColorStop(1, STEEL_LO);
  roundRect(ctx, tx - 17, RAIL_Y - 12, 34, 20, 4);
  ctx.fillStyle = box;
  ctx.fill();
  ctx.strokeStyle = '#202940';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Wheels on the rail.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(tx + s * 10, RAIL_Y - 9, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = '#2c3850';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tx + s * 10, RAIL_Y - 9, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = STEEL_HI;
    ctx.fill();
  }
  // Running light: cyan when idle, red while the cycle owns the claw.
  ctx.fillStyle = sim.phase === 'idle' ? NEON_CYAN : '#ff4d5e';
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(tx, RAIL_Y - 14.5, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawProng(
  ctx: CanvasRenderingContext2D,
  hingeX: number,
  side: -1 | 1,
  openAngle: number,
  back: boolean,
) {
  ctx.save();
  ctx.translate(hingeX, 2);
  ctx.rotate(side * openAngle);
  const grad = ctx.createLinearGradient(-3, 0, 3, 0);
  if (back) {
    grad.addColorStop(0, '#5a6478');
    grad.addColorStop(0.5, '#7d8a9e');
    grad.addColorStop(1, '#454f63');
  } else {
    grad.addColorStop(0, STEEL_LO);
    grad.addColorStop(0.45, STEEL_HI);
    grad.addColorStop(1, STEEL_LO);
  }
  ctx.fillStyle = grad;
  // Upper arm tapering down, then the inward-curving tip.
  ctx.beginPath();
  ctx.moveTo(-2.6, 0);
  ctx.quadraticCurveTo(side * -1, 14, side * -4.5, 24);
  ctx.quadraticCurveTo(side * -6.5, 28.5, side * -3.2, 30);
  ctx.quadraticCurveTo(side * -1.5, 26.5, side * 1.6, 21);
  ctx.quadraticCurveTo(side * 3, 12, 2.6, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(20, 26, 40, 0.6)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
}

function drawCableAndClaw(ctx: CanvasRenderingContext2D, sim: ClawSim) {
  const tx = sim.trolleyX;
  const py = RAIL_Y + CLAW_NECK + sim.cableLen;
  const sway = sim.held ? -sim.held.relX * 0.5 : -sim.trolleyV * 0.03;

  // Cable, bowing slightly under motion.
  ctx.strokeStyle = '#9aa7bb';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(tx, RAIL_Y + 8);
  ctx.quadraticCurveTo(tx + sway, (RAIL_Y + py) / 2, tx, py - 10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(230, 240, 250, 0.4)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(tx - 0.6, RAIL_Y + 8);
  ctx.quadraticCurveTo(tx + sway - 0.6, (RAIL_Y + py) / 2, tx - 0.6, py - 10);
  ctx.stroke();

  ctx.save();
  ctx.translate(tx, py);

  // Palm hub.
  const hub = ctx.createLinearGradient(-10, -10, 10, 4);
  hub.addColorStop(0, STEEL_HI);
  hub.addColorStop(0.55, STEEL_MID);
  hub.addColorStop(1, STEEL_LO);
  ctx.beginPath();
  ctx.moveTo(-9, -10);
  ctx.lineTo(9, -10);
  ctx.lineTo(11.5, 2);
  ctx.lineTo(-11.5, 2);
  ctx.closePath();
  ctx.fillStyle = hub;
  ctx.fill();
  ctx.strokeStyle = '#202940';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Neck collar.
  ctx.fillStyle = STEEL_LO;
  ctx.fillRect(-3.5, -14, 7, 5);

  // 3 prongs: the back one first (dimmer, between the front pair).
  const open = (38 - 32 * sim.prongClose) * (Math.PI / 180);
  drawProng(ctx, 0, 1, open * 0.55, true);
  drawProng(ctx, -9, -1, open, false);
  drawProng(ctx, 9, 1, open, false);

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════

export function ClawMachineCanvas({
  tokens = RUN_TOKENS_DEFAULT,
  seed,
  apiRef,
  onPhaseChange,
  onImpact,
  onGrab,
  onSlip,
  onPrize,
  onMotor,
  onDeny,
  onHudTick,
  onGameOver,
  className,
}: ClawMachineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View>({ s: 1, ox: 0, oy: 0 });
  const backdropRef = useRef<HTMLCanvasElement | null>(null);
  const glassRef = useRef<HTMLCanvasElement | null>(null);
  const fxRef = useRef<Fx>({ particles: [], shake: 0, chuteFlash: 0, time: 0 });

  const physics = useClawPhysics({
    tokens,
    seed,
    onPhaseChange,
    onImpact: (s) => {
      const fx = fxRef.current;
      const sim = physics.simRef.current;
      fx.shake = Math.max(fx.shake, 2.5 + s * 5);
      spawnBurst(
        fx,
        sim.trolleyX,
        RAIL_Y + CLAW_NECK + sim.cableLen + 8,
        6,
        'rgba(180, 200, 225, 0.8)',
        60,
        160,
        0.5,
      );
      onImpact?.(s);
    },
    onGrab: (hit, type, q) => {
      if (hit) {
        const sim = physics.simRef.current;
        spawnBurst(
          fxRef.current,
          sim.trolleyX,
          RAIL_Y + CLAW_NECK + sim.cableLen + 6,
          8,
          NEON_CYAN,
          80,
          40,
          0.45,
        );
      }
      onGrab?.(hit, type, q);
    },
    onSlip: (type) => {
      const sim = physics.simRef.current;
      fxRef.current.shake = Math.max(fxRef.current.shake, 3);
      spawnBurst(
        fxRef.current,
        sim.trolleyX,
        RAIL_Y + CLAW_NECK + sim.cableLen + 22,
        7,
        'rgba(160, 172, 190, 0.7)',
        50,
        120,
        0.6,
      );
      onSlip?.(type);
    },
    onPrize: (prize) => {
      const fx = fxRef.current;
      fx.chuteFlash = 1;
      spawnBurst(fx, (WALL_L + CHUTE_WALL_X) / 2, FLOOR_Y + 6, 18, '#ffd75e', 130, 220, 0.9);
      spawnBurst(fx, (WALL_L + CHUTE_WALL_X) / 2, FLOOR_Y + 2, 8, NEON_PINK, 90, 200, 0.7);
      onPrize?.(prize);
    },
    onMotor,
    onDeny,
    onHudTick,
    onGameOver,
  });

  // Imperative controls for the wrapper's button overlay.
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { setDir: physics.setDir, drop: physics.drop };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, physics.setDir, physics.drop]);

  // Smoke/debug handle (same convention as the cherry picker's __eaSim).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof location === 'undefined' || !/eadebug|clawdebug/.test(location.search)) return;
    const simRef = physics.simRef;
    (canvas as HTMLCanvasElement & { __clawSim?: unknown }).__clawSim = {
      get phase() {
        return simRef.current.phase;
      },
      get trolleyX() {
        return simRef.current.trolleyX;
      },
      get cableLen() {
        return simRef.current.cableLen;
      },
      get tokensLeft() {
        return simRef.current.tokensLeft;
      },
      get chips() {
        return simRef.current.chips;
      },
      get heldType() {
        return simRef.current.held?.body.def.type ?? null;
      },
      get prizes() {
        return simRef.current.prizes.map((p) => ({ type: p.type, chips: p.chips }));
      },
      get items() {
        return simRef.current.bodies.map((b) => ({ type: b.def.type, x: b.x, y: b.y, r: b.r }));
      },
      get view() {
        return { ...viewRef.current };
      },
      get chuteWallX() {
        return CHUTE_WALL_X;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const worldX = (p: ArcadePointer) => (p.x - viewRef.current.ox) / viewRef.current.s;

  useArcadeEngine(
    canvasRef,
    {
      update: (dt, input) => {
        // Touch-drag steering while the finger is on the glass.
        if (input.isDown && input.pointer) physics.aimAt(worldX(input.pointer));
        physics.step(dt);

        // Renderer-owned FX.
        const fx = fxRef.current;
        fx.time += dt;
        fx.shake = Math.max(0, fx.shake - dt * 18);
        fx.chuteFlash = Math.max(0, fx.chuteFlash - dt * 1.6);
        for (let i = fx.particles.length - 1; i >= 0; i--) {
          const p = fx.particles[i];
          p.age += dt;
          if (p.age >= p.ttl) {
            fx.particles[i] = fx.particles[fx.particles.length - 1];
            fx.particles.pop();
            continue;
          }
          p.vy += p.gravity * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
      },
      onPointerUp: () => physics.clearAim(),
      onResize: (size) => {
        viewRef.current = fitView(size);
        backdropRef.current = paintBackdrop(size, viewRef.current);
        glassRef.current = paintGlassOverlay(size, viewRef.current);
      },
      render: (ctx, size) => {
        const sim = physics.simRef.current;
        const fx = fxRef.current;
        const view = viewRef.current;

        if (!backdropRef.current) {
          viewRef.current = fitView(size);
          backdropRef.current = paintBackdrop(size, viewRef.current);
          glassRef.current = paintGlassOverlay(size, viewRef.current);
        }
        ctx.drawImage(backdropRef.current, 0, 0, size.w, size.h);

        ctx.save();
        if (fx.shake > 0) {
          ctx.translate(
            (Math.sin(fx.time * 71) * fx.shake) / 2,
            (Math.cos(fx.time * 83) * fx.shake) / 2,
          );
        }
        ctx.translate(view.ox, view.oy);
        ctx.scale(view.s, view.s);

        // Chute win flash.
        if (fx.chuteFlash > 0) {
          ctx.fillStyle = `rgba(255, 215, 94, ${0.35 * fx.chuteFlash})`;
          ctx.fillRect(WALL_L - 6, CHUTE_WALL_TOP - 20, CHUTE_WALL_X - WALL_L + 6, FLOOR_Y - CHUTE_WALL_TOP + 40);
        }

        drawRailAndTrolley(ctx, sim);
        drawCableAndClaw(ctx, sim);

        // Items — held prize drawn last so it rides in front of the pile.
        const heldBody = sim.held?.body ?? null;
        for (const b of sim.bodies) if (b !== heldBody) drawItem(ctx, b, fx.time);
        if (heldBody) drawItem(ctx, heldBody, fx.time);

        // Particles.
        for (const p of fx.particles) {
          const k = 1 - p.age / p.ttl;
          ctx.globalAlpha = k;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;

        // Idle hint.
        if (sim.phase === 'idle' && sim.tokensLeft > 0) {
          ctx.font = "700 11px 'Avenir Next', Futura, system-ui, sans-serif";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(178, 199, 230, 0.55)';
          ctx.fillText('DRAG TO AIM  ·  DROP TO GRAB', WORLD_W / 2, FLOOR_Y + 36);
        }

        ctx.restore();

        // Front glass reflections.
        if (glassRef.current) ctx.drawImage(glassRef.current, 0, 0, size.w, size.h);

        // Neon frame — alive: slow breathing + a rare stutter.
        const breathe = 0.62 + 0.22 * Math.sin(fx.time * 2.1);
        const stutter = Math.sin(fx.time * 47) > 0.985 ? 0.3 : 1;
        ctx.save();
        ctx.translate(view.ox, view.oy);
        ctx.scale(view.s, view.s);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = NEON_PINK;
        ctx.shadowColor = NEON_PINK;
        ctx.shadowBlur = 16;
        ctx.globalAlpha = breathe * stutter;
        roundRect(ctx, 8, 6, WORLD_W - 16, WORLD_H - 12, 18);
        ctx.stroke();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = NEON_CYAN;
        ctx.shadowColor = NEON_CYAN;
        ctx.shadowBlur = 12;
        ctx.globalAlpha = (1.24 - breathe) * stutter;
        roundRect(ctx, 14, 12, WORLD_W - 28, WORLD_H - 24, 14);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      },
    },
    { autoStart: true },
  );

  return (
    <canvas
      ref={canvasRef}
      data-testid="claw-canvas"
      className={className}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}
