// ═══════════════════════════════════════════════════════════════════
//  PIKE ST. BARISTA RUSH — canvas renderer.
//
//  Runs on the shared useArcadeEngine: fixed-timestep update feeds
//  useBaristaPhysics, and every station of the assembly line renders
//  sequentially into the SAME single <canvas> — the pressure gauge,
//  the pulling shot, the top-down latte art. No DOM per station, no
//  React state in the hot path.
//
//  Layers, back to front:
//    1. The machine — copper body, chrome band, group head, drip
//       tray. Static, so it's painted ONCE per resize into an
//       offscreen canvas and blitted every frame.
//    2. Steam — soft white puffs off the group head, heavier while
//       the valve is open. Renderer-owned particles; the physics hook
//       never knows they exist.
//    3. The active station's furniture + verdicts.
//    4. Juice — the grade stamp, red ruin wash, screen shake, the
//       shift-clock bar, the order ticket, the Caffeine Rush pill.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import {
  useArcadeEngine,
  type ArcadeInput,
  type ArcadePointer,
  type ArcadeSize,
} from '../../hooks/useArcadeEngine';
import {
  PULL_GOOD,
  RUN_SECONDS_DEFAULT,
  STENCILS,
  STENCIL_SAMPLES,
  TAMP_GREEN_HALF,
  TAMP_YELLOW_HALF,
  useBaristaPhysics,
  type BaristaStage,
  type DrinkLogEntry,
  type StageQuality,
} from './useBaristaPhysics';
import {
  pourOff,
  pourOn,
  sfxGrind,
  sfxOverflow,
  sfxPullGrade,
  sfxServe,
  sfxTamp,
  sfxTick,
  sfxGameOver,
  steamOff,
  steamOn,
} from './baristaSfx';

export interface BaristaRushCanvasProps {
  onGameOver: (
    finalScore: number,
    drinksServed: number,
    perfectCount: number,
    log: DrinkLogEntry[],
  ) => void;
  /** 4 Hz feed for the wrapper's DOM receipt printer. */
  onHudTick?: (timeLeft: number, score: number, combo: number) => void;
  /** Station transitions, for host-side analytics/telemetry (and the smoke test). */
  onStageChange?: (stage: BaristaStage, orderNo: number) => void;
  runSeconds?: number;
  className?: string;
}

// ── Renderer-local FX state ────────────────────────────────────────

interface SteamPuff {
  x: number; y: number; r: number;
  vx: number; vy: number;
  phase: number; age: number; ttl: number;
}

interface CremaBubble {
  u: number;   // 0..1 across the cup mouth
  r: number;
  phase: number;
}

/** Needle value −1…1 → dial angle. −90° is straight up (canvas y-down). */
const needleAngle = (v: number) => ((-90 + 120 * v) * Math.PI) / 180;

const QUALITY_LABEL: Record<StageQuality, [string, string]> = {
  perfect: ['PERFECT TAMP!', '#3ddc84'],
  good: ['SOLID PRESS', '#ffd23f'],
  weak: ['OFF-CENTER…', '#ff8c5a'],
};
const PULL_LABEL: Record<StageQuality, [string, string]> = {
  perfect: ['GOD SHOT!', '#3ddc84'],
  good: ['CLEAN CUT', '#ffd23f'],
  weak: ['MISSED THE LINE', '#ff8c5a'],
};

