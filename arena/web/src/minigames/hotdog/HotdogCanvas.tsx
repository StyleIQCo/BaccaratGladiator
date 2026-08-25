// ═══════════════════════════════════════════════════════════════════
//  HOTDOG PARACHUTE DROP — canvas renderer.
//
//  React's only jobs here: mount the <canvas>, wire pointer events,
//  own the rAF loop's lifecycle. Every frame goes straight through
//  physics.step() → draw() on refs — zero setState during play.
//
//  Art is 100% procedural (arc / bezierCurveTo / fillStyle): buns,
//  sausages, mustard squiggles, chili blobs, salted pretzels, foamy
//  beer steins, smoke wisps, a Bavarian blue-and-white canopy — and
//  GRETCHEN, our dirndl'd Oktoberfest heroine, who theatrically
//  devours every catch: chomp animation, blissful eyes, floating
//  hearts, sparkles, and a German exclamation ("LECKER!"). Audio is
//  synthesized in hotdogSfx.ts (accordion band included).
//
//  Renderer performance notes:
//    • DPR capped at 2 — a 3× iPhone canvas is fill-rate pain for
//      zero visible gain on a mini-game.
//    • Sky gradient + cloud field built once per resize, never per
//      frame. Clouds advance by dt and wrap — no per-frame allocs.
//    • Celebration particles use the same in-place compaction trick
//      as the physics arrays, capped at 48 live particles.
//    • Pointer → logical-x uses a cached bounding rect (refreshed on
//      resize), not a layout query per pointermove.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import {
  useHotdogPhysics, getCatcherBox, ITEM_W, ITEM_H,
  type FallingItem, type GameOverReason, type HazardMode, type ItemKind, type ScorePopup,
} from './useHotdogPhysics';
import { primeAudio, sfxCatch, sfxGameOver, sfxHazard, sfxStart } from './hotdogSfx';

export interface HotdogCanvasProps {
  onGameOver: (finalScore: number, reason: GameOverReason) => void;
  hazardMode?: HazardMode;
  runSeconds?: number;
  className?: string;
}

// Bouncy arcade-ish stack — best native match on iOS first, then Android/desktop.
const HUD_FONT = '"Chalkboard SE", "Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';

// What Gretchen yells per treat. Auf Deutsch, natürlich.
const PHRASES: Record<Exclude<ItemKind, 'burnt_hotdog'>, string[]> = {
  plain_hotdog:   ['NOM!', 'MMM!', 'JA!'],
  pretzel:        ['BREZEL!', 'KNUSPRIG!', 'MMM!'],
  mustard_relish: ['LECKER!', 'SEHR GUT!', 'MMM!'],
  beer_stein:     ['PROST!', "O'ZAPFT IS!", 'AHHH!'],
  chili_cheese:   ['WUNDERBAR!', 'JAWOHL!', 'SCHARF!'],
};

/** Her current "enjoyment performance": t counts up from the catch. */
interface Reaction { t: number; dur: number; phrase: string; big: boolean }

interface Fx {
  kind: 'heart' | 'star' | 'crumb';
  x: number; y: number; vx: number; vy: number;
  rot: number; rv: number;
  age: number; ttl: number; s: number;
  color: string;
}

// ── Deterministic helpers (no Math.random in the render loop) ──────

/** mulberry32 — tiny seeded PRNG for the cloud field. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-item jitter in [0,1) keyed off the item's spawn seed. */
function jitter(seed: number, i: number): number {
  const x = Math.sin(seed + i * 7.13) * 43758.5453;
  return x - Math.floor(x);
}

interface Cloud { x: number; y: number; s: number; v: number }
interface Sky {
  grad: CanvasGradient;
  clouds: Cloud[];       // slow parallax layer
  streaks: Cloud[];      // fast thin lines that sell "we are falling"
  rng: () => number;
}

function buildSky(ctx: CanvasRenderingContext2D, w: number, h: number): Sky {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#4aa8e8');
  grad.addColorStop(0.55, '#7cc4f0');
  grad.addColorStop(1, '#c8e8fa');
  const rng = mulberry32(0xd06f00d);
  const clouds: Cloud[] = [];
  for (let i = 0; i < 7; i++) {
    clouds.push({ x: rng() * w, y: rng() * h, s: 0.5 + rng() * 0.9, v: 40 + rng() * 50 });
  }
  const streaks: Cloud[] = [];
  for (let i = 0; i < 10; i++) {
    streaks.push({ x: rng() * w, y: rng() * h, s: 0.4 + rng() * 0.8, v: 480 + rng() * 260 });
  }
  return { grad, clouds, streaks, rng };
}

