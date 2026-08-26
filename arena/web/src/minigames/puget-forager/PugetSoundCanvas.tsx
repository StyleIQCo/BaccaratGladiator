// ═══════════════════════════════════════════════════════════════════
//  THE PUGET SOUND FORAGER — canvas renderer.
//
//  ALL THREE environments live in this ONE <canvas>: the renderer
//  switches scenes on physics.activeZoneRef exactly the way the
//  physics switches simulations. React's only jobs here: mount the
//  canvas, wire pointer events (routed per zone), own the rAF loop's
//  lifecycle. Every frame goes physics.step() → draw() on refs —
//  zero setState during play.
//
//  Unlike the hotdog/fish-toss cabinets, the physics hook is created
//  by the WRAPPER (it needs setActiveZone for the DOM nav bar) and
//  passed down — the hook's useMemo identity is stable, so the
//  mount-once effect contract still holds.
//
//  Art is 100% procedural (arc / bezier / fillStyle):
//    Zone 1 — grey-tan mudflat under a drizzle sky, wet tide pools,
//             breach rings, shells popping, the geoduck neck.
//    Zone 2 — pier planks over dark-green water, the wire pot on its
//             rope, tinted shadows cruising the depth lane.
//    Zone 3 — deep-water gloom, god rays, kelp, the thrashing king,
//             and the tension + reel bars drawn natively on canvas.
//
//  Renderer performance notes (same contract as HotdogCanvas):
//    • DPR capped at 2 — fill-rate over vanity.
//    • Per-zone gradients + ambient fields built once per resize.
//    • Particles/flyers reuse the in-place compaction trick, capped.
//    • Pointer → logical px uses a cached bounding rect.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import {
  DOCK_SURFACE_FRAC, GEODUCK_TAPS, LANE_BOT_FRAC, LANE_TOP_FRAC, MUD_TOP_FRAC,
  POT_H, POT_W, SEAFOOD_META, SEAFOOD_ORDER, TENSION_RED, FLY_SECONDS,
  type DockShadow, type ForagerPhysics, type MudBubble,
} from './useForagerPhysics';

export interface PugetSoundCanvasProps {
  physics: ForagerPhysics;
  className?: string;
}

// Bouncy arcade-ish stack — best native match on iOS first.
const HUD_FONT = '"Chalkboard SE", "Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';

const MAX_PARTICLES = 48;
const MAX_FLYERS = 12;

interface Particle {
  kind: 'sand' | 'splash' | 'ink' | 'snap' | 'ring';
  x: number; y: number; vx: number; vy: number;
  rot: number; rv: number;
  age: number; ttl: number; s: number;
}

interface Popup { x: number; y: number; text: string; color: string; age: number; ttl: number }

/** A caught item arcing from the catch site up to its HUD inventory slot. */
interface Flyer { emoji: string; x0: number; y0: number; tx: number; ty: number; age: number }

// ── Deterministic helpers (no Math.random in the render loop) ──────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(seed: number, i: number): number {
  const x = Math.sin(seed + i * 7.13) * 43758.5453;
  return x - Math.floor(x);
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

// ── Per-resize static scenery ──────────────────────────────────────

interface Backdrop {
  // Zone 1
  mudSky: CanvasGradient;
  mud: CanvasGradient;
  pools: Array<{ x: number; y: number; rx: number; ry: number }>;
  flecks: Array<{ x: number; y: number; s: number; c: string }>;
  // Zone 2
  dockSky: CanvasGradient;
  dockWater: CanvasGradient;
  planks: number[];          // seam x positions on the pier band
  pilings: number[];         // piling x positions
  // Zone 3
  deep: CanvasGradient;
  rays: Array<{ x: number; w: number; a: number }>;
  kelp: Array<{ x: number; h: number; seed: number }>;
  motes: Array<{ x: number; y: number; s: number; v: number }>;
}

function buildBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): Backdrop {
  const rng = mulberry32(0x50c37);

  const tideY = h * MUD_TOP_FRAC;
  const mudSky = ctx.createLinearGradient(0, 0, 0, tideY);
  mudSky.addColorStop(0, '#5f7a86');
  mudSky.addColorStop(1, '#93a8ae');
  const mud = ctx.createLinearGradient(0, tideY, 0, h);
  mud.addColorStop(0, '#b3a081');
  mud.addColorStop(0.5, '#a4906f');
  mud.addColorStop(1, '#82705a');
  const pools: Backdrop['pools'] = [];
  for (let i = 0; i < 5; i++) {
    pools.push({
      x: rng() * w,
      y: tideY + 30 + rng() * (h - tideY - 70),
      rx: 26 + rng() * 44,
      ry: 7 + rng() * 8,
    });
  }
  const flecks: Backdrop['flecks'] = [];
  for (let i = 0; i < 26; i++) {
    flecks.push({
      x: rng() * w,
      y: tideY + 14 + rng() * (h - tideY - 26),
      s: 1.2 + rng() * 2.4,
      c: rng() < 0.5 ? 'rgba(240,235,225,0.5)' : 'rgba(60,50,40,0.35)',
    });
  }

  const surfY = h * DOCK_SURFACE_FRAC;
  const dockSky = ctx.createLinearGradient(0, 0, 0, surfY);
  dockSky.addColorStop(0, '#2b3f4e');
  dockSky.addColorStop(1, '#587585');
  const dockWater = ctx.createLinearGradient(0, surfY, 0, h);
  dockWater.addColorStop(0, '#144237');
  dockWater.addColorStop(0.6, '#0d2f28');
  dockWater.addColorStop(1, '#07201b');
  const planks: number[] = [];
  for (let x = 26; x < w; x += 58 + rng() * 30) planks.push(x);
  const pilings = [w * 0.08, w * 0.92];

  const deep = ctx.createLinearGradient(0, 0, 0, h);
  deep.addColorStop(0, '#0a2c40');
  deep.addColorStop(0.55, '#062032');
  deep.addColorStop(1, '#03101c');
  const rays: Backdrop['rays'] = [];
  for (let i = 0; i < 4; i++) {
    rays.push({ x: w * (0.15 + i * 0.24) + rng() * 30, w: 34 + rng() * 40, a: 0.05 + rng() * 0.04 });
  }
  const kelp: Backdrop['kelp'] = [];
  for (const kx of [w * 0.05, w * 0.11, w * 0.9, w * 0.96]) {
    kelp.push({ x: kx, h: h * (0.3 + rng() * 0.25), seed: rng() * 10 });
  }
  const motes: Backdrop['motes'] = [];
  for (let i = 0; i < 14; i++) {
    motes.push({ x: rng() * w, y: rng() * h, s: 0.8 + rng() * 1.6, v: 8 + rng() * 16 });
  }

  return { mudSky, mud, pools, flecks, dockSky, dockWater, planks, pilings, deep, rays, kelp, motes };
}

// ── Zone 1 pieces ──────────────────────────────────────────────────

