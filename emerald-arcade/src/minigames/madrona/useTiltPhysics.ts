// ═══════════════════════════════════════════════════════════════════
//  MADRONA WOOD LABYRINTH — physics core.
//
//  Tilt the carved board (touch-drag = tilt vector), roll the marble
//  from the start dimple to the emerald inlay before the clock dies.
//  Gems pay along the way; knot-holes swallow careless lines; cracked
//  barriers gate the loot routes — and only the Iron Heavy-Ball
//  carrying real momentum can put a marble THROUGH one.
//
//  This hook owns the ENTIRE simulation: tilt smoothing, marble
//  integration under the active marble's traits (a = force / mass,
//  restitution on every wall kiss, per-marble speed cap and rolling
//  drag), circle-vs-rect maze collisions, destructible-barrier energy
//  checks, knot-hole falls, gem pickups, the goal, and the run clock.
//
//  Same performance contract as useBaristaPhysics (the template for
//  every arcade cabinet here):
//    • Every per-frame value lives in a ref. React renders exactly
//      twice per run: canvas mount, and game over via onGameOver.
//    • step() allocates nothing on the steady path — barrier breaks
//      (rare) splice an array; that's the only mutation of shape.
//    • All motion is dt-based — the shared useArcadeEngine feeds this
//      a fixed 1/60 s step, but the hook stays correct at any dt.
//
//  Coordinates: BOARD-UNIT space — the maze is a MAZE_COLS×MAZE_ROWS
//  grid of 1-unit cells, +y down. The canvas layer owns the
//  pixel↔unit conversion; this hook never sees a pixel.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { DEFAULT_MARBLE_ID, getMarble, type MarbleId, type MarbleSpec } from './marbleData';

// ── Types ──────────────────────────────────────────────────────────

export type GameStatus = 'idle' | 'running' | 'over';

export interface Vec {
  x: number;
  y: number;
}

export interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DestructibleBarrier extends WallRect {
  id: number;
  /** Barriers are one-hit today; the field exists so a future maze can
   *  ship multi-hit planks without touching the collision code. */
  health: number;
  /** 1 → 0 wobble after a bounced (non-breaking) hit — renderer juice. */
  pulse: number;
}

export interface HoleSpec extends Vec {}

export interface GemSpec extends Vec {
  taken: boolean;
}

export interface RunResult {
  score: number;
  gems: number;
  gemsTotal: number;
  smashed: number;
  falls: number;
  /** true = reached the emerald; false = the clock died first. */
  finished: boolean;
  timeLeft: number;
}

export interface TiltPhysicsOptions {
  runSeconds?: number; // default 60
  onGameOver?: (result: RunResult) => void;
  /** Marble met a regular wall. impact = closing speed along the normal. */
  onWallHit?: (marbleId: MarbleId, impact: number) => void;
  /** Marble bounced off a barrier WITHOUT breaking it. */
  onBarrierHit?: (impact: number) => void;
  /** The Iron ball just put its momentum through a barrier. */
  onBarrierBreak?: (barrier: DestructibleBarrier, vx: number, vy: number) => void;
  onGem?: (collected: number, total: number) => void;
  /** Rolled over a knot-hole — the fall animation is starting. */
  onFall?: () => void;
  /** Back at the start dimple after a fall (penalty already applied). */
  onRespawn?: () => void;
  onGoal?: (bonusChips: number) => void;
  onMarbleChange?: (spec: MarbleSpec) => void;
  /** Fired once at 5,4,3,2,1 seconds on the run clock. */
  onCountdownTick?: (secondsLeft: number) => void;
  /** Low-rate (4 Hz) HUD feed for the wrapper's DOM chrome. */
  onHudTick?: (timeLeft: number, score: number, gems: number) => void;
}

// ── Tuning table ───────────────────────────────────────────────────

export const RUN_SECONDS_DEFAULT = 60;

export const MARBLE_R = 0.3; // corridor is 1 unit wide — hug room is 0.2

/** Full tilt on the steel marble ≈ 20 u/s² — everything else follows
 *  from mass: iron crawls at ~9, glass snaps at ~36. */
