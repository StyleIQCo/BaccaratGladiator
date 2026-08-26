// ═══════════════════════════════════════════════════════════════════
//  MADRONA WOOD LABYRINTH — canvas renderer.
//
//  Runs on the shared useArcadeEngine: fixed-timestep update feeds
//  useTiltPhysics, and everything renders into ONE <canvas>. No DOM in
//  the maze, no React state in the hot path.
//
//  Layers, back to front:
//    1. The board — madrona plate, wood grain, carved floor, wall
//       planks, knot-holes, the start dimple, the emerald recess.
//       Static, so it's painted ONCE per resize into an offscreen
//       canvas and blitted every frame (shifted a few px by the live
//       tilt so the whole board reads as physically leaning).
//    2. Destructible barriers — distressed lighter planks with
//       prominent black crack lines. LIVE, because they shatter.
//    3. Gems, goal shimmer, splinter debris, the marble itself
//       (render style straight from marbleData.renderType).
//    4. Juice — tilt light-sweep, camera shake, respawn ring,
//       end-of-run banner.
//
//  Input: touch-drag anywhere = tilt vector (offset from board
//  centre). Read from the engine's per-frame input state, so a held
//  finger keeps tilting between pointer events.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import {
  useArcadeEngine,
  type ArcadeInput,
  type ArcadeSize,
} from '../../hooks/useArcadeEngine';
import { getMarble, type MarbleId, type MarbleSpec } from './marbleData';
import {
  MARBLE_R,
  MAZE_COLS,
  MAZE_GOAL,
  MAZE_HOLES,
  MAZE_ROWS,
  MAZE_START,
  MAZE_WALLS,
  RUN_SECONDS_DEFAULT,
  useTiltPhysics,
  type DestructibleBarrier,
  type RunResult,
  type TiltPhysics,
} from './useTiltPhysics';
import {
  sfxBarrierCrash,
  sfxBarrierThud,
  sfxGameOver,
  sfxGem,
  sfxGoal,
  sfxHoleFall,
  sfxRespawn,
  sfxSwap,
  sfxTick,
  sfxWallHit,
  setRollSpeed,
  startRoll,
  stopRoll,
} from './madronaSfx';

export interface MadronaCanvasProps {
  /** The equipped marble — swapping mid-run re-caps momentum. */
  marbleId: MarbleId;
  /** True while the inventory overlay is up: sim + clock freeze. */
  paused?: boolean;
  onGameOver: (result: RunResult) => void;
  /** Low-rate (4 Hz) feed for the wrapper's DOM HUD. */
  onHudTick?: (timeLeft: number, score: number, gems: number) => void;
  runSeconds?: number;
  className?: string;
}

// ── Renderer-local FX state ────────────────────────────────────────

interface Splinter {
  x: number; y: number;      // board units
  vx: number; vy: number;
  rot: number; vr: number;
  len: number; wid: number;  // board units
  color: string;
  age: number; ttl: number;
}

/** Deterministic PRNG so wood grain / cracks survive repaints identically. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPLINTER_COLORS = ['#8a5a34', '#a06b3d', '#6b4123', '#c08d55'];

/** Crack polylines for one barrier, in 0…1 plank-local coords. */
function buildCracks(id: number): { pts: [number, number][] }[] {
  const rnd = mulberry32(97 + id * 131);
  const cracks: { pts: [number, number][] }[] = [];
  // Two long fissures wandering across the plank + three short radial
  // splits off the centre — reads as "one good hit finishes this".
  for (let c = 0; c < 2; c++) {
    const vertical = rnd() > 0.5;
    const pts: [number, number][] = [];
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wobble = (rnd() - 0.5) * 0.34;
      pts.push(vertical ? [0.3 + c * 0.4 + wobble, t] : [t, 0.3 + c * 0.4 + wobble]);
    }
    cracks.push({ pts });
  }
  for (let c = 0; c < 3; c++) {
    const a = rnd() * Math.PI * 2;
    const len = 0.2 + rnd() * 0.25;
    const mid: [number, number] = [
      0.5 + Math.cos(a) * len * 0.5 + (rnd() - 0.5) * 0.1,
      0.5 + Math.sin(a) * len * 0.5 + (rnd() - 0.5) * 0.1,
    ];
    cracks.push({ pts: [[0.5, 0.5], mid, [0.5 + Math.cos(a) * len, 0.5 + Math.sin(a) * len]] });
  }
  return cracks;
}