// ── Path helpers ───────────────────────────────────────────────────

/** Rounded capsule (stadium) path centred on (cx, cy). */
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

/** Rounded rect path, top-left anchored. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Filled circle — avoids the chord-fill artifact of multi-arc paths. */
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Classic two-cubic heart, centred, pointing down. */
function heartPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.bezierCurveTo(-s * 1.1, s * 0.25, -s * 0.9, -s * 0.8, 0, -s * 0.25);
  ctx.bezierCurveTo(s * 0.9, -s * 0.8, s * 1.1, s * 0.25, 0, s);
  ctx.closePath();
}

/** Four-point sparkle. */
function starPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.14, -s * 0.14, s, 0);
  ctx.quadraticCurveTo(s * 0.14, s * 0.14, 0, s);
  ctx.quadraticCurveTo(-s * 0.14, s * 0.14, -s, 0);
  ctx.quadraticCurveTo(-s * 0.14, -s * 0.14, 0, -s);
  ctx.closePath();
}

/** Condiment squiggle down the sausage — a chain of bezier S-curves. */
function squiggle(
  ctx: CanvasRenderingContext2D,
  x0: number, y: number, x1: number, waves: number, amp: number,
  color: string, width: number,
): void {
  const step = (x1 - x0) / waves;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  for (let i = 0; i < waves; i++) {
    const sx = x0 + i * step;
    const dir = i % 2 === 0 ? -1 : 1;
    ctx.bezierCurveTo(
      sx + step * 0.33, y + dir * amp,
      sx + step * 0.66, y + dir * amp,
      sx + step, y,
    );
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ── Item art ───────────────────────────────────────────────────────

function drawHotdog(ctx: CanvasRenderingContext2D, it: FallingItem, t: number): void {
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate(it.spin);

  const w = ITEM_W;
  const h = ITEM_H;

  if (it.kind === 'burnt_hotdog') {
    // ── HAZARD: charcoal dog, ember cracks, smoke, pulsing red ring ──
    const pulse = 0.35 + 0.25 * Math.sin(t * 6 + it.seed);
    ctx.strokeStyle = `rgba(255, 60, 40, ${pulse.toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.72, h * 0.95, 0, 0, Math.PI * 2);
    ctx.stroke();

    capsule(ctx, 0, 2, w, h * 0.8);           // scorched bun
    ctx.fillStyle = '#5a4632';
    ctx.fill();
    capsule(ctx, 0, -2, w * 1.06, h * 0.55);  // charcoal sausage
    ctx.fillStyle = '#2e2624';
    ctx.fill();
    ctx.strokeStyle = '#1a1614';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = '#ff6a2a';               // glowing ember cracks
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const cx = -w * 0.38 + jitter(it.seed, i) * w * 0.76;
      ctx.beginPath();
      ctx.moveTo(cx, -5);
      ctx.lineTo(cx + 3, -1);
      ctx.stroke();
    }

    // Smoke wisps: quadratic curves rising and fading on a loop.
    for (let i = 0; i < 3; i++) {
      const cycle = (t * 0.7 + jitter(it.seed, i + 9)) % 1;
      const sx = -w * 0.3 + i * w * 0.3;
      ctx.strokeStyle = `rgba(90, 90, 95, ${(0.5 * (1 - cycle)).toFixed(3)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, -h * 0.5);
      ctx.quadraticCurveTo(sx + 6, -h * 0.5 - 14 * cycle - 6, sx - 4, -h * 0.5 - 26 * cycle - 10);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // ── Edible dogs ──
  if (it.kind === 'chili_cheese') {
    // Warm glow so the +500 prize reads as special even at full wobble speed.
    ctx.fillStyle = 'rgba(255, 157, 51, 0.22)';
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.75, h * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  capsule(ctx, 0, 2, w, h * 0.8);              // back bun lobe
  ctx.fillStyle = '#d99a4e';
  ctx.fill();
  ctx.strokeStyle = '#b57733';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  capsule(ctx, 0, -3, w * 1.08, h * 0.55);     // sausage, ends peeking past the bun
  ctx.fillStyle = '#a34a26';
  ctx.fill();
  ctx.strokeStyle = '#7e3418';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  capsule(ctx, 0, -5.5, w * 0.9, h * 0.16);    // glossy grill-shine highlight
  ctx.fillStyle = 'rgba(255, 205, 160, 0.45)';
  ctx.fill();

  if (it.kind === 'mustard_relish') {
    squiggle(ctx, -w * 0.42, -3, w * 0.42, 4, 4.5, '#f5c518', 3.5);   // mustard
    ctx.fillStyle = '#5a9e2f';                                        // relish flecks
    for (let i = 0; i < 5; i++) {
      const rx = -w * 0.36 + i * w * 0.18 + (jitter(it.seed, i) - 0.5) * 5;
      dot(ctx, rx, -6 + (jitter(it.seed, i + 5) - 0.5) * 4, 2);
    }
  } else if (it.kind === 'chili_cheese') {
    ctx.fillStyle = '#8c2f1b';                                        // chunky chili
    for (let i = 0; i < 5; i++) {
      const rx = -w * 0.38 + i * w * 0.19 + (jitter(it.seed, i) - 0.5) * 6;
      dot(ctx, rx, -3 + (jitter(it.seed, i + 5) - 0.5) * 5, 3.4);
    }
    squiggle(ctx, -w * 0.4, -5, w * 0.4, 5, 3.5, '#ffb027', 2.5);     // cheese drizzle
  }

  capsule(ctx, 0, 7, w * 0.94, h * 0.42);      // front bun lobe over the toppings
  ctx.fillStyle = '#f0bf74';
  ctx.fill();
  ctx.strokeStyle = '#c98f45';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawPretzel(ctx: CanvasRenderingContext2D, it: FallingItem): void {
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate(it.spin);

  const R = 11;
  const knot = () => {
    ctx.beginPath();
    ctx.arc(0, -1, R, 0, Math.PI * 2);          // outer loop
    ctx.moveTo(-7.5, -7.5);                     // crossed arms
    ctx.bezierCurveTo(-2, 0, 2, 4, 7, 7.5);
    ctx.moveTo(7.5, -7.5);
    ctx.bezierCurveTo(2, 0, -2, 4, -7, 7.5);
  };
  ctx.lineCap = 'round';
  knot();
  ctx.strokeStyle = '#6e3c12';                  // dark bake outline
  ctx.lineWidth = 8.5;
  ctx.stroke();
  knot();
  ctx.strokeStyle = '#a5651e';                  // dough
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.beginPath();                              // glaze highlight
  ctx.arc(0, -1, R, -Math.PI * 0.8, -Math.PI * 0.25);
  ctx.strokeStyle = '#c98a3f';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';                    // coarse salt
  for (let i = 0; i < 6; i++) {
    const a = jitter(it.seed, i) * Math.PI * 2;
    const r = 5 + jitter(it.seed, i + 6) * 7;
    ctx.fillRect(Math.cos(a) * r - 1, -1 + Math.sin(a) * r - 1, 2, 2);
  }
  ctx.restore();
}

function drawStein(ctx: CanvasRenderingContext2D, it: FallingItem, t: number): void {
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate(it.spin * 0.6);                    // full beers tumble respectfully

  ctx.strokeStyle = '#b97913';                  // handle first, behind the body
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(13, 1, 7, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  rr(ctx, -11, -12, 22, 26, 3);                 // golden lager body
  ctx.fillStyle = '#f09f1f';
  ctx.fill();
  ctx.strokeStyle = '#b97913';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';   // glass shine
  ctx.fillRect(-7, -9, 3, 20);
  ctx.fillRect(1, -9, 1.5, 20);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';  // rising bubbles
  for (let i = 0; i < 3; i++) {
    const cycle = (t * 0.6 + jitter(it.seed, i)) % 1;
    dot(ctx, -5 + i * 5 + (jitter(it.seed, i + 3) - 0.5) * 3, 10 - cycle * 18, 1.3);
  }

  ctx.fillStyle = '#fdf6e3';                    // foam head, overflowing
  dot(ctx, -7, -13, 4.5);
  dot(ctx, 0, -15, 5.5);
  dot(ctx, 7, -13, 4.5);
  dot(ctx, 10, -8, 2.5);                        // the drip
  ctx.restore();
}

function drawItem(ctx: CanvasRenderingContext2D, it: FallingItem, t: number): void {
  if (it.kind === 'pretzel') drawPretzel(ctx, it);
  else if (it.kind === 'beer_stein') drawStein(ctx, it, t);
  else drawHotdog(ctx, it, t);
}

// ── Player art: Bavarian canopy + Gretchen in her dirndl ───────────

/**
 * Gretchen — braids, dirndl, bottomless appetite. Drawn in basket-local
 * coords (origin = basket centre); everything below y≈−15 hides behind
 * the basket front, which is drawn after her.
 * Face states, by priority: shocked (burnt dog) → chomping → blissful →
 * idle (with blinks).
 */
function drawGretchen(
  ctx: CanvasRenderingContext2D, tilt: number, t: number, reaction: Reaction, shock: number,
): void {
  const HAIR = '#e9b94d';
  const SKIN = '#f6cfa4';
  const k = reaction.t / reaction.dur;
  const eating = k < 1 && shock <= 0.05;
  const biteK = Math.min(reaction.t / 0.3, 1);      // 0→1 across the bite itself
  const bob = eating ? Math.sin(reaction.t * 16) * 1.6 * (1 - k) : 0;

  ctx.save();
  ctx.translate(0, bob);

  // Braids behind the head — counter-swinging vs the steer tilt for cheap inertia.
  for (const side of [-1, 1] as const) {
    ctx.fillStyle = HAIR;
    for (let i = 0; i < 4; i++) {
      dot(ctx, side * (10.5 + i * 0.9) - tilt * i * 7, -37 + i * 5, 3.6 - i * 0.3);
    }
    ctx.fillStyle = '#d23b35';                      // ribbon bows at the tips
    const tipX = side * 13.2 - tilt * 24;
    dot(ctx, tipX - 2.2, -17.5, 2);
    dot(ctx, tipX + 2.2, -17.5, 2);
  }

  // Blouse base, black dirndl bodice, white neckline V, gold lacing.
  ctx.fillStyle = '#faf6ee';
  ctx.beginPath();
  ctx.moveTo(-12, -29); ctx.lineTo(12, -29); ctx.lineTo(13, -14); ctx.lineTo(-13, -14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#33323c';
  ctx.beginPath();
  ctx.moveTo(-9, -29); ctx.lineTo(9, -29); ctx.lineTo(11, -14); ctx.lineTo(-11, -14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#faf6ee';
  ctx.beginPath();
  ctx.moveTo(-5, -29); ctx.lineTo(5, -29); ctx.lineTo(0, -22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d4a017';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-4, -27); ctx.lineTo(4, -23);
  ctx.moveTo(4, -27); ctx.lineTo(-4, -23);
  ctx.moveTo(-3, -22); ctx.lineTo(3, -19);
  ctx.moveTo(3, -22); ctx.lineTo(-3, -19);
  ctx.stroke();

  // Arms up, hands gripping the inner shroud lines; puffed dirndl sleeves.
  ctx.strokeStyle = '#faf6ee';
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-10, -27); ctx.lineTo(-21, -42);
  ctx.moveTo(10, -27); ctx.lineTo(21, -42);
  ctx.stroke();
  ctx.fillStyle = '#faf6ee';
  dot(ctx, -10.5, -27.5, 4.5);
  dot(ctx, 10.5, -27.5, 4.5);
  ctx.fillStyle = SKIN;
  dot(ctx, -23, -44, 3);
  dot(ctx, 23, -44, 3);

  // Head + hair cap with centre parting.
  ctx.fillStyle = SKIN;
  dot(ctx, 0, -40, 10.5);
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(0, -40, 10.6, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c9962e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -50.4);
  ctx.lineTo(0, -41);
  ctx.stroke();

  // Rosy cheeks — extra rosy mid-feast.
  ctx.fillStyle = eating ? 'rgba(232, 110, 90, 0.8)' : 'rgba(232, 120, 100, 0.55)';
  dot(ctx, -6.3, -35.5, 2.2);
  dot(ctx, 6.3, -35.5, 2.2);

  const mouthY = -33.5;
  if (shock > 0.05) {
    // ── Shocked: X eyes, wobbly open mouth, flying sweat drop ──
    ctx.strokeStyle = '#4a3120';
    ctx.lineWidth = 1.6;
    for (const side of [-1, 1] as const) {
      const ex = side * 3.8;
      ctx.beginPath();
      ctx.moveTo(ex - 1.8, -40.3); ctx.lineTo(ex + 1.8, -36.7);
      ctx.moveTo(ex + 1.8, -40.3); ctx.lineTo(ex - 1.8, -36.7);
      ctx.stroke();
    }
    ctx.fillStyle = '#7c2f24';
    ctx.beginPath();
    ctx.ellipse(0, mouthY, 2.4, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8fd3ff';
    dot(ctx, 9.5, -46 - shock * 4, 2);
  } else if (eating && biteK < 1) {
    // ── Mid-chomp: mouth wide, the caught treat vanishing into it ──
    ctx.strokeStyle = '#4a3120';                  // happy closed ∩ eyes
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(-3.8, -38, 2.2, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(3.8, -38, 2.2, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#7c2f24';
    ctx.beginPath();
    ctx.ellipse(0, mouthY, 3, 1.8 + 2.4 * (1 - biteK), 0, 0, Math.PI * 2);
    ctx.fill();
    const s = 1 - biteK;                          // the shrinking snack
    if (s > 0.05) {
      ctx.save();
      ctx.translate(6.5, mouthY - 1.5);
      ctx.rotate(0.45);
      capsule(ctx, 0, 0, 16 * s, 6 * s);
      ctx.fillStyle = '#d99a4e';
      ctx.fill();
      capsule(ctx, 0, -1.2 * s, 17 * s, 3.4 * s);
      ctx.fillStyle = '#a34a26';
      ctx.fill();
      ctx.restore();
    }
  } else if (eating) {
    // ── Post-bite bliss: closed eyes, giant grin ──
    ctx.strokeStyle = '#4a3120';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(-3.8, -38, 2.2, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(3.8, -38, 2.2, Math.PI, 0); ctx.stroke();
    ctx.strokeStyle = '#7c2f24';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, -35, 3.6, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();
  } else {
    // ── Idle: bright eyes (with a blink), pleasant smile ──
    const blink = (t * 0.7) % 3 < 0.09;
    if (blink) {
      ctx.strokeStyle = '#4a3120';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-5.4, -38.4); ctx.lineTo(-2.2, -38.4);
      ctx.moveTo(2.2, -38.4); ctx.lineTo(5.4, -38.4);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#3a2a20';
      dot(ctx, -3.8, -38.5, 1.6);
      dot(ctx, 3.8, -38.5, 1.6);
    }
    ctx.strokeStyle = '#7c2f24';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, -34.6, 2.6, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }

  ctx.restore();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, tilt: number, t: number,
  reaction: Reaction, shock: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt + Math.sin(t * 1.3) * 0.02);   // steer-lean + idle sway

  const canopyY = -62;
  const R = 46;

  ctx.fillStyle = '#2e6fce';                     // Bavarian blue canopy
  ctx.beginPath();
  ctx.arc(0, canopyY, R, Math.PI, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#f6f1e6';                     // two white gores
  for (const [a0, a1] of [[Math.PI * 0.75, Math.PI * 0.55], [Math.PI * 0.45, Math.PI * 0.25]] as const) {
    ctx.beginPath();
    ctx.moveTo(0, canopyY);
    ctx.arc(0, canopyY, R, -a0, -a1);
    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 4; i++) {                  // scalloped hem
    const hx = -R + (i + 0.5) * (R / 2);
    ctx.fillStyle = i % 2 === 0 ? '#2e6fce' : '#f6f1e6';
    ctx.beginPath();
    ctx.arc(hx, canopyY, R / 4, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = '#1d4c96';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, canopyY, R, Math.PI, 0);
  ctx.stroke();

  ctx.strokeStyle = '#5b4021';                   // shroud lines → basket rim
  ctx.lineWidth = 1.5;
  for (const sx of [-R + 4, -R / 2.4, R / 2.4, R - 4]) {
    ctx.beginPath();
    ctx.moveTo(sx, canopyY);
    ctx.lineTo(sx > 0 ? 30 : -30, -16);
    ctx.stroke();
  }

  drawGretchen(ctx, tilt, t, reaction, shock);

  const bw = 76;                                 // basket (visual ≈ CATCHER box)
  const bh = 34;
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath();
  ctx.moveTo(-bw / 2, -bh / 2);
  ctx.lineTo(bw / 2, -bh / 2);
  ctx.lineTo(bw / 2 - 8, bh / 2);
  ctx.quadraticCurveTo(0, bh / 2 + 6, -bw / 2 + 8, bh / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5e3a17';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(94, 58, 23, 0.55)';    // weave texture
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const wy = -bh / 2 + (i * bh) / 3;
    ctx.beginPath();
    ctx.moveTo(-bw / 2 + 4, wy);
    ctx.lineTo(bw / 2 - 4, wy);
    ctx.stroke();
  }
  ctx.fillStyle = '#5e3a17';                     // rim
  ctx.fillRect(-bw / 2 - 3, -bh / 2 - 4, bw + 6, 6);

  ctx.restore();
}

// ── Celebration FX ─────────────────────────────────────────────────

function spawnBurst(fx: Fx[], kind: ItemKind, x: number, y: number): void {
  const push = (p: Fx) => { if (fx.length < 48) fx.push(p); };
  const big = kind === 'chili_cheese' || kind === 'beer_stein';

  const hearts = kind === 'chili_cheese' ? 5 : 3;
  for (let i = 0; i < hearts; i++) {
    push({
      kind: 'heart',
      x: x + (Math.random() - 0.5) * 34, y: y - 44 - Math.random() * 18,
      vx: (Math.random() - 0.5) * 50, vy: -45 - Math.random() * 40,
      rot: (Math.random() - 0.5) * 0.6, rv: (Math.random() - 0.5) * 2.5,
      age: 0, ttl: 0.9 + Math.random() * 0.4, s: 5 + Math.random() * 3,
      color: Math.random() < 0.5 ? '#ff5d73' : '#ff8fa3',
    });
  }
  if (big) {
    for (let i = 0; i < 6; i++) {
      push({
        kind: 'star',
        x: x + (Math.random() - 0.5) * 20, y: y - 52,
        vx: (Math.random() - 0.5) * 160, vy: -20 - Math.random() * 80,
        rot: Math.random() * Math.PI, rv: (Math.random() - 0.5) * 6,
        age: 0, ttl: 0.55 + Math.random() * 0.25, s: 5 + Math.random() * 4,
        color: '#ffd75e',
      });
    }
  }
  for (let i = 0; i < 4; i++) {                  // crumbs (foam flecks for beer)
    push({
      kind: 'crumb',
      x: x + 6 + (Math.random() - 0.5) * 10, y: y - 33,
      vx: (Math.random() - 0.5) * 90, vy: -60 - Math.random() * 70,
      rot: 0, rv: 0,
      age: 0, ttl: 0.7 + Math.random() * 0.3, s: 1.6 + Math.random() * 1.2,
      color: kind === 'beer_stein' ? '#fdf6e3' : '#d99a4e',
    });
  }
}

function updateAndDrawFx(ctx: CanvasRenderingContext2D, fx: Fx[], dt: number): void {
  for (const p of fx) {
    p.age += dt;
    if (p.kind === 'crumb') p.vy += 320 * dt;    // crumbs fall; hearts/stars float
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.rv * dt;
  }
  let write = 0;
  for (let i = 0; i < fx.length; i++) {
    if (fx[i].age < fx[i].ttl) fx[write++] = fx[i];
  }
  fx.length = write;

  for (const p of fx) {
    ctx.save();
    ctx.globalAlpha = Math.max(1 - p.age / p.ttl, 0);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.kind === 'heart') { heartPath(ctx, p.s); ctx.fill(); }
    else if (p.kind === 'star') { starPath(ctx, p.s); ctx.fill(); }
    else dot(ctx, 0, 0, p.s);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** Comic-burst exclamation above the canopy, easeOutBack pop, late fade. */
function drawPhrase(ctx: CanvasRenderingContext2D, x: number, y: number, r: Reaction): void {
  const k = r.t / r.dur;
  if (k >= 1 || !r.phrase) return;
  const back = 1.70158;
  const p = Math.min(k / 0.22, 1) - 1;
  const scale = 1 + (back + 1) * p * p * p + back * p * p;
  const alpha = k > 0.66 ? 1 - (k - 0.66) / 0.34 : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.09);
  ctx.scale(scale, scale);
  ctx.globalAlpha = Math.max(alpha, 0);
  ctx.font = `900 ${r.big ? 26 : 21}px ${HUD_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(10, 20, 34, 0.9)';
  ctx.strokeText(r.phrase, 0, 0);
  ctx.fillStyle = r.big ? '#ffb027' : '#ffffff';
  ctx.fillText(r.phrase, 0, 0);
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── HUD ────────────────────────────────────────────────────────────

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  capsule(ctx, x + w / 2, y + h / 2, w, h);
  ctx.fillStyle = 'rgba(14, 30, 48, 0.55)';
  ctx.fill();
}

function drawHud(
  ctx: CanvasRenderingContext2D, w: number,
  score: number, timeLeft: number, catchPulse: number, t: number,
): void {
  // Score pill — bounces on every catch via catchPulse (1 → 0).
  const s = 1 + 0.3 * catchPulse * catchPulse;
  ctx.save();
  ctx.translate(12, 12);
  ctx.scale(s, s);
  pill(ctx, 0, 0, 148, 40);
  ctx.fillStyle = '#f4c534';                     // gold chip
  dot(ctx, 22, 20, 13);
  ctx.strokeStyle = '#b58a12';
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(22, 20, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `900 22px ${HUD_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(10, 20, 34, 0.9)';
  ctx.strokeText(String(score), 42, 21);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(score), 42, 21);
  ctx.restore();

  // Timer pill — panics under 5s.
  const secs = Math.ceil(timeLeft);
  const urgent = timeLeft <= 5;
  const ts = urgent ? 1 + 0.08 * Math.sin(t * 10) : 1;
  ctx.save();
  ctx.translate(w - 12 - 92, 12);
  ctx.scale(ts, ts);
  pill(ctx, 0, 0, 92, 40);
  const clockX = 20;                             // tiny drawn clock, no emoji roulette
  ctx.strokeStyle = urgent ? '#ff5a4d' : '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(clockX, 20, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(clockX, 20);
  ctx.lineTo(clockX, 13);
  ctx.moveTo(clockX, 20);
  ctx.lineTo(clockX + 5, 22);
  ctx.stroke();
  ctx.font = `900 22px ${HUD_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(10, 20, 34, 0.9)';
  ctx.strokeText(String(secs), 38, 21);
  ctx.fillStyle = urgent ? '#ff5a4d' : '#ffffff';
  ctx.fillText(String(secs), 38, 21);
  ctx.restore();
}

function drawPopups(ctx: CanvasRenderingContext2D, popups: ScorePopup[]): void {
  ctx.font = `900 19px ${HUD_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of popups) {
    const k = 1 - p.age / p.ttl;
    ctx.globalAlpha = Math.max(k, 0);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10, 20, 34, 0.85)';
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

// ── Component ──────────────────────────────────────────────────────

export function HotdogCanvas({ onGameOver, hazardMode, runSeconds, className }: HotdogCanvasProps) {
  // Theatric state — refs only, same zero-render rule as the physics.
  const fxRef = useRef<Fx[]>([]);
  const reactionRef = useRef<Reaction>({ t: 99, dur: 0.95, phrase: '', big: false });
  const pendingBurstRef = useRef<ItemKind | null>(null);

  const physics = useHotdogPhysics({
    hazardMode,
    runSeconds,
    onGameOver: (score, reason) => {
      sfxGameOver(reason);
      onGameOver(score, reason);
    },
    onCatch: kind => {
      if (kind === 'burnt_hotdog') {
        sfxHazard();
        reactionRef.current = { t: 0, dur: 1.1, phrase: 'IGITT!', big: false };
        return;
      }
      sfxCatch(kind);
      const pool = PHRASES[kind];
      reactionRef.current = {
        t: 0,
        dur: 0.95,
        phrase: pool[Math.floor(Math.random() * pool.length)],
        big: kind === 'chili_cheese' || kind === 'beer_stein',
      };
      pendingBurstRef.current = kind;
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
    let sky: Sky | null = null;

    const fit = () => {
      const rect = wrap.getBoundingClientRect();
      view.w = rect.width;
      view.h = rect.height;
      view.left = rect.left;
      view.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * view.dpr);
      canvas.height = Math.round(rect.height * view.dpr);
      sky = buildSky(ctx, view.w, view.h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    // Drag anywhere on the canvas; hover also steers on desktop.
    const onPointer = (e: PointerEvent) => {
      physics.setPointerX(e.clientX - view.left);
    };
    const onPointerDown = (e: PointerEvent) => {
      primeAudio();       // second line of defense for the iOS gesture rule
      onPointer(e);
    };
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerdown', onPointerDown);

    physics.start(view.w);
    sfxStart();

    // Renderer-local motion state (cosmetic only — not gameplay).
    let prevPlayerX = physics.playerXRef.current;
    let tilt = 0;

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
      if (!sky) return;

      // Reaction clock runs on renderer time so Gretchen finishes her
      // performance even on the frozen game-over frame.
      const reaction = reactionRef.current;
      reaction.t += dt;

      const px = physics.playerXRef.current;
      const box = getCatcherBox(px, h);
      if (pendingBurstRef.current) {
        spawnBurst(fxRef.current, pendingBurstRef.current, box.cx, box.cy);
        pendingBurstRef.current = null;
      }

      // ── Sky: gradient + clouds/streaks scrolling UP = we are falling ──
      ctx.fillStyle = sky.grad;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      for (const c of sky.clouds) {
        c.y -= c.v * dt;
        if (c.y < -60) { c.y = h + 60; c.x = sky.rng() * w; }
        ctx.beginPath();
        ctx.arc(c.x, c.y, 26 * c.s, 0, Math.PI * 2);
        ctx.arc(c.x + 24 * c.s, c.y + 6 * c.s, 20 * c.s, 0, Math.PI * 2);
        ctx.arc(c.x - 24 * c.s, c.y + 7 * c.s, 18 * c.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 2;
      for (const st of sky.streaks) {
        st.y -= st.v * dt;
        if (st.y < -50) { st.y = h + 20; st.x = sky.rng() * w; }
        ctx.beginPath();
        ctx.moveTo(st.x, st.y);
        ctx.lineTo(st.x, st.y + 28 * st.s);
        ctx.stroke();
      }

      // ── World (shaken as one group when a hazard hits) ──
      const shake = physics.shakeRef.current;
      ctx.save();
      if (shake > 0) {
        ctx.translate(Math.sin(t * 71) * shake * 14, Math.cos(t * 67) * shake * 10);
      }

      for (const it of physics.itemsRef.current) drawItem(ctx, it, t);

      const vx = dt > 0 ? (px - prevPlayerX) / dt : 0;
      prevPlayerX = px;
      const targetTilt = Math.max(-0.16, Math.min(0.16, vx * 0.0007));
      tilt += (targetTilt - tilt) * Math.min(dt * 10, 1);
      drawPlayer(ctx, box.cx, box.cy, tilt, t, reaction, physics.hazardFlashRef.current);

      updateAndDrawFx(ctx, fxRef.current, dt);
      drawPopups(ctx, physics.popupsRef.current);
      drawPhrase(ctx, Math.min(Math.max(box.cx, 76), w - 76), box.cy - 128, reaction);
      ctx.restore();

      // ── Screen-space feedback ──
      const flash = physics.hazardFlashRef.current;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255, 40, 20, ${(flash * 0.28).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (physics.timeLeftRef.current <= 5 && physics.statusRef.current === 'running') {
        ctx.strokeStyle = `rgba(255, 70, 50, ${(0.25 + 0.2 * Math.sin(t * 10)).toFixed(3)})`;
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, w - 6, h - 6);
      }

      drawHud(ctx, w, physics.scoreRef.current, physics.timeLeftRef.current, physics.catchPulseRef.current, t);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [physics]);

  return (
    <div ref={wrapRef} className={className ?? 'h-full w-full'}>
      {/* touch-action:none — the drag IS the game; never let iOS scroll/bounce eat it */}
      <canvas ref={canvasRef} className="h-full w-full" style={{ touchAction: 'none', display: 'block' }} />
    </div>
  );
}