function drawClamPeek(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, open: number): void {
  // Two-arc cockle shell nosing out of the mud, hinge down.
  ctx.fillStyle = '#e8dcc8';
  ctx.beginPath(); ctx.arc(x, y, r * 0.62, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#a08a68'; ctx.lineWidth = 1.4;
  for (const a of [-0.6, -0.2, 0.2, 0.6]) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a) * r * 0.6, y - Math.cos(a) * r * 0.6); ctx.stroke();
  }
  if (open > 0.3) { // a sliver of the animal between the valves
    ctx.fillStyle = '#f2b988';
    ctx.beginPath(); ctx.ellipse(x, y - 1, r * 0.4, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawOysterPeek(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
  // Craggy grey shell + the pearl-glint that telegraphs "worth more".
  ctx.fillStyle = '#9aa5a3';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.66, y);
  ctx.quadraticCurveTo(x - r * 0.5, y - r * 0.72, x, y - r * 0.6);
  ctx.quadraticCurveTo(x + r * 0.62, y - r * 0.66, x + r * 0.66, y);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#6f7a78'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x - r * 0.5, y - r * 0.18); ctx.quadraticCurveTo(x, y - r * 0.4, x + r * 0.5, y - r * 0.2); ctx.stroke();
  ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(t * 6)})`;
  dot(ctx, x + r * 0.2, y - r * 0.34, 1.8);
}

function drawGeoduckNeck(ctx: CanvasRenderingContext2D, b: MudBubble, t: number): void {
  const wob = Math.sin(t * 7 + b.seed) * 4;
  const neckH = 40 + b.taps * 10;            // every tug hauls more of it out
  const neckW = 26;
  ctx.save();
  ctx.translate(b.x, b.y);
  // The famous neck: a leaning capsule with skin creases.
  ctx.rotate(wob * 0.02);
  ctx.fillStyle = '#d8c3a5';
  rr(ctx, -neckW / 2 + wob * 0.4, -neckH, neckW, neckH, neckW / 2); ctx.fill();
  ctx.strokeStyle = '#b09a7c'; ctx.lineWidth = 2;
  for (let i = 1; i <= 3; i++) {
    const yy = -neckH * (i / 4);
    ctx.beginPath(); ctx.moveTo(-neckW / 2 + 3 + wob * 0.4, yy); ctx.lineTo(neckW / 2 - 3 + wob * 0.4, yy); ctx.stroke();
  }
  // Twin siphon holes at the tip.
  ctx.fillStyle = '#8a745c';
  dot(ctx, -5 + wob * 0.4, -neckH + 7, 3.2);
  dot(ctx, 5 + wob * 0.4, -neckH + 7, 3.2);
  ctx.restore();
  // Tug pips: how many rapid taps are still owed.
  for (let i = 0; i < GEODUCK_TAPS; i++) {
    ctx.fillStyle = i < b.taps ? '#ffb347' : 'rgba(255,255,255,0.35)';
    dot(ctx, b.x - 14 + i * 14, b.y - neckH - 16, 4.4);
  }
}

function drawZone1(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number, bd: Backdrop, physics: ForagerPhysics,
): void {
  const tideY = h * MUD_TOP_FRAC;
  ctx.fillStyle = bd.mudSky;
  ctx.fillRect(0, 0, w, tideY);
  // Receded water line lapping at the top of the flat.
  ctx.fillStyle = '#3d6a74';
  ctx.beginPath();
  ctx.moveTo(0, tideY - 16);
  for (let x = 0; x <= w; x += 24) ctx.lineTo(x, tideY - 16 + Math.sin(x * 0.05 + t * 1.6) * 3);
  ctx.lineTo(w, tideY - 40); ctx.lineTo(0, tideY - 40);
  ctx.closePath(); ctx.fill();
  // A couple of gulls working the tideline.
  ctx.strokeStyle = 'rgba(235,240,242,0.8)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  for (const [gx, gy, ph] of [[w * 0.24, tideY * 0.4, 0], [w * 0.7, tideY * 0.55, 2.1]] as const) {
    const flap = Math.sin(t * 5 + ph) * 4;
    ctx.beginPath(); ctx.moveTo(gx - 8, gy + flap); ctx.quadraticCurveTo(gx, gy - 4, gx + 8, gy + flap); ctx.stroke();
  }
  ctx.fillStyle = bd.mud;
  ctx.fillRect(0, tideY - 14, w, h - tideY + 14);
  // Wet pools catch the sky.
  for (const p of bd.pools) {
    ctx.fillStyle = 'rgba(110,140,150,0.5)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(220,235,240,0.25)';
    ctx.beginPath(); ctx.ellipse(p.x - p.rx * 0.25, p.y - 1.5, p.rx * 0.4, p.ry * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  for (const f of bd.flecks) { ctx.fillStyle = f.c; dot(ctx, f.x, f.y, f.s); }

  // Bubbles: breach rings, mound, then whoever lives underneath.
  for (const b of physics.bubblesRef.current) {
    const life = 1 - b.age / b.ttl;
    // Expanding water rings.
    for (let i = 0; i < 2; i++) {
      const ringT = (b.age * 1.6 + i * 0.5) % 1;
      ctx.strokeStyle = `rgba(200,225,232,${(1 - ringT) * 0.55})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 4, b.r * (0.5 + ringT * 0.9), b.r * (0.2 + ringT * 0.36), 0, 0, Math.PI * 2); ctx.stroke();
    }
    // The wet mound.
    ctx.fillStyle = 'rgba(90,76,60,0.85)';
    ctx.beginPath(); ctx.ellipse(b.x, b.y + 3, b.r * 0.8, b.r * 0.34, 0, 0, Math.PI * 2); ctx.fill();
    if (b.kind === 'geoduck') {
      drawGeoduckNeck(ctx, b, t);
    } else if (b.kind === 'clam') {
      drawClamPeek(ctx, b.x, b.y, b.r, Math.sin(b.age * 8 + b.seed) * 0.5 + 0.5);
    } else {
      drawOysterPeek(ctx, b.x, b.y, b.r, t + b.seed);
    }
    // Sink-timer ring so "tap them QUICKLY" is legible at a glance.
    ctx.strokeStyle = life < 0.3 ? 'rgba(255,93,77,0.9)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(b.x, b.y + 3, b.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * life);
    ctx.stroke();
  }
}