const TILT_FORCE = 20;
const TILT_EASE = 9; // 1/s — board answers the finger fast but not raw

/** KE = ½·m·v² must clear this for a breaker to shatter a barrier.
 *  Iron (m 2.2) crosses it at ~2.7 u/s — about half its top speed.
 *  Glass at TERMINAL velocity carries ~23 KE but breakPower 0 keeps it
 *  bouncing: the gate is the marble, not the math. */
export const BARRIER_BREAK_KE = 8;
/** Plowing through keeps this much of the marble's velocity. */
const PLOW_KEEP = 0.6;

const FALL_R = 0.17; // centre-to-centre swallow radius (visual is wider)
const FALL_ANIM_SEC = 0.55;
const FALL_PENALTY_SEC = 3;

const GEM_PICKUP_R = 0.42;
const GOAL_TRIGGER_R = 0.45;

export const GEM_CHIPS = 250;
export const SMASH_CHIPS = 150;
export const TIME_BONUS_PER_SEC = 100;

/** Wall-hit callbacks only fire above this closing speed… */
const MIN_HIT_IMPACT = 1.1;
/** …and at most once per this many seconds (dense corner rattles). */
const HIT_THROTTLE_SEC = 0.07;

// ── The board ──────────────────────────────────────────────────────
//
//  '#' wall · '.' floor · 'S' start · 'G' goal (the emerald inlay)
//  'D' cracked destructible barrier · 'o' knot-hole · '*' gem
//
//  Route notes (keep true when editing!):
//    • Steel/Glass have a legal line: top corridor → right column →
//      skirt the (6,6) knot-hole → goal. 3 of 5 gems reachable.
//    • D(4,4) gates the centre column from the top; D(3,9) seals the
//      bottom-left pocket. Both pockets (gems at 4,5 and 3,10) pay
//      only for Iron — smash bonuses on top.
//    • Every knot-hole sits in a 1-wide corridor: hug room is
//      0.5 − MARBLE_R = 0.2 > FALL_R, so a careful line survives.
const MAZE = [
  '#########',
  '#S..#*..#',
  '#.#.#.#.#',
  '#.#...#*#',
  '#.##D##.#',
  '#.o#*#..#',
  '##.#.#o##',
  '#*.#.#..#',
  '#.##.##.#',
  '#..D..#.#',
  '#.#*#..G#',
  '#########',
];

export const MAZE_COLS = MAZE[0].length; // 9
export const MAZE_ROWS = MAZE.length; // 12

interface CompiledMaze {
  walls: WallRect[];
  barriers: Omit<DestructibleBarrier, 'pulse'>[];
  holes: HoleSpec[];
  gems: Vec[];
  start: Vec;
  goal: Vec;
}

function compileMaze(): CompiledMaze {
  const walls: WallRect[] = [];
  const barriers: Omit<DestructibleBarrier, 'pulse'>[] = [];
  const holes: HoleSpec[] = [];
  const gems: Vec[] = [];
  let start: Vec = { x: 1.5, y: 1.5 };
  let goal: Vec = { x: MAZE_COLS - 1.5, y: MAZE_ROWS - 1.5 };
  let barrierId = 0;

  for (let r = 0; r < MAZE_ROWS; r++) {
    const row = MAZE[r];
    for (let c = 0; c < MAZE_COLS; c++) {
      const ch = row[c];
      const cx = c + 0.5;
      const cy = r + 0.5;
      if (ch === '#') {
        // Merge horizontal runs into one rect — fewer collision checks,
        // and the renderer bevels a clean single plank.
        const last = walls[walls.length - 1];
        if (last && last.y === r && last.x + last.w === c && last.h === 1) last.w += 1;
        else walls.push({ x: c, y: r, w: 1, h: 1 });
      } else if (ch === 'D') {
        barriers.push({ id: barrierId++, x: c, y: r, w: 1, h: 1, health: 1 });
      } else if (ch === 'o') {
        holes.push({ x: cx, y: cy });
      } else if (ch === '*') {
        gems.push({ x: cx, y: cy });
      } else if (ch === 'S') {
        start = { x: cx, y: cy };
      } else if (ch === 'G') {
        goal = { x: cx, y: cy };
      }
    }
  }
  return { walls, barriers, holes, gems, start, goal };
}