const STAGE_BANNER: Record<BaristaStage, string> = {
  tamp: 'STATION 1 · THE TAMP',
  pull: 'STATION 2 · THE SHOT',
  art: 'STATION 3 · THE ART',
  serve: 'ORDER UP!',
};
const STAGE_HINT: Record<BaristaStage, string> = {
  tamp: 'TAP when the needle hits the green!',
  pull: 'HOLD the valve — release at the line!',
  art: 'TRACE the stencil before the foam settles!',
  serve: '',
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paint the static espresso machine into an offscreen canvas (per resize). */
function paintMachine(w: number, h: number, dpr: number): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(w * dpr));
  off.height = Math.max(1, Math.round(h * dpr));
  const ctx = off.getContext('2d')!;
  ctx.scale(dpr, dpr);

  // Cafe wall — dark roast, warm lamp glow bleeding in from above.
  const wall = ctx.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#261a12');
  wall.addColorStop(1, '#110a06');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.5, -h * 0.1, 10, w * 0.5, -h * 0.1, h * 0.75);
  glow.addColorStop(0, 'rgba(255,184,96,0.16)');
  glow.addColorStop(1, 'rgba(255,184,96,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Copper body.
  const bx = w * 0.07, bw = w * 0.86, by = h * 0.055, bh = h * 0.33;
  const copper = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  copper.addColorStop(0, '#6f3a1f');
  copper.addColorStop(0.28, '#c97c4b');
  copper.addColorStop(0.5, '#e9a06a');
  copper.addColorStop(0.72, '#a35730');
  copper.addColorStop(1, '#5f301a');
  roundRect(ctx, bx, by, bw, bh, 14);
  ctx.fillStyle = copper;
  ctx.fill();
  // Brushed sheen.
  const sheen = ctx.createLinearGradient(0, by, 0, by + bh);
  sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
  sheen.addColorStop(0.25, 'rgba(255,255,255,0.03)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.25)');
  roundRect(ctx, bx, by, bw, bh, 14);
  ctx.fillStyle = sheen;
  ctx.fill();

  // Chrome band across the middle of the body.
  const cy0 = by + bh * 0.42, cbh = bh * 0.2;
  const chrome = ctx.createLinearGradient(0, cy0, 0, cy0 + cbh);
  chrome.addColorStop(0, '#e8ecef');
  chrome.addColorStop(0.5, '#8d949b');
  chrome.addColorStop(1, '#d5dade');
  ctx.fillStyle = chrome;
  ctx.fillRect(bx + 6, cy0, bw - 12, cbh);

  // Two little brass dials on the band.
  for (const dx of [0.28, 0.72]) {
    const dcx = bx + bw * dx, dcy = cy0 + cbh / 2, dr = cbh * 0.42;
    ctx.beginPath();
    ctx.arc(dcx, dcy, dr, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1d12';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#e9c08a';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dcx, dcy);
    ctx.lineTo(dcx + dr * 0.6, dcy - dr * 0.45);
    ctx.strokeStyle = '#ff6b5e';
    ctx.stroke();
  }

  // Group head: chrome block + spout, dead centre under the body.
  const gx = w * 0.5, gy = by + bh;
  const head = ctx.createLinearGradient(gx - 34, 0, gx + 34, 0);
  head.addColorStop(0, '#9aa1a8');
  head.addColorStop(0.5, '#e6eaee');
  head.addColorStop(1, '#7d848b');
  roundRect(ctx, gx - 34, gy - 6, 68, 30, 8);
  ctx.fillStyle = head;
  ctx.fill();
  roundRect(ctx, gx - 9, gy + 22, 18, 16, 4); // the spout
  ctx.fillStyle = '#6d747b';
  ctx.fill();

  // Steam wand angling off to the right of the group head.
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#b9bfc5';
  ctx.beginPath();
  ctx.moveTo(gx + 44, gy - 2);
  ctx.lineTo(gx + w * 0.17, gy + h * 0.075);
  ctx.stroke();

  // Drip tray.
  const ty = h * 0.905, th = h * 0.055;
  const steel = ctx.createLinearGradient(0, ty, 0, ty + th);
  steel.addColorStop(0, '#565e66');
  steel.addColorStop(0.5, '#2e343a');
  steel.addColorStop(1, '#43494f');
  roundRect(ctx, w * 0.1, ty, w * 0.8, th, 8);
  ctx.fillStyle = steel;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  for (let i = 1; i <= 6; i++) {
    const lx = w * 0.1 + (w * 0.8 * i) / 7;
    ctx.beginPath();
    ctx.moveTo(lx, ty + 8);
    ctx.lineTo(lx, ty + th - 8);
    ctx.stroke();
  }

  return off;
}

// ═══════════════════════════════════════════════════════════════════