// ── Zone 2 pieces ──────────────────────────────────────────────────

function drawShadow(ctx: CanvasRenderingContext2D, s: DockShadow, t: number): void {
  const squish = 1 + Math.sin(t * 6 + s.seed) * 0.08;
  ctx.save();
  ctx.translate(s.x, s.y);
  if (s.kind === 'crab') {
    // Red-tinted blob + leg nubs — unmistakably a Dungeness from above.
    ctx.fillStyle = 'rgba(150,45,32,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 0, 34 * squish, 22 / squish, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,45,32,0.45)';
    ctx.beginPath(); ctx.ellipse(0, 0, 24 * squish, 15 / squish, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(150,45,32,0.4)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.5 + Math.sin(t * 8 + i + s.seed) * 0.14;
        ctx.beginPath();
        ctx.moveTo(side * 20, (i - 1) * 8);
        ctx.lineTo(side * (30 + Math.cos(a) * 6), (i - 1) * 8 + Math.sin(a) * 6);
        ctx.stroke();
      }
    }
  } else {
    // Fast purple dart: mantle cone + trailing tentacle wiggle.
    const dir = Math.sign(s.vx) || 1;
    ctx.scale(dir, 1);
    ctx.fillStyle = 'rgba(120,58,160,0.42)';
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.quadraticCurveTo(8, -12 * squish, -12, -7);
    ctx.lineTo(-12, 7);
    ctx.quadraticCurveTo(8, 12 * squish, 26, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(120,58,160,0.38)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const ph = t * 10 + i * 1.4 + s.seed;
      ctx.beginPath();
      ctx.moveTo(-12, (i - 1.5) * 4);
      ctx.quadraticCurveTo(-22, (i - 1.5) * 4 + Math.sin(ph) * 5, -32, (i - 1.5) * 4 + Math.sin(ph + 1) * 7);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawZone2(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number, bd: Backdrop, physics: ForagerPhysics,
): void {
  const surfY = h * DOCK_SURFACE_FRAC;
  ctx.fillStyle = bd.dockSky;
  ctx.fillRect(0, 0, w, surfY);
  ctx.fillStyle = bd.dockWater;
  ctx.fillRect(0, surfY, w, h - surfY);
  // Surface chop.
  ctx.strokeStyle = 'rgba(160,215,205,0.3)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const sx = ((i * 97 + t * 26) % (w + 40)) - 20;
    const sy = surfY + 3 + (i % 3) * 5;
    ctx.beginPath(); ctx.moveTo(sx - 9, sy); ctx.lineTo(sx + 9, sy); ctx.stroke();
  }
  // Pier band across the very top + pilings driven into the bay.
  ctx.fillStyle = '#4a3626';
  ctx.fillRect(0, 0, w, 26);
  ctx.strokeStyle = 'rgba(24,16,10,0.7)'; ctx.lineWidth = 2;
  for (const px of bd.planks) { ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, 26); ctx.stroke(); }
  for (const px of bd.pilings) {
    ctx.fillStyle = '#3a2c1e';
    ctx.fillRect(px - 8, 0, 16, surfY + 14);
    ctx.fillStyle = 'rgba(160,215,205,0.2)';                    // waterline ring
    ctx.beginPath(); ctx.ellipse(px, surfY + 12, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Depth-lane hint so the kill zone reads instantly.
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fillRect(0, h * LANE_TOP_FRAC - 24, w, h * (LANE_BOT_FRAC - LANE_TOP_FRAC) + 48);

  for (const s of physics.shadowsRef.current) drawShadow(ctx, s, t);

  // Rope from the pier down to the pot — sways while aiming, taut on the drop.
  const potX = physics.potXRef.current;
  const potY = physics.potYRef.current;
  const state = physics.potStateRef.current;
  const sway = state === 'aim' ? Math.sin(t * 2.1) * 8 : 0;
  ctx.strokeStyle = '#c9b18a'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(potX, 26);
  ctx.quadraticCurveTo(potX + sway, (26 + potY) / 2, potX, potY - POT_H / 2);
  ctx.stroke();

  // The wire pot: rounded cage + mesh, tilting slightly on the way down.
  ctx.save();
  ctx.translate(potX, potY);
  ctx.rotate(state === 'drop' ? Math.sin(t * 9) * 0.05 : sway * 0.004);
  ctx.fillStyle = 'rgba(30,42,40,0.6)';
  rr(ctx, -POT_W / 2, -POT_H / 2, POT_W, POT_H, 12); ctx.fill();
  ctx.strokeStyle = '#9fb3ad'; ctx.lineWidth = 2.4;
  rr(ctx, -POT_W / 2, -POT_H / 2, POT_W, POT_H, 12); ctx.stroke();
  ctx.lineWidth = 1.2;
  for (let i = 1; i < 4; i++) {
    const gx = -POT_W / 2 + (POT_W / 4) * i;
    ctx.beginPath(); ctx.moveTo(gx, -POT_H / 2); ctx.lineTo(gx, POT_H / 2); ctx.stroke();
  }
  for (let i = 1; i < 3; i++) {
    const gy = -POT_H / 2 + (POT_H / 3) * i;
    ctx.beginPath(); ctx.moveTo(-POT_W / 2, gy); ctx.lineTo(POT_W / 2, gy); ctx.stroke();
  }
  const carried = physics.carriedRef.current;
  if (carried) {
    ctx.font = `28px ${HUD_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SEAFOOD_META[carried].emoji, 0, 2);
  }
  ctx.restore();
}

// ── Zone 3 pieces ──────────────────────────────────────────────────

function drawSalmon(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, surging: boolean, hooked: boolean): void {
  const thrash = Math.sin(t * (surging ? 26 : 8)) * (surging ? 0.42 : 0.12);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(thrash * 0.5);
  ctx.scale(-1, 1);                                    // nose toward the boat (left)
  // Tail — flapping hard when surging.
  ctx.fillStyle = '#7d8f9c';
  ctx.beginPath();
  ctx.moveTo(-34, 0);
  ctx.lineTo(-52, -13 + Math.sin(t * (surging ? 30 : 10)) * 6);
  ctx.lineTo(-52, 13 + Math.sin(t * (surging ? 30 : 10) + 1) * 6);
  ctx.closePath(); ctx.fill();
  // Silver body, darker back.
  ctx.fillStyle = '#c9d4dc';
  ctx.beginPath(); ctx.ellipse(0, 0, 38, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7d8f9c';
  ctx.beginPath(); ctx.ellipse(0, -6, 36, 8, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#8fa3ad';                            // dorsal
  ctx.beginPath(); ctx.moveTo(-8, -14); ctx.quadraticCurveTo(2, -24, 12, -13); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1c2a30';                            // eye
  dot(ctx, 26, -3, 2.6);
  ctx.strokeStyle = '#9c4f4f'; ctx.lineWidth = 2;       // kype jaw
  ctx.beginPath(); ctx.moveTo(34, 2); ctx.quadraticCurveTo(40, 4, 38, 8); ctx.stroke();
  if (hooked) {                                         // the hook in its lip
    ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(40, 4, 5, -0.4, Math.PI * 0.9); ctx.stroke();
  }
  ctx.restore();
}

function drawZone3(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number, bd: Backdrop, physics: ForagerPhysics,
): void {
  ctx.fillStyle = bd.deep;
  ctx.fillRect(0, 0, w, h);
  // God rays wheeling slowly.
  for (const r of bd.rays) {
    const lean = Math.sin(t * 0.3 + r.x) * 30;
    ctx.fillStyle = `rgba(140,200,220,${r.a})`;
    ctx.beginPath();
    ctx.moveTo(r.x - r.w / 2, 0);
    ctx.lineTo(r.x + r.w / 2, 0);
    ctx.lineTo(r.x + r.w * 1.4 + lean, h);
    ctx.lineTo(r.x - r.w * 1.4 + lean, h);
    ctx.closePath(); ctx.fill();
  }
  // Kelp columns swaying at the flanks.
  ctx.strokeStyle = 'rgba(38,92,74,0.75)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  for (const k of bd.kelp) {
    ctx.beginPath();
    ctx.moveTo(k.x, h);
    for (let i = 1; i <= 4; i++) {
      const yy = h - (k.h * i) / 4;
      ctx.lineTo(k.x + Math.sin(t * 1.1 + k.seed + i) * (4 + i * 3), yy);
    }
    ctx.stroke();
  }
  // Drifting motes rise and wrap.
  ctx.fillStyle = 'rgba(180,215,225,0.3)';
  for (const m of bd.motes) {
    m.y -= m.v * dt;
    if (m.y < -6) { m.y = h + 6; m.x = jitter(m.x, 1) * w; }
    dot(ctx, m.x, m.y, m.s);
  }

  const hooked = physics.reelStateRef.current === 'hooked';
  const fx = physics.fishXRef.current;
  const fy = physics.fishYRef.current;
  const tension = physics.tensionRef.current;

  // The boat's rod pokes in from the top-left; line sags to the fish.
  const rodX = w * 0.06, rodY = h * 0.05;
  const tipX = w * 0.16, tipY = h * 0.14;
  ctx.strokeStyle = '#5a4632'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(rodX, rodY);
  ctx.quadraticCurveTo((rodX + tipX) / 2, (rodY + tipY) / 2 + (hooked ? tension * 26 : 4), tipX, tipY);
  ctx.stroke();
  if (hooked || physics.biteFlashRef.current > 0) {
    const sag = hooked ? (1 - tension) * 40 + 6 : 30;
    const red = Math.min(1, Math.max(0, (tension - TENSION_RED) / (1 - TENSION_RED)));
    ctx.strokeStyle = `rgba(${Math.round(235 + red * 20)},${Math.round(235 - red * 150)},${Math.round(235 - red * 160)},0.9)`;
    ctx.lineWidth = 1.6 + red;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.quadraticCurveTo((tipX + fx) / 2, (tipY + fy) / 2 + sag, fx - 34, fy + 2);
    ctx.stroke();
  }

  drawSalmon(ctx, fx, fy, t, physics.surgingRef.current, hooked);

  if (hooked) {
    // ── Native canvas tension bar ──
    const barW = Math.min(300, w - 60);
    const barX = (w - barW) / 2, barY = 34, barH = 16;
    ctx.fillStyle = 'rgba(6,16,22,0.75)';
    rr(ctx, barX - 4, barY - 4, barW + 8, barH + 8, 8); ctx.fill();
    // Zone bands: safe → warn → red.
    ctx.fillStyle = '#2f8f5b';
    ctx.fillRect(barX, barY, barW * 0.55, barH);
    ctx.fillStyle = '#c9a13a';
    ctx.fillRect(barX + barW * 0.55, barY, barW * (TENSION_RED - 0.55), barH);
    ctx.fillStyle = '#b3362b';
    ctx.fillRect(barX + barW * TENSION_RED, barY, barW * (1 - TENSION_RED), barH);
    // Fill sheen up to current tension.
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(barX, barY, barW * Math.min(tension, 1), barH);
    // Needle.
    const nx = barX + barW * Math.min(tension, 1);
    ctx.fillStyle = '#f2f6f7';
    ctx.beginPath(); ctx.moveTo(nx, barY - 7); ctx.lineTo(nx - 5, barY - 14); ctx.lineTo(nx + 5, barY - 14); ctx.closePath(); ctx.fill();
    // Red-zone alarm border.
    if (tension > TENSION_RED) {
      ctx.strokeStyle = `rgba(255,80,60,${0.55 + 0.45 * Math.sin(t * 14)})`;
      ctx.lineWidth = 3;
      rr(ctx, barX - 4, barY - 4, barW + 8, barH + 8, 8); ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.font = `900 11px ${HUD_FONT}`;
    ctx.fillStyle = 'rgba(223,242,247,0.85)';
    ctx.fillText('TENSION', barX + barW / 2, barY + barH + 14);

    // Reel-in progress bar beneath.
    const pY = barY + barH + 22;
    ctx.fillStyle = 'rgba(6,16,22,0.75)';
    rr(ctx, barX - 4, pY - 4, barW + 8, 12 + 8, 8); ctx.fill();
    ctx.fillStyle = '#3aa8c9';
    ctx.fillRect(barX, pY, barW * physics.progressRef.current, 12);
    ctx.fillStyle = 'rgba(223,242,247,0.85)';
    ctx.fillText('REEL', barX + barW / 2, pY + 12 + 12);

    if (physics.reelHeldRef.current) {                  // reel spinning at the rod butt
      ctx.strokeStyle = '#d8c9a5'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(rodX + 8, rodY + 12, 7, t * 16, t * 16 + Math.PI * 1.4); ctx.stroke();
    }
  }

  // Bite ring + snap vignette.
  if (physics.biteFlashRef.current > 0) {
    const bf = physics.biteFlashRef.current;
    ctx.strokeStyle = `rgba(255,220,140,${bf})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(fx, fy, (1 - bf) * 60 + 20, 0, Math.PI * 2); ctx.stroke();
  }
  if (physics.snapFlashRef.current > 0) {
    const sf = physics.snapFlashRef.current;
    ctx.fillStyle = `rgba(200,40,30,${sf * 0.22})`;
    ctx.fillRect(0, 0, w, h);
    ctx.font = `900 34px ${HUD_FONT}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,15,20,0.85)';
    ctx.globalAlpha = sf;
    ctx.strokeText('SNAP!', w / 2, h * 0.4);
    ctx.fillStyle = '#ff6b5d';
    ctx.fillText('SNAP!', w / 2, h * 0.4);
    ctx.globalAlpha = 1;
  }
}

// ── Component ──────────────────────────────────────────────────────

const HINTS: Record<1 | 2 | 3, string> = {
  1: 'TAP THE BUBBLES — GEODUCKS TAKE 3!',
  2: 'DRAG TO AIM · RELEASE TO DROP THE POT',
  3: 'HOLD TO REEL · RELEASE ON RED',
};

export function PugetSoundCanvas({ physics, className }: PugetSoundCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const popupsRef = useRef<Popup[]>([]);
  const flyersRef = useRef<Flyer[]>([]);

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

    // ── Pointer routing: one canvas, three control schemes ──
    // Zone 2's scheme: drag anywhere to slide the pot, and EVERY release
    // commits the drop — position & commit in a single gesture, which
    // also satisfies plain "tap to drop" (a tap is just a tiny drag).
    const local = (e: PointerEvent) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const onDown = (e: PointerEvent) => {
      const { x, y } = local(e);
      switch (physics.activeZoneRef.current) {
        case 1: physics.tapMudflat(x, y); break;
        case 2: physics.setPotX(x); break;
        case 3: physics.setReeling(true); break;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (physics.activeZoneRef.current === 2) physics.setPotX(local(e).x);
    };
    const onUp = () => {
      if (physics.activeZoneRef.current === 2) physics.dropPot();
      physics.setReeling(false);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onUp);

    let raf = 0;
    let last = performance.now();
    let t = 0; // ambient clock (rings, sway, thrash)

    const emit = (kind: Particle['kind'], x: number, y: number, n: number) => {
      const parts = particlesRef.current;
      for (let i = 0; i < n && parts.length < MAX_PARTICLES; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = kind === 'ink' ? 30 + Math.random() * 60 : 80 + Math.random() * 150;
        parts.push({
          kind, x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - (kind === 'splash' ? 130 : 50),
          rot: Math.random() * Math.PI, rv: (Math.random() - 0.5) * 8,
          age: 0,
          ttl: kind === 'ink' ? 0.9 + Math.random() * 0.4 : 0.45 + Math.random() * 0.35,
          s: kind === 'ink' ? 6 + Math.random() * 8 : 2 + Math.random() * 3,
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

      // ── Drain physics event queues into cosmetics ──
      for (const fx of physics.fxQueueRef.current) {
        switch (fx.kind) {
          case 'sand':   emit('sand', fx.x, fx.y, 8); break;
          case 'splash': emit('splash', fx.x, fx.y, 10); break;
          case 'ink':    emit('ink', fx.x, fx.y, 6); break;
          case 'snap':   emit('snap', fx.x, fx.y, 10); break;
          case 'ring':   particlesRef.current.push({ kind: 'ring', x: fx.x, y: fx.y, vx: 0, vy: 0, rot: 0, rv: 0, age: 0, ttl: 0.5, s: 16 }); break;
          case 'popup':
            popupsRef.current.push({ x: fx.x, y: fx.y, text: fx.text ?? '', color: fx.color ?? '#fff', age: 0, ttl: 0.8 });
            break;
        }
      }
      physics.fxQueueRef.current.length = 0;

      // Catches → flyers arcing to their HUD slot. The DOM inventory bar
      // renders SEAFOOD_ORDER left→right directly above the canvas, so
      // slot i's x is just (i+0.5)/6 of the width, and the wrapper bumps
      // the count FLY_SECONDS later — the number ticks as the icon lands.
      for (const c of physics.catchQueueRef.current) {
        if (flyersRef.current.length < MAX_FLYERS) {
          const slot = SEAFOOD_ORDER.indexOf(c.kind);
          flyersRef.current.push({
            emoji: SEAFOOD_META[c.kind].emoji,
            x0: c.x, y0: c.y,
            tx: w * ((slot + 0.5) / SEAFOOD_ORDER.length), ty: -20,
            age: 0,
          });
        }
      }
      physics.catchQueueRef.current.length = 0;

      // ── Scene (the switch mirrors physics.step's) ──
      switch (physics.activeZoneRef.current) {
        case 1: drawZone1(ctx, w, h, t, backdrop, physics); break;
        case 2: drawZone2(ctx, w, h, t, backdrop, physics); break;
        case 3: drawZone3(ctx, w, h, t, dt, backdrop, physics); break;
      }

      // ── Particles (in-place compaction) ──
      const parts = particlesRef.current;
      let write = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.ttl) continue;
        const a = 1 - p.age / p.ttl;
        if (p.kind === 'ring') {
          ctx.strokeStyle = `rgba(255,220,140,${a})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s + p.age * 120, 0, Math.PI * 2); ctx.stroke();
        } else {
          p.vy += 420 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.rv * dt;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          switch (p.kind) {
            case 'sand':   ctx.fillStyle = '#c9b28c'; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); break;
            case 'splash': ctx.fillStyle = '#9fd4e0'; dot(ctx, 0, 0, p.s * 0.6); break;
            case 'ink':    ctx.fillStyle = 'rgba(90,40,130,0.7)'; dot(ctx, 0, 0, p.s * (0.6 + p.age)); break;
            case 'snap':
              ctx.strokeStyle = '#f2f6f7'; ctx.lineWidth = 2; ctx.lineCap = 'round';
              ctx.beginPath(); ctx.moveTo(-p.s, 0); ctx.lineTo(p.s, 0); ctx.stroke();
              break;
          }
          ctx.restore();
        }
        parts[write++] = p;
      }
      parts.length = write;

      // ── Score popups ──
      const popups = popupsRef.current;
      write = 0;
      ctx.textAlign = 'center';
      for (let i = 0; i < popups.length; i++) {
        const p = popups[i];
        p.age += dt;
        if (p.age >= p.ttl) continue;
        p.y -= 70 * dt;
        ctx.save();
        ctx.globalAlpha = 1 - p.age / p.ttl;
        ctx.font = `900 20px ${HUD_FONT}`;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,15,20,0.85)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
        popups[write++] = p;
      }
      popups.length = write;

      // ── Flyers: catch site → HUD slot, arcing, shrinking ──
      const flyers = flyersRef.current;
      write = 0;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < flyers.length; i++) {
        const f = flyers[i];
        f.age += dt;
        const k = f.age / FLY_SECONDS;
        if (k >= 1) continue;
        const e = 1 - Math.pow(1 - k, 2.2);              // ease-out toward the slot
        const x = f.x0 + (f.tx - f.x0) * e;
        const y = f.y0 + (f.ty - f.y0) * e - Math.sin(k * Math.PI) * 46;
        ctx.save();
        ctx.font = `${Math.round(30 - 14 * k)}px ${HUD_FONT}`;
        ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
        ctx.fillText(f.emoji, x, y);
        ctx.restore();
        flyers[write++] = f;
      }
      flyers.length = write;
      ctx.textBaseline = 'alphabetic';

      // ── Zone-switch wipe: a fast teal shutter ──
      const fade = physics.zoneFadeRef.current;
      if (fade > 0) {
        ctx.fillStyle = `rgba(10,42,48,${fade * 0.85})`;
        ctx.fillRect(0, 0, w, h);
      }

      // ── One-line native hint per zone (the DOM owns the real HUD) ──
      const hint = HINTS[physics.activeZoneRef.current];
      ctx.font = `800 12px ${HUD_FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,15,20,0.7)';
      ctx.strokeText(hint, w / 2, h - 12);
      ctx.fillStyle = 'rgba(235,245,248,0.85)';
      ctx.fillText(hint, w / 2, h - 12);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once game loop (physics identity is stable)
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ touchAction: 'none', display: 'block' }}
    />
  );
}