const COMPILED = compileMaze();

/** Static geometry, exported for the renderer (and the smoke test). */
export const MAZE_WALLS: readonly WallRect[] = COMPILED.walls;
export const MAZE_HOLES: readonly HoleSpec[] = COMPILED.holes;
export const MAZE_START: Vec = COMPILED.start;
export const MAZE_GOAL: Vec = COMPILED.goal;
export const GEMS_TOTAL = COMPILED.gems.length;

// ── The hook ───────────────────────────────────────────────────────

export interface TiltPhysics {
  // Refs the renderer reads every frame (never trigger React renders):
  statusRef: MutableRefObject<GameStatus>;
  pausedRef: MutableRefObject<boolean>;
  timeLeftRef: MutableRefObject<number>;
  scoreRef: MutableRefObject<number>;
  gemsCountRef: MutableRefObject<number>;
  smashedRef: MutableRefObject<number>;
  marbleRef: MutableRefObject<MarbleSpec>;
  posRef: MutableRefObject<Vec>;
  velRef: MutableRefObject<Vec>;
  /** Accumulated rolling spin (radians) — drives the pitted/sheen tex. */
  rotRef: MutableRefObject<number>;
  /** Smoothed board tilt, −1…1 per axis — renderer parallax reads it. */
  tiltRef: MutableRefObject<Vec>;
  /** LIVE barrier list — broken planks are spliced out (collision box
   *  and all), so the renderer draws exactly what still blocks. */
  barriersRef: MutableRefObject<DestructibleBarrier[]>;
  gemsListRef: MutableRefObject<GemSpec[]>;
  /** 0 = rolling; >0 = fall-into-hole progress toward 1. */
  fallingRef: MutableRefObject<number>;
  fallHoleRef: MutableRefObject<HoleSpec | null>;
  respawnFlashRef: MutableRefObject<number>; // 1 → 0 after a respawn
  goalPulseRef: MutableRefObject<number>; // 1 → 0 after the emerald sinks
  shakeRef: MutableRefObject<number>; // seconds of camera shake remaining
  finishedRef: MutableRefObject<boolean>;
  // Imperative API for the canvas component:
  start: () => void;
  step: (dt: number) => void;
  /** Target board tilt, each axis clamped to −1…1. */
  setTilt: (tx: number, ty: number) => void;
  /** Swap the active marble (mid-run allowed — speed re-capped). */
  setMarble: (id: MarbleId) => void;
  setPaused: (paused: boolean) => void;
}