export function BaristaRushCanvas({
  onGameOver, onHudTick, onStageChange, runSeconds = RUN_SECONDS_DEFAULT, className,
}: BaristaRushCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const steamRef = useRef<SteamPuff[]>([]);
  const bubblesRef = useRef<CremaBubble[]>(
    Array.from({ length: 10 }, () => ({
      u: 0.08 + Math.random() * 0.84,
      r: 1.2 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
    })),
  );
  const clockRef = useRef(0);           // renderer wobble clock (visual only)
  const foamMaxRef = useRef(1);         // captured when the art station opens
  const machineRef = useRef<{ w: number; h: number; dpr: number; bmp: HTMLCanvasElement } | null>(null);

  const physics = useBaristaPhysics({
    runSeconds,
    onStageChange: (stage, orderNo) => {
      if (stage === 'tamp') sfxGrind();
      if (stage === 'art') foamMaxRef.current = Math.max(0.01, physics.foamLeftRef.current);
      onStageChange?.(stage, orderNo);
    },
    onTamp: (q) => sfxTamp(q),
    onPullStart: () => steamOn(),
    onPullEnd: (q) => { steamOff(); sfxPullGrade(q); },
    onOverflow: () => { steamOff(); sfxOverflow(); },
    onArtStrokeStart: () => pourOn(),
    onArtStrokeEnd: () => pourOff(),
    onServe: (grade) => sfxServe(grade),
    onCountdownTick: () => sfxTick(),
    onHudTick,
    onGameOver: (score, drinks, perfects, log) => {
      steamOff(); // closing time mid-hiss is still closing time
      pourOff();
      sfxGameOver();
      onGameOver(score, drinks, perfects, log);
    },
  });

  // ── Geometry helpers (all from logical size — nothing cached) ────
  const artCup = (size: ArcadeSize) => ({
    cx: size.w / 2,
    cy: size.h * 0.52,
    r: Math.min(size.w, size.h) * 0.3,
  });

  const toCupUnit = (p: ArcadePointer, size: ArcadeSize) => {
    const { cx, cy, r } = artCup(size);
    return { x: (p.x - cx) / r, y: (p.y - cy) / r };
  };

  // ── Simulation step: physics + renderer-owned particles ──────────
  const update = (dt: number, _input: ArcadeInput, size: ArcadeSize) => {
    physics.step(dt);
    clockRef.current += dt;

    // Steam: a lazy ambient curl off the group head, a jet while the
    // valve is open.
    const puffs = steamRef.current;
    const valve = physics.valveRef.current;
    const rate = 6 + (physics.stageRef.current === 'pull' ? valve * 26 : 0);
    if (puffs.length < 36 && Math.random() < rate * dt) {
      const jetting = valve > 0.15 && physics.stageRef.current === 'pull';
      puffs.push({
        x: size.w * (jetting ? 0.5 + 0.17 * (Math.random() > 0.5 ? 1 : -0.1) : 0.42 + Math.random() * 0.16),
        y: size.h * (jetting ? 0.46 : 0.4),
        r: 3 + Math.random() * 5,
        vx: (Math.random() - 0.5) * 8,
        vy: 26 + Math.random() * 22,
        phase: Math.random() * Math.PI * 2,
        age: 0,
        ttl: 1.6 + Math.random() * 1.4,
      });
    }
    for (let i = 0; i < puffs.length; i++) {
      const s = puffs[i];
      s.age += dt;
      s.y -= s.vy * dt;
      s.x += s.vx * dt + Math.sin(s.phase + s.age * 2.4) * 14 * dt;
      s.r += 5.5 * dt;
    }
    let write = 0;
    for (let i = 0; i < puffs.length; i++) if (puffs[i].age < puffs[i].ttl) puffs[write++] = puffs[i];
    puffs.length = write;

    for (const b of bubblesRef.current) b.phase += dt * (1.6 + b.r * 0.3);
  };

  // ── Draw passes ──────────────────────────────────────────────────

  const drawSteam = (ctx: CanvasRenderingContext2D) => {
    for (const s of steamRef.current) {
      const a = Math.max(0, (1 - s.age / s.ttl) * 0.26);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.arc(s.x + s.r * 0.55, s.y + s.r * 0.3, s.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const drawTampStation = (ctx: CanvasRenderingContext2D, size: ArcadeSize) => {
    const { w, h } = size;
    const cx = w / 2, cy = h * 0.5;
    const R = Math.min(w, h) * 0.29;

    // Portafilter waiting under the gauge, tamper resting in the basket.
    const py = h * 0.8;
    const press = physics.tampPulseRef.current; // 1 → 0 after the ka-chunk
    ctx.fillStyle = '#20242a';
    ctx.beginPath();
    ctx.ellipse(cx, py, R * 0.52, R * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3d2414';
    ctx.beginPath();
    ctx.ellipse(cx, py - 4, R * 0.42, R * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    roundRect(ctx, cx + R * 0.5, py - 7, R * 0.55, 14, 7); // the handle
    ctx.fillStyle = '#14100c';
    ctx.fill();
    // Tamper: drops into the puck on the pulse.
    const ty = py - 26 + press * 14;
    ctx.fillStyle = '#c7ccd1';
    roundRect(ctx, cx - 9, ty - 20, 18, 16, 5);
    ctx.fill();
    ctx.fillStyle = '#8a9096';
    ctx.beginPath();
    ctx.ellipse(cx, ty, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── The pressure gauge ──
    // Bezel + face.
    const bez = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    bez.addColorStop(0, '#dfe4e8');
    bez.addColorStop(0.5, '#7c838a');
    bez.addColorStop(1, '#c9cfd4');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = bez;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = '#191009';
    ctx.fill();

    const zoneC = physics.zoneCenterRef.current;
    const arcR = R * 0.72;
    const needleV = physics.needleValueRef.current;
    const inGreen = Math.abs(needleV - zoneC) <= TAMP_GREEN_HALF;

    // Yellow band, then the green zone burning on top of it.
    ctx.lineCap = 'butt';
    ctx.lineWidth = R * 0.13;
    ctx.strokeStyle = 'rgba(255,210,63,0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, needleAngle(zoneC - TAMP_YELLOW_HALF), needleAngle(zoneC + TAMP_YELLOW_HALF));
    ctx.stroke();
    ctx.save();
    ctx.strokeStyle = '#3ddc84';
    ctx.shadowColor = '#3ddc84';
    ctx.shadowBlur = inGreen ? 16 : 6;
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, needleAngle(zoneC - TAMP_GREEN_HALF), needleAngle(zoneC + TAMP_GREEN_HALF));
    ctx.stroke();
    ctx.restore();

    // Dial ticks.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i <= 12; i++) {
      const v = -1 + (2 * i) / 12;
      const a = needleAngle(v);
      const major = i % 3 === 0;
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82);
      ctx.lineTo(cx + Math.cos(a) * R * (major ? 0.88 : 0.86), cy + Math.sin(a) * R * (major ? 0.88 : 0.86));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `700 ${Math.round(R * 0.14)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('BAR', cx, cy + R * 0.45);

    // The needle — red, frozen at the hit once judged.
    const a = needleAngle(needleV);
    ctx.save();
    if (physics.tampJudgedRef.current) {
      ctx.shadowColor = QUALITY_LABEL[physics.tampQualityRef.current][1];
      ctx.shadowBlur = 18;
    }
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * R * 0.12, cy - Math.sin(a) * R * 0.12);
    ctx.lineTo(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = '#d9dee2';
    ctx.fill();

    // Verdict under the gauge.
    if (physics.tampJudgedRef.current) {
      const [label, color] = QUALITY_LABEL[physics.tampQualityRef.current];
      const pop = 1 + physics.tampPulseRef.current * 0.25;
      ctx.save();
      ctx.translate(cx, cy + R * 1.22);
      ctx.scale(pop, pop);
      ctx.fillStyle = color;
      ctx.font = `900 ${Math.round(R * 0.19)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  };

  const drawPullStation = (ctx: CanvasRenderingContext2D, size: ArcadeSize) => {
    const { w, h } = size;
    const cx = w / 2;
    const cw = w * 0.34, ch = h * 0.33;
    const cupTop = h * 0.44, cupBot = cupTop + ch;
    const left = cx - cw / 2;
    const t = clockRef.current;

    const fill = physics.fillRef.current;
    const target = physics.targetFillRef.current;
    const valve = physics.valveRef.current;
    const surfaceY = cupBot - 6 - fill * (ch - 12);
    const targetY = cupBot - 6 - target * (ch - 12);

    // The stream: spout → surface, choked by valve openness.
    if (valve > 0.04) {
      const spoutY = h * 0.42;
      ctx.strokeStyle = 'rgba(48,24,10,0.9)';
      ctx.lineWidth = 4.5 * valve;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, spoutY);
      ctx.lineTo(cx + Math.sin(t * 21) * 1.2, surfaceY);
      ctx.stroke();
      // Splash flecks where it lands.
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = 'rgba(198,138,74,0.6)';
        ctx.beginPath();
        ctx.arc(cx + Math.sin(t * 13 + i * 2.1) * 9, surfaceY - 2, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Espresso body + crema cap.
    if (fill > 0.005) {
      const liq = ctx.createLinearGradient(0, surfaceY, 0, cupBot);
      liq.addColorStop(0, '#3b2010');
      liq.addColorStop(1, '#170b04');
      ctx.fillStyle = liq;
      roundRect(ctx, left + 4, surfaceY, cw - 8, cupBot - surfaceY - 3, 5);
      ctx.fill();
      const crema = ctx.createLinearGradient(0, surfaceY, 0, surfaceY + 8);
      crema.addColorStop(0, '#d9995a');
      crema.addColorStop(1, '#996032');
      ctx.fillStyle = crema;
      ctx.fillRect(left + 4, surfaceY, cw - 8, Math.min(8, cupBot - surfaceY));
      // Golden crema bubbles riding the surface.
      for (const b of bubblesRef.current) {
        const bx = left + 6 + b.u * (cw - 12);
        const by = surfaceY + 2 + Math.sin(b.phase) * 1.6;
        ctx.fillStyle = `rgba(240,205,140,${(0.35 + 0.25 * Math.sin(b.phase * 1.3)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(bx, by, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The glass itself, over the liquid.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    roundRect(ctx, left, cupTop, cw, ch, 8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(left + cw * 0.12, cupTop + 6, cw * 0.1, ch - 12); // vertical highlight

    // The etched target line — glowing hotter as the shot approaches.
    const near = Math.abs(fill - target) <= PULL_GOOD;
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = near ? 3 : 2;
    ctx.strokeStyle = near ? '#ffe9a8' : 'rgba(255,233,168,0.65)';
    if (near) { ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 10; }
    ctx.beginPath();
    ctx.moveTo(left - 12, targetY);
    ctx.lineTo(left + cw + 12, targetY);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffe9a8';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TARGET', left + cw + 16, targetY + 3);
    ctx.beginPath(); // little arrows framing the line
    ctx.moveTo(left - 20, targetY - 5);
    ctx.lineTo(left - 12, targetY);
    ctx.lineTo(left - 20, targetY + 5);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();

    // Overfill panic: the rim burns red as the shot climbs past the line.
    if (!physics.pullJudgedRef.current && fill > target + 0.04) {
      const danger = Math.min(1, (fill - target - 0.04) / (1 - target - 0.04));
      ctx.strokeStyle = `rgba(255,60,60,${(0.25 + danger * 0.55 + Math.sin(t * 18) * 0.15).toFixed(3)})`;
      ctx.lineWidth = 4;
      roundRect(ctx, left - 2, cupTop - 2, cw + 4, ch + 4, 9);
      ctx.stroke();
    }

    // Verdict after the release.
    if (physics.pullJudgedRef.current && physics.stampRef.current === null) {
      const [label, color] = PULL_LABEL[physics.pullQualityRef.current];
      ctx.fillStyle = color;
      ctx.font = `900 ${Math.round(w * 0.055)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, cx, cupBot + 34);
    }
  };

  const drawArtStation = (ctx: CanvasRenderingContext2D, size: ArcadeSize) => {
    const { cx, cy, r } = artCup(size);
    const t = clockRef.current;
    const foamFrac = Math.min(1, physics.foamLeftRef.current / foamMaxRef.current);
    // The cup shivers when the foam is nearly gone.
    const wob = foamFrac < 0.25 ? Math.sin(t * 30) * 1.5 : 0;

    ctx.save();
    ctx.translate(wob, 0);

    // Saucer, rim, coffee.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.16, r * 1.28, r * 1.08, 0, 0, Math.PI * 2);
    ctx.fill();
    const rim = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r * 1.14);
    rim.addColorStop(0, '#ffffff');
    rim.addColorStop(0.85, '#cfd2d6');
    rim.addColorStop(1, '#9a9ea3');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.14, 0, Math.PI * 2);
    ctx.fillStyle = rim;
    ctx.fill();
    const coffee = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    coffee.addColorStop(0, '#6b4226');
    coffee.addColorStop(1, '#40250f');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = coffee;
    ctx.fill();
    // Faint crema swirls.
    ctx.strokeStyle = 'rgba(214,164,110,0.16)';
    ctx.lineWidth = r * 0.06;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.4 + i * 0.2), i * 1.9 + t * 0.12, i * 1.9 + t * 0.12 + 2.1);
      ctx.stroke();
    }

    // Stencil: faint full path, bright where the trace has lit it.
    const stencil = STENCILS[physics.artKindRef.current];
    const matched = physics.matchedRef.current;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < STENCIL_SAMPLES; i++) {
      const px = cx + stencil[i].x * r, py = cy + stencil[i].y * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,250,238,0.9)';
    ctx.shadowColor = 'rgba(255,240,210,0.8)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 5;
    for (let i = 1; i < STENCIL_SAMPLES; i++) {
      if (matched[i - 1] && matched[i]) {
        ctx.beginPath();
        ctx.moveTo(cx + stencil[i - 1].x * r, cy + stencil[i - 1].y * r);
        ctx.lineTo(cx + stencil[i].x * r, cy + stencil[i].y * r);
        ctx.stroke();
      }
    }
    ctx.restore();

    // The player's milk line.
    const stroke = physics.strokeRef.current;
    if (stroke.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#f3e7d3';
      ctx.shadowColor = 'rgba(255,255,255,0.35)';
      ctx.shadowBlur = 6;
      ctx.lineWidth = r * 0.09;
      ctx.beginPath();
      ctx.moveTo(cx + stroke[0].x * r, cy + stroke[0].y * r);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(cx + stroke[i].x * r, cy + stroke[i].y * r);
      ctx.stroke();
      ctx.restore();
    }
    if (stroke.length > 0 && physics.strokeActiveRef.current) {
      const lastPt = stroke[stroke.length - 1];
      ctx.fillStyle = '#fffdf7';
      ctx.beginPath();
      ctx.arc(cx + lastPt.x * r, cy + lastPt.y * r, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore(); // wobble

    // Foam-settle ring around the rim: white → amber → angry red.
    const ringColor = foamFrac > 0.5 ? 'rgba(255,255,255,0.85)' : foamFrac > 0.25 ? '#ffd23f' : '#ff4d4d';
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.22, -Math.PI / 2, -Math.PI / 2 + foamFrac * Math.PI * 2);
    ctx.stroke();

    // Live coverage readout.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `800 ${Math.round(r * 0.14)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`ART ${Math.round(physics.coverageRef.current * 100)}%`, cx, cy + r * 1.5);
  };

  const drawStamp = (ctx: CanvasRenderingContext2D, size: ArcadeSize) => {
    const stamp = physics.stampRef.current;
    if (!stamp) return;
    const { w, h } = size;
    const k = Math.min(1, stamp.age / 0.22);            // slam-in
    const fade = Math.max(0, Math.min(1, (stamp.ttl - stamp.age) / 0.25));
    const scale = 1 + (1 - k) * (1 - k) * 1.1;          // big → settles
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 2) * fade;
    ctx.translate(w / 2, h * 0.5);
    ctx.rotate(-0.13);
    ctx.scale(scale, scale);
    const bw = w * 0.74, bh = h * 0.17;
    ctx.strokeStyle = stamp.color;
    ctx.lineWidth = 6;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 14);
    ctx.stroke();
    ctx.fillStyle = 'rgba(10,6,3,0.55)';
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 14);
    ctx.fill();
    ctx.fillStyle = stamp.color;
    ctx.textAlign = 'center';
    ctx.font = `900 ${Math.round(w * 0.085)}px system-ui, sans-serif`;
    ctx.fillText(stamp.text, 0, -bh * 0.06);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(w * 0.045)}px system-ui, sans-serif`;
    ctx.fillText(stamp.sub, 0, bh * 0.3);
    ctx.restore();
  };

  const drawHud = (ctx: CanvasRenderingContext2D, size: ArcadeSize) => {
    const { w, h } = size;

    // Shift-clock bar pinned to the very top.
    const frac = physics.timeLeftRef.current / runSeconds;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = frac > 0.4 ? '#f3e7d3' : frac > 0.15 ? '#ffd23f' : '#ff4d4d';
    ctx.fillRect(0, 0, w * frac, 6);

    // The order ticket, askew like it just came off the rail.
    ctx.save();
    ctx.translate(w * 0.03, h * 0.025);
    ctx.rotate(-0.05);
    ctx.fillStyle = '#f7f2e8';
    roundRect(ctx, 0, 0, 96, 40, 4);
    ctx.fill();
    ctx.fillStyle = '#2b2118';
    ctx.textAlign = 'left';
    ctx.font = '800 12px ui-monospace, monospace';
    ctx.fillText(`ORDER #${physics.orderNoRef.current}`, 8, 16);
    ctx.font = '700 9px ui-monospace, monospace';
    ctx.fillText(physics.orderNameRef.current, 8, 30);
    ctx.restore();

    // Stage banner + hint during the station intro (hints fade for pros).
    const stage = physics.stageRef.current;
    if (stage !== 'serve') {
      const intro = physics.stageClockRef.current;
      const showHint = physics.orderNoRef.current <= 2 || intro < 1.1;
      if (showHint) {
        const a = Math.min(1, intro * 4) * Math.min(1, Math.max(0, 2.2 - intro));
        ctx.save();
        ctx.globalAlpha = physics.orderNoRef.current <= 2 ? 1 : a;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd23f';
        ctx.font = `900 ${Math.round(w * 0.042)}px system-ui, sans-serif`;
        ctx.fillText(STAGE_BANNER[stage], w / 2, h * 0.09);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `600 ${Math.round(w * 0.034)}px system-ui, sans-serif`;
        ctx.fillText(STAGE_HINT[stage], w / 2, h * 0.125);
        ctx.restore();
      }
    }

    // Caffeine Rush pill above the drip tray.
    const combo = physics.comboRef.current;
    const pop = 1 + physics.servePulseRef.current * 0.18;
    ctx.save();
    ctx.translate(w / 2, h * 0.875);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    if (combo > 1) {
      const label = `CAFFEINE RUSH ×${combo.toFixed(1).replace(/\.0$/, '')}`;
      ctx.font = `900 ${Math.round(w * 0.045)}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(255,140,60,0.18)';
      roundRect(ctx, -tw / 2 - 12, -16, tw + 24, 26, 13);
      ctx.fill();
      ctx.strokeStyle = '#ff9c50';
      ctx.lineWidth = 2;
      roundRect(ctx, -tw / 2 - 12, -16, tw + 24, 26, 13);
      ctx.stroke();
      ctx.fillStyle = '#ffb87a';
      ctx.fillText(label, 0, 4);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `700 ${Math.round(w * 0.035)}px system-ui, sans-serif`;
      ctx.fillText('×1', 0, 4);
    }
    ctx.restore();

    // Ruin wash.
    const ruin = physics.ruinFlashRef.current;
    if (ruin > 0) {
      ctx.fillStyle = `rgba(200,30,30,${(ruin * 0.3).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
  };

  const render = (ctx: CanvasRenderingContext2D, size: ArcadeSize) => {
    const { w, h, dpr } = size;
    if (w <= 0 || h <= 0) return;

    // Blit the cached machine (repaint only on resize).
    let cache = machineRef.current;
    if (!cache || cache.w !== w || cache.h !== h || cache.dpr !== dpr) {
      cache = { w, h, dpr, bmp: paintMachine(w, h, dpr) };
      machineRef.current = cache;
    }

    ctx.save();
    const shake = physics.shakeRef.current;
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * 8 * shake, (Math.random() - 0.5) * 8 * shake);
    }

    ctx.drawImage(cache.bmp, 0, 0, w, h);
    drawSteam(ctx);

    const stage = physics.stageRef.current;
    if (stage === 'tamp') drawTampStation(ctx, size);
    else if (stage === 'pull') drawPullStation(ctx, size);
    else if (stage === 'art') drawArtStation(ctx, size);
    else {
      // 'serve': keep the finished drink on the counter under the stamp.
      // A ruined shot never reached the art station — show the flood.
      if (physics.strokeRef.current.length > 0) drawArtStation(ctx, size);
      else drawPullStation(ctx, size);
    }

    drawStamp(ctx, size);
    drawHud(ctx, size);
    ctx.restore();
  };

  useArcadeEngine(
    canvasRef,
    {
      update,
      render,
      onPointerDown: (p, size) => {
        const u = toCupUnit(p, size);
        physics.press(u.x, u.y);
      },
      onPointerMove: (p, size) => {
        const u = toCupUnit(p, size);
        physics.moveTo(u.x, u.y);
      },
      onPointerUp: () => physics.release(),
    },
    { autoStart: true },
  );

  // The wrapper's intro screen gates the mount, so the shift starts
  // the moment the canvas exists.
  useEffect(() => {
    physics.start();
    return () => {
      // Unmount mid-hold must not leave a hiss running.
      steamOff();
      pourOff();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ display: 'block', width: '100%', height: '100%' }} />;
}