interface BoardMetrics {
  scale: number; // px per board unit
  ox: number;
  oy: number;
}

function metricsFor(size: ArcadeSize): BoardMetrics {
  const pad = 14;
  const scale = Math.min((size.w - pad * 2) / MAZE_COLS, (size.h - pad * 2) / MAZE_ROWS);
  return {
    scale,
    ox: (size.w - MAZE_COLS * scale) / 2,
    oy: (size.h - MAZE_ROWS * scale) / 2,
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── Static board (painted once per resize) ─────────────────────────

function paintBoard(off: HTMLCanvasElement, size: ArcadeSize, m: BoardMetrics) {
  off.width = Math.max(1, Math.round(size.w * size.dpr));
  off.height = Math.max(1, Math.round(size.h * size.dpr));
  const ctx = off.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);

  const { scale, ox, oy } = m;
  const u = (v: number) => v * scale;
  const X = (v: number) => ox + v * scale;
  const Y = (v: number) => oy + v * scale;

  // Dusk backdrop behind the board.
  const bg = ctx.createLinearGradient(0, 0, 0, size.h);
  bg.addColorStop(0, '#14231c');
  bg.addColorStop(1, '#0b120e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size.w, size.h);

  // The madrona plate — rich orange-red heartwood, slightly proud of the maze.
  const lip = u(0.32);
  const plate = ctx.createLinearGradient(0, Y(0) - lip, 0, Y(MAZE_ROWS) + lip);
  plate.addColorStop(0, '#9a5232');
  plate.addColorStop(0.5, '#83422a');
  plate.addColorStop(1, '#63301f');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, X(0) - lip, Y(0) - lip, u(MAZE_COLS) + lip * 2, u(MAZE_ROWS) + lip * 2, u(0.4));
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.restore();

  // Carved floor — a shade darker, sanded matte.
  const floor = ctx.createLinearGradient(0, Y(0), 0, Y(MAZE_ROWS));
  floor.addColorStop(0, '#75432b');
  floor.addColorStop(1, '#5c3221');
  ctx.fillStyle = floor;
  ctx.fillRect(X(0), Y(0), u(MAZE_COLS), u(MAZE_ROWS));

  // Wood grain: long sinuous strokes, deterministic so resizes are calm.
  const rnd = mulberry32(20260826);
  ctx.save();
  ctx.beginPath();
  ctx.rect(X(0) - lip, Y(0) - lip, u(MAZE_COLS) + lip * 2, u(MAZE_ROWS) + lip * 2);
  ctx.clip();
  for (let i = 0; i < 42; i++) {
    const gy = Y(-0.4) + rnd() * u(MAZE_ROWS + 0.8);
    const amp = u(0.04 + rnd() * 0.08);
    const wl = u(2 + rnd() * 3);
    ctx.beginPath();
    for (let px = X(-0.5); px <= X(MAZE_COLS + 0.5); px += 6) {
      const yy = gy + Math.sin(px / wl + i * 1.7) * amp;
      px === X(-0.5) ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
    }
    ctx.strokeStyle = rnd() > 0.5 ? 'rgba(50,24,14,0.16)' : 'rgba(230,160,110,0.09)';
    ctx.lineWidth = 1 + rnd() * 1.4;
    ctx.stroke();
  }
  ctx.restore();

  // Wall planks: raised madrona ridges with bevel + cast shadow.
  for (const w of MAZE_WALLS) {
    const wx = X(w.x);
    const wy = Y(w.y);
    const ww = u(w.w);
    const wh = u(w.h);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = u(0.12);
    ctx.shadowOffsetY = u(0.08);
    const face = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    face.addColorStop(0, '#a75c38');
    face.addColorStop(1, '#7c452b');
    ctx.fillStyle = face;
    roundRect(ctx, wx, wy, ww, wh, u(0.09));
    ctx.fill();
    ctx.restore();
    // Bevel: lit top edge, shaded bottom edge.
    ctx.strokeStyle = 'rgba(255,205,160,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(wx + u(0.08), wy + 1);
    ctx.lineTo(wx + ww - u(0.08), wy + 1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,8,4,0.5)';
    ctx.beginPath();
    ctx.moveTo(wx + u(0.08), wy + wh - 1);
    ctx.lineTo(wx + ww - u(0.08), wy + wh - 1);
    ctx.stroke();
  }

  // Knot-holes: the board's own dark eyes. Visual radius is generous —
  // the swallow radius in physics is tighter, so a brave hug survives.
  for (const h of MAZE_HOLES) {
    const hx = X(h.x);
    const hy = Y(h.y);
    const hr = u(0.3);
    const g = ctx.createRadialGradient(hx, hy, hr * 0.1, hx, hy, hr);
    g.addColorStop(0, '#050302');
    g.addColorStop(0.75, '#160b06');
    g.addColorStop(1, '#2e1a10');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
    // Rim light on the lower edge — a lathed hole, not a flat dot.
    ctx.strokeStyle = 'rgba(235,170,120,0.28)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }

  // Start dimple.
  ctx.strokeStyle = 'rgba(255,220,180,0.4)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([u(0.07), u(0.07)]);
  ctx.beginPath();
  ctx.arc(X(MAZE_START.x), Y(MAZE_START.y), u(0.34), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // The emerald recess: a carved socket. (The gem itself shimmers live.)
  const gx = X(MAZE_GOAL.x);
  const gy = Y(MAZE_GOAL.y);
  const rec = ctx.createRadialGradient(gx, gy, u(0.05), gx, gy, u(0.42));
  rec.addColorStop(0, '#241209');
  rec.addColorStop(1, '#4a2917');
  ctx.fillStyle = rec;
  ctx.beginPath();
  ctx.arc(gx, gy, u(0.42), 0, Math.PI * 2);
  ctx.fill();
}

// ── The component ──────────────────────────────────────────────────

export function MadronaCanvas({
  marbleId,
  paused = false,
  onGameOver,
  onHudTick,
  runSeconds = RUN_SECONDS_DEFAULT,
  className,
}: MadronaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardRef = useRef<HTMLCanvasElement | null>(null);
  const boardDirtyRef = useRef(true);
  const splintersRef = useRef<Splinter[]>([]);
  const cracksRef = useRef(new Map<number, { pts: [number, number][] }[]>());
  const timeRef = useRef(0); // render clock for shimmer/bob

  const spawnSplinters = (b: DestructibleBarrier, vx: number, vy: number) => {
    const sp = Math.max(1, Math.hypot(vx, vy));
    const dx = vx / sp;
    const dy = vy / sp;
    const rnd = Math.random;
    for (let i = 0; i < 18; i++) {
      const spread = (rnd() - 0.5) * 2.4;
      const px = -dy * spread;
      const py = dx * spread;
      const speed = 1 + rnd() * 3.5;
      splintersRef.current.push({
        x: b.x + 0.2 + rnd() * (b.w - 0.4),
        y: b.y + 0.2 + rnd() * (b.h - 0.4),
        vx: dx * speed + px,
        vy: dy * speed + py,
        rot: rnd() * Math.PI * 2,
        vr: (rnd() - 0.5) * 14,
        len: 0.07 + rnd() * 0.12,
        wid: 0.02 + rnd() * 0.025,
        color: SPLINTER_COLORS[i % SPLINTER_COLORS.length],
        age: 0,
        ttl: 0.7 + rnd() * 0.5,
      });
    }
  };

  const physics: TiltPhysics = useTiltPhysics({
    runSeconds,
    onGameOver: (r) => {
      stopRoll();
      if (!r.finished) sfxGameOver();
      onGameOver(r);
    },
    onHudTick,
    onWallHit: (id, impact) => sfxWallHit(id, impact / 6),
    onBarrierHit: (impact) => sfxBarrierThud(impact / 6),
    onBarrierBreak: (b, vx, vy) => {
      sfxBarrierCrash();
      spawnSplinters(b, vx, vy);
    },
    onGem: (n) => sfxGem(n),
    onFall: () => sfxHoleFall(),
    onRespawn: () => sfxRespawn(),
    onGoal: () => sfxGoal(),
    onCountdownTick: () => sfxTick(),
    onMarbleChange: (spec: MarbleSpec) => {
      sfxSwap(spec.id);
      startRoll(spec.id); // the rolling bed is voiced by material
    },
  });

  const engine = useArcadeEngine(canvasRef, {
    onResize: () => {
      boardDirtyRef.current = true;
    },
    update: (dt, input: ArcadeInput, size: ArcadeSize) => {
      timeRef.current += dt;

      // Held finger = board tilt, offset from the canvas centre.
      if (physics.statusRef.current === 'running' && !physics.pausedRef.current) {
        if (input.isDown && input.pointer) {
          const radius = Math.min(size.w, size.h) * 0.35;
          physics.setTilt(
            (input.pointer.x - size.w / 2) / radius,
            (input.pointer.y - size.h / 2) / radius,
          );
        } else {
          physics.setTilt(0, 0); // board self-levels when released
        }
      }

      physics.step(dt);

      // The rolling bed follows live speed (silent while paused/fallen).
      const active =
        physics.statusRef.current === 'running' &&
        !physics.pausedRef.current &&
        physics.fallingRef.current === 0;
      const v = physics.velRef.current;
      setRollSpeed(active ? Math.hypot(v.x, v.y) / physics.marbleRef.current.maxSpeed : 0);

      // Splinter debris decays renderer-side; physics never sees it.
      const sp = splintersRef.current;
      for (let i = sp.length - 1; i >= 0; i--) {
        const s = sp[i];
        s.age += dt;
        if (s.age >= s.ttl) {
          sp.splice(i, 1);
          continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= 0.94;
        s.vy *= 0.94;
        s.rot += s.vr * dt;
      }
    },
    render: (ctx, size) => {
      const m = metricsFor(size);
      const { scale, ox, oy } = m;
      const u = (v: number) => v * scale;
      const X = (v: number) => ox + v * scale;
      const Y = (v: number) => oy + v * scale;

      if (!boardRef.current) boardRef.current = document.createElement('canvas');
      if (boardDirtyRef.current) {
        paintBoard(boardRef.current, size, m);
        boardDirtyRef.current = false;
      }

      const tilt = physics.tiltRef.current;
      const shake = physics.shakeRef.current;

      ctx.save();
      // Camera shake (200 ms per barrier crash) + the tilt lean.
      if (shake > 0) {
        const k = shake * 26;
        ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
      }
      ctx.translate(tilt.x * 4, tilt.y * 4);

      ctx.drawImage(boardRef.current, 0, 0, size.w, size.h);

      // Tilt light-sweep: the finish catches light on the raised side.
      const sweepMag = Math.hypot(tilt.x, tilt.y);
      if (sweepMag > 0.03) {
        const g = ctx.createLinearGradient(
          size.w / 2 - tilt.x * size.w * 0.6,
          size.h / 2 - tilt.y * size.h * 0.6,
          size.w / 2 + tilt.x * size.w * 0.6,
          size.h / 2 + tilt.y * size.h * 0.6,
        );
        g.addColorStop(0, `rgba(255,235,200,${0.09 * Math.min(1, sweepMag)})`);
        g.addColorStop(0.5, 'rgba(255,235,200,0)');
        g.addColorStop(1, `rgba(10,5,2,${0.12 * Math.min(1, sweepMag)})`);
        ctx.fillStyle = g;
        ctx.fillRect(X(0) - u(0.32), Y(0) - u(0.32), u(MAZE_COLS) + u(0.64), u(MAZE_ROWS) + u(0.64));
      }

      // ── Destructible barriers: distressed planks, black cracks ──
      for (const b of physics.barriersRef.current) {
        let cracks = cracksRef.current.get(b.id);
        if (!cracks) {
          cracks = buildCracks(b.id);
          cracksRef.current.set(b.id, cracks);
        }
        ctx.save();
        const bx = X(b.x + b.w / 2);
        const by = Y(b.y + b.h / 2);
        ctx.translate(bx, by);
        if (b.pulse > 0) {
          // Bounced hit: the plank shudders but holds.
          const wob = 1 + Math.sin(b.pulse * 26) * 0.05 * b.pulse;
          ctx.scale(wob, wob);
          ctx.rotate(Math.sin(b.pulse * 31) * 0.03 * b.pulse);
        }
        ctx.translate(-bx, -by);

        const px = X(b.x) + u(0.04);
        const py = Y(b.y) + u(0.04);
        const pw = u(b.w) - u(0.08);
        const ph = u(b.h) - u(0.08);
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = u(0.08);
        // Lighter, sun-bleached wood — instantly reads apart from walls.
        const face = ctx.createLinearGradient(px, py, px, py + ph);
        face.addColorStop(0, '#d9b078');
        face.addColorStop(1, '#b08a55');
        ctx.fillStyle = face;
        roundRect(ctx, px, py, pw, ph, u(0.06));
        ctx.fill();
        ctx.shadowBlur = 0;
        // Plank grain.
        ctx.strokeStyle = 'rgba(120,80,40,0.35)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(px + u(0.06), py + (ph * i) / 4);
          ctx.lineTo(px + pw - u(0.06), py + (ph * i) / 4 + u(0.02));
          ctx.stroke();
        }
        // The cracks — prominent, black, unmistakably breakable.
        ctx.strokeStyle = '#170e07';
        ctx.lineWidth = Math.max(1.5, u(0.035));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const c of cracks) {
          ctx.beginPath();
          c.pts.forEach(([cx, cy], i) => {
            const vx2 = px + cx * pw;
            const vy2 = py + cy * ph;
            i === 0 ? ctx.moveTo(vx2, vy2) : ctx.lineTo(vx2, vy2);
          });
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── Gems ──
      const t = timeRef.current;
      for (const g of physics.gemsListRef.current) {
        if (g.taken) continue;
        const gx = X(g.x);
        const gy = Y(g.y) + Math.sin(t * 2.2 + g.x * 3) * u(0.03);
        const gr = u(0.15);
        const spin = t * 1.6 + g.y;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.scale(Math.abs(Math.cos(spin)) * 0.6 + 0.4, 1); // lazy 3D spin
        ctx.shadowColor = '#4dff9e';
        ctx.shadowBlur = u(0.12);
        ctx.beginPath();
        ctx.moveTo(0, -gr);
        ctx.lineTo(gr * 0.8, 0);
        ctx.lineTo(0, gr);
        ctx.lineTo(-gr * 0.8, 0);
        ctx.closePath();
        ctx.fillStyle = '#37e58c';
        ctx.fill();
        ctx.strokeStyle = '#c8ffe2';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }

      // ── The emerald inlay shimmers; blooms when the marble sinks ──
      {
        const gx = X(MAZE_GOAL.x);
        const gy = Y(MAZE_GOAL.y);
        const pulse = physics.goalPulseRef.current;
        const rr = u(0.26) * (1 + Math.sin(t * 2.6) * 0.05 + pulse * 0.5);
        ctx.save();
        ctx.shadowColor = '#3aff9a';
        ctx.shadowBlur = u(0.2) * (1 + pulse * 2);
        ctx.beginPath();
        const sides = 6;
        for (let i = 0; i <= sides; i++) {
          const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
          const vx2 = gx + Math.cos(a) * rr;
          const vy2 = gy + Math.sin(a) * rr;
          i === 0 ? ctx.moveTo(vx2, vy2) : ctx.lineTo(vx2, vy2);
        }
        ctx.closePath();
        const gem = ctx.createRadialGradient(gx - rr * 0.3, gy - rr * 0.3, rr * 0.1, gx, gy, rr);
        gem.addColorStop(0, '#a9ffd6');
        gem.addColorStop(0.55, '#2ecf7f');
        gem.addColorStop(1, '#0d7a45');
        ctx.fillStyle = gem;
        ctx.fill();
        ctx.restore();
        if (pulse > 0) {
          ctx.strokeStyle = `rgba(120,255,190,${pulse * 0.8})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(gx, gy, u(0.45) + (1 - pulse) * u(1.2), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ── Splinter debris ──
      for (const s of splintersRef.current) {
        const a = 1 - s.age / s.ttl;
        ctx.save();
        ctx.translate(X(s.x), Y(s.y));
        ctx.rotate(s.rot);
        ctx.globalAlpha = a;
        ctx.fillStyle = s.color;
        ctx.fillRect(-u(s.len) / 2, -u(s.wid) / 2, u(s.len), u(s.wid));
        ctx.restore();
      }

      // ── Respawn ring at the start dimple ──
      const flash = physics.respawnFlashRef.current;
      if (flash > 0) {
        ctx.strokeStyle = `rgba(255,235,200,${flash})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(X(MAZE_START.x), Y(MAZE_START.y), u(0.34) + (1 - flash) * u(0.8), 0, Math.PI * 2);
        ctx.stroke();
      }

      // ── The marble ──
      drawMarble(ctx, physics, m);

      ctx.restore(); // shake + lean

      // ── End-of-run banner (the wrapper's result panel follows) ──
      if (physics.statusRef.current === 'over') {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = `900 ${Math.round(size.w * 0.09)}px system-ui, sans-serif`;
        ctx.fillStyle = physics.finishedRef.current ? '#5dffb0' : '#ffb17a';
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 12;
        ctx.fillText(
          physics.finishedRef.current ? 'IN THE POCKET!' : 'TIME!',
          size.w / 2,
          size.h * 0.42,
        );
        ctx.restore();
      }
    },
  });

  // Mount = run start (the wrapper only mounts this once play begins).
  useEffect(() => {
    physics.start();
    physics.setMarble(marbleId); // no-op when already equipped
    startRoll(marbleId);
    engine.start();
    return () => {
      engine.stop();
      stopRoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marble swaps + inventory pause arrive as props from the wrapper.
  useEffect(() => {
    physics.setMarble(marbleId);
  }, [marbleId, physics]);
  useEffect(() => {
    physics.setPaused(paused);
  }, [paused, physics]);

  // Smoke-test handle, ?madronaDebug only — same convention as ?eadebug.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('madronaDebug')) return;
    const w = window as unknown as { __madronaDebug?: unknown };
    w.__madronaDebug = {
      physics,
      getState: () => ({
        status: physics.statusRef.current,
        marble: physics.marbleRef.current.id,
        pos: { ...physics.posRef.current },
        vel: { ...physics.velRef.current },
        score: physics.scoreRef.current,
        gems: physics.gemsCountRef.current,
        smashed: physics.smashedRef.current,
        barriers: physics.barriersRef.current.length,
        timeLeft: physics.timeLeftRef.current,
      }),
      teleport: (x: number, y: number) => {
        physics.posRef.current.x = x;
        physics.posRef.current.y = y;
      },
      setVel: (x: number, y: number) => {
        physics.velRef.current.x = x;
        physics.velRef.current.y = y;
      },
      setTilt: physics.setTilt,
      setMarble: physics.setMarble,
    };
    return () => {
      delete w.__madronaDebug;
    };
  }, [physics]);

  return <canvas ref={canvasRef} className={className} />;
}

// ── Marble rendering (style comes straight from marbleData) ────────

function drawMarble(ctx: CanvasRenderingContext2D, physics: TiltPhysics, m: BoardMetrics) {
  const { scale, ox, oy } = m;
  const pos = physics.posRef.current;
  const spec = physics.marbleRef.current;
  const rs = spec.render;
  const falling = physics.fallingRef.current;
  // Ease the shrink so the swallow reads as a drop, not a fade.
  const shrink = falling > 0 ? Math.max(0, 1 - falling * falling) : 1;
  if (shrink <= 0) return;

  const px = ox + pos.x * scale;
  const py = oy + pos.y * scale;
  const r = MARBLE_R * scale * shrink;
  const tilt = physics.tiltRef.current;

  // Cast shadow slides opposite the tilt — the cheapest depth cue there is.
  ctx.save();
  ctx.globalAlpha = 0.35 * shrink;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(px - tilt.x * r * 0.7, py - tilt.y * r * 0.7 + r * 0.25, r * 1.02, r * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = rs.alpha * (falling > 0 ? shrink : 1);

  // Body: radial gradient, hot-spot offset up-left toward the light.
  const body = ctx.createRadialGradient(px + rs.specular.dx * r, py + rs.specular.dy * r, r * 0.08, px, py, r);
  body.addColorStop(0, rs.body[0]);
  body.addColorStop(0.55, rs.body[1]);
  body.addColorStop(1, rs.body[2]);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = rs.rim;
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.stroke();

  // Iron: pitted matte texture — the pits ride the rolling rotation.
  if (rs.pitted) {
    const rot = physics.rotRef.current;
    ctx.fillStyle = 'rgba(12,13,15,0.35)';
    for (let i = 0; i < 9; i++) {
      const a = rot * (i % 2 === 0 ? 1 : -0.7) + i * 2.4;
      const rad = r * (0.25 + ((i * 37) % 50) / 100);
      const pxx = px + Math.cos(a) * rad;
      const pyy = py + Math.sin(a) * rad;
      // Keep pits on the ball face.
      if ((pxx - px) ** 2 + (pyy - py) ** 2 > (r * 0.82) ** 2) continue;
      ctx.beginPath();
      ctx.arc(pxx, pyy, r * (0.05 + ((i * 13) % 4) / 100), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Glass: the inner glowing ring — polished, lit from within.
  if (rs.innerGlow) {
    ctx.strokeStyle = rs.innerGlow.color;
    ctx.globalAlpha = rs.innerGlow.alpha;
    ctx.lineWidth = rs.innerGlow.width * r;
    ctx.beginPath();
    ctx.arc(px, py, rs.innerGlow.radius * r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = rs.alpha;
  }

  // Specular highlight.
  const spg = ctx.createRadialGradient(
    px + rs.specular.dx * r,
    py + rs.specular.dy * r,
    0,
    px + rs.specular.dx * r,
    py + rs.specular.dy * r,
    rs.specular.r * r,
  );
  spg.addColorStop(0, `rgba(255,255,255,${rs.specular.alpha})`);
  spg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spg;
  ctx.beginPath();
  ctx.arc(px + rs.specular.dx * r, py + rs.specular.dy * r, rs.specular.r * r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export { getMarble };