export function useTiltPhysics(opts: TiltPhysicsOptions = {}): TiltPhysics {
  // Latest-ref pattern: callers can pass inline closures without
  // destabilising the loop — we read the freshest values at runtime.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const statusRef = useRef<GameStatus>('idle');
  const pausedRef = useRef(false);
  const timeLeftRef = useRef(RUN_SECONDS_DEFAULT);
  const scoreRef = useRef(0);
  const gemsCountRef = useRef(0);
  const smashedRef = useRef(0);
  const marbleRef = useRef<MarbleSpec>(getMarble(DEFAULT_MARBLE_ID));
  const posRef = useRef<Vec>({ ...COMPILED.start });
  const velRef = useRef<Vec>({ x: 0, y: 0 });
  const rotRef = useRef(0);
  const tiltRef = useRef<Vec>({ x: 0, y: 0 });
  const barriersRef = useRef<DestructibleBarrier[]>([]);
  const gemsListRef = useRef<GemSpec[]>([]);
  const fallingRef = useRef(0);
  const fallHoleRef = useRef<HoleSpec | null>(null);
  const respawnFlashRef = useRef(0);
  const goalPulseRef = useRef(0);
  const shakeRef = useRef(0);
  const finishedRef = useRef(false);

  // Internal (not exposed — the renderer has no business here):
  const tiltTargetRef = useRef<Vec>({ x: 0, y: 0 });
  const elapsedRef = useRef(0);
  const fallsRef = useRef(0);
  const lastTickSecRef = useRef(-1);
  const hudAccRef = useRef(0);
  const hitCooldownRef = useRef(0);

  const endRun = useCallback((finished: boolean) => {
    if (statusRef.current !== 'running') return;
    statusRef.current = 'over';
    finishedRef.current = finished;
    optsRef.current.onGameOver?.({
      score: scoreRef.current,
      gems: gemsCountRef.current,
      gemsTotal: GEMS_TOTAL,
      smashed: smashedRef.current,
      falls: fallsRef.current,
      finished,
      timeLeft: timeLeftRef.current,
    });
  }, []);

  const start = useCallback(() => {
    statusRef.current = 'running';
    pausedRef.current = false;
    elapsedRef.current = 0;
    timeLeftRef.current = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    scoreRef.current = 0;
    gemsCountRef.current = 0;
    smashedRef.current = 0;
    fallsRef.current = 0;
    posRef.current = { ...COMPILED.start };
    velRef.current = { x: 0, y: 0 };
    rotRef.current = 0;
    tiltRef.current = { x: 0, y: 0 };
    tiltTargetRef.current = { x: 0, y: 0 };
    barriersRef.current = COMPILED.barriers.map((b) => ({ ...b, pulse: 0 }));
    gemsListRef.current = COMPILED.gems.map((g) => ({ ...g, taken: false }));
    fallingRef.current = 0;
    fallHoleRef.current = null;
    respawnFlashRef.current = 0;
    goalPulseRef.current = 0;
    shakeRef.current = 0;
    finishedRef.current = false;
    lastTickSecRef.current = -1;
    hudAccRef.current = 0;
    hitCooldownRef.current = 0;
  }, []);

  const setTilt = useCallback((tx: number, ty: number) => {
    tiltTargetRef.current.x = Math.max(-1, Math.min(1, tx));
    tiltTargetRef.current.y = Math.max(-1, Math.min(1, ty));
  }, []);

  const setMarble = useCallback((id: MarbleId) => {
    if (marbleRef.current.id === id) return;
    const spec = getMarble(id);
    marbleRef.current = spec;
    // Mid-run swap: momentum carries over but honors the new cap.
    const v = velRef.current;
    const sp = Math.hypot(v.x, v.y);
    if (sp > spec.maxSpeed) {
      const k = spec.maxSpeed / sp;
      v.x *= k;
      v.y *= k;
    }
    optsRef.current.onMarbleChange?.(spec);
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
  }, []);

  /** Resolve the marble against one rect. Returns the closing speed
   *  along the contact normal (0 = no contact / already separating). */
  const collideRect = useCallback((rect: WallRect, restitution: number): number => {
    const pos = posRef.current;
    const vel = velRef.current;
    const cx = Math.max(rect.x, Math.min(pos.x, rect.x + rect.w));
    const cy = Math.max(rect.y, Math.min(pos.y, rect.y + rect.h));
    let nx = pos.x - cx;
    let ny = pos.y - cy;
    const d2 = nx * nx + ny * ny;
    if (d2 >= MARBLE_R * MARBLE_R) return 0;

    let pen: number;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      nx /= d;
      ny /= d;
      pen = MARBLE_R - d;
    } else {
      // Centre inside the rect (deep overlap) — eject along the
      // shallowest face so a bad frame never traps the marble.
      const left = pos.x - rect.x;
      const right = rect.x + rect.w - pos.x;
      const top = pos.y - rect.y;
      const bottom = rect.y + rect.h - pos.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) (nx = -1), (ny = 0);
      else if (m === right) (nx = 1), (ny = 0);
      else if (m === top) (nx = 0), (ny = -1);
      else (nx = 0), (ny = 1);
      pen = m + MARBLE_R;
    }
    pos.x += nx * pen;
    pos.y += ny * pen;
    const vn = vel.x * nx + vel.y * ny;
    if (vn >= 0) return 0; // grazing exit — no bounce, no sound
    vel.x -= (1 + restitution) * vn * nx;
    vel.y -= (1 + restitution) * vn * ny;
    return -vn;
  }, []);

  const respawn = useCallback(() => {
    posRef.current = { ...COMPILED.start };
    velRef.current = { x: 0, y: 0 };
    fallingRef.current = 0;
    fallHoleRef.current = null;
    respawnFlashRef.current = 1;
    optsRef.current.onRespawn?.();
  }, []);

  const step = useCallback(
    (dt: number) => {
      if (statusRef.current !== 'running' || pausedRef.current) return;
      // The engine feeds fixed 1/60 steps, but stay hitch-safe anyway.
      dt = Math.min(dt, 0.05);

      // ── Run clock ──
      const runSeconds = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
      elapsedRef.current += dt;
      timeLeftRef.current = Math.max(0, runSeconds - elapsedRef.current);

      const wholeSec = Math.ceil(timeLeftRef.current);
      if (wholeSec <= 5 && wholeSec >= 1 && wholeSec !== lastTickSecRef.current) {
        lastTickSecRef.current = wholeSec;
        optsRef.current.onCountdownTick?.(wholeSec);
      }
      hudAccRef.current += dt;
      if (hudAccRef.current >= 0.25) {
        hudAccRef.current = 0;
        optsRef.current.onHudTick?.(timeLeftRef.current, scoreRef.current, gemsCountRef.current);
      }

      // ── Juice decay ──
      respawnFlashRef.current = Math.max(0, respawnFlashRef.current - dt * 2.5);
      goalPulseRef.current = Math.max(0, goalPulseRef.current - dt * 1.5);
      shakeRef.current = Math.max(0, shakeRef.current - dt);
      hitCooldownRef.current = Math.max(0, hitCooldownRef.current - dt);
      const barriers = barriersRef.current;
      for (let i = 0; i < barriers.length; i++) {
        barriers[i].pulse = Math.max(0, barriers[i].pulse - dt * 4);
      }

      // ── Board tilt eases toward the finger ──
      const tilt = tiltRef.current;
      const target = tiltTargetRef.current;
      const ease = 1 - Math.exp(-TILT_EASE * dt);
      tilt.x += (target.x - tilt.x) * ease;
      tilt.y += (target.y - tilt.y) * ease;

      // ── Falling into a knot-hole: the sim narrows to the animation ──
      if (fallingRef.current > 0) {
        fallingRef.current += dt / FALL_ANIM_SEC;
        const hole = fallHoleRef.current;
        if (hole) {
          // The marble spirals down onto the hole centre as it shrinks.
          const pull = 1 - Math.exp(-10 * dt);
          posRef.current.x += (hole.x - posRef.current.x) * pull;
          posRef.current.y += (hole.y - posRef.current.y) * pull;
        }
        if (fallingRef.current >= 1) {
          elapsedRef.current += FALL_PENALTY_SEC; // the hole eats clock, not chips
          respawn();
        }
        if (timeLeftRef.current <= 0) endRun(false);
        return;
      }

      // ── Marble integration under the active marble's traits ──
      const m = marbleRef.current;
      const pos = posRef.current;
      const vel = velRef.current;

      // a = force / mass — iron crawls, glass snaps.
      vel.x += ((TILT_FORCE * tilt.x) / m.mass) * dt;
      vel.y += ((TILT_FORCE * tilt.y) / m.mass) * dt;

      // Rolling drag: glass stops on a dime, iron coasts on inertia.
      const drag = Math.exp(-m.rollFriction * dt);
      vel.x *= drag;
      vel.y *= drag;

      // Per-marble top-speed cap.
      const sp = Math.hypot(vel.x, vel.y);
      if (sp > m.maxSpeed) {
        const k = m.maxSpeed / sp;
        vel.x *= k;
        vel.y *= k;
      }

      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      rotRef.current += (Math.hypot(vel.x, vel.y) / MARBLE_R) * dt * 0.5;

      // ── Destructible barriers (checked BEFORE the bounce resolves) ──
      for (let i = barriers.length - 1; i >= 0; i--) {
        const b = barriers[i];
        const cx = Math.max(b.x, Math.min(pos.x, b.x + b.w));
        const cy = Math.max(b.y, Math.min(pos.y, b.y + b.h));
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        if (dx * dx + dy * dy >= MARBLE_R * MARBLE_R) continue;

        const ke = 0.5 * m.mass * (vel.x * vel.x + vel.y * vel.y);
        if (m.breakPower > 0 && ke > BARRIER_BREAK_KE) {
          // SHATTER: the collision box dies with the plank, and the
          // marble plows through keeping 60% of its velocity.
          barriers.splice(i, 1);
          vel.x *= PLOW_KEEP;
          vel.y *= PLOW_KEEP;
          smashedRef.current += 1;
          scoreRef.current += SMASH_CHIPS;
          shakeRef.current = 0.2;
          optsRef.current.onBarrierBreak?.(b, vel.x, vel.y);
        } else {
          const impact = collideRect(b, m.restitution);
          if (impact > MIN_HIT_IMPACT && hitCooldownRef.current <= 0) {
            hitCooldownRef.current = HIT_THROTTLE_SEC;
            b.pulse = 1;
            optsRef.current.onBarrierHit?.(impact);
          }
        }
      }

      // ── Maze walls ──
      const walls = MAZE_WALLS;
      for (let i = 0; i < walls.length; i++) {
        const impact = collideRect(walls[i], m.restitution);
        if (impact > MIN_HIT_IMPACT && hitCooldownRef.current <= 0) {
          hitCooldownRef.current = HIT_THROTTLE_SEC;
          optsRef.current.onWallHit?.(m.id, impact);
        }
      }

      // ── Gems ──
      const gems = gemsListRef.current;
      for (let i = 0; i < gems.length; i++) {
        const g = gems[i];
        if (g.taken) continue;
        const dx = pos.x - g.x;
        const dy = pos.y - g.y;
        if (dx * dx + dy * dy < GEM_PICKUP_R * GEM_PICKUP_R) {
          g.taken = true;
          gemsCountRef.current += 1;
          scoreRef.current += GEM_CHIPS;
          optsRef.current.onGem?.(gemsCountRef.current, GEMS_TOTAL);
        }
      }

      // ── Knot-holes ──
      const holes = MAZE_HOLES;
      for (let i = 0; i < holes.length; i++) {
        const dx = pos.x - holes[i].x;
        const dy = pos.y - holes[i].y;
        if (dx * dx + dy * dy < FALL_R * FALL_R) {
          fallingRef.current = 0.0001; // enter the fall animation
          fallHoleRef.current = holes[i];
          fallsRef.current += 1;
          optsRef.current.onFall?.();
          break;
        }
      }

      // ── The emerald ──
      if (fallingRef.current === 0) {
        const dx = pos.x - COMPILED.goal.x;
        const dy = pos.y - COMPILED.goal.y;
        if (dx * dx + dy * dy < GOAL_TRIGGER_R * GOAL_TRIGGER_R) {
          const bonus = Math.ceil(timeLeftRef.current) * TIME_BONUS_PER_SEC;
          scoreRef.current += bonus;
          goalPulseRef.current = 1;
          optsRef.current.onGoal?.(bonus);
          endRun(true);
          return;
        }
      }

      // ── Closing time ──
      if (timeLeftRef.current <= 0) endRun(false);
    },
    [collideRect, respawn, endRun],
  );

  // Stable identity: the canvas mounts once and keeps this object for
  // the life of the run — no effect re-subscriptions mid-game.
  return useMemo<TiltPhysics>(
    () => ({
      statusRef,
      pausedRef,
      timeLeftRef,
      scoreRef,
      gemsCountRef,
      smashedRef,
      marbleRef,
      posRef,
      velRef,
      rotRef,
      tiltRef,
      barriersRef,
      gemsListRef,
      fallingRef,
      fallHoleRef,
      respawnFlashRef,
      goalPulseRef,
      shakeRef,
      finishedRef,
      start,
      step,
      setTilt,
      setMarble,
      setPaused,
    }),
    [start, step, setTilt, setMarble, setPaused],
  );
}
