'use client';

// ═══════════════════════════════════════════════════════════════════
//  EMERALD CITY CLAW — physics core.
//
//  Emerald City Arcade cabinet: a 2D side-view claw machine stocked
//  with Seattle souvenirs. Four tokens; each token is one full claw
//  cycle: aim on the X axis → DROP → the cable lowers → the prongs
//  close → retract → carry to the chute → release. Whether the prize
//  survives the trip is where the game lives.
//
//  This hook owns the ENTIRE simulation:
//    • A compact rigid-body solver (circle bodies, impulse collision
//      response, friction, restitution, positional correction and a
//      sleep system so the pile settles dead still). No matter-js —
//      the arcade module ships zero dependencies by design, and a
//      dozen circles don't need a full engine.
//    • The claw state machine: idle → dropping → grabbing →
//      retracting → transporting → releasing (→ idle | over).
//    • The grip model: each item defines a grab APERTURE (how far
//      off its center of mass the prongs may land and still enclose
//      it) and a KEEP curve (chance the grip survives each stress
//      event as a function of grab quality). Heavy items (the Troll)
//      have brutal curves — a sloppy grab WILL slip on the retract
//      jolt. Slippery items (the Orb) also shrink the aperture.
//    • Stress events: one jolt when the cable tops out, one bump at
//      the halfway point of the carry. Each rolls against the keep
//      probability; a failed roll releases the joint mid-air.
//    • Chute detection: any body — released by the claw OR knocked
//      loose into the hole — whose center crosses the chute sensor
//      AABB pays out and leaves the world.
//
//  Same performance contract as useBaristaPhysics (the cabinet
//  template): every per-frame value lives in a ref, step() allocates
//  nothing but prize log entries, all motion is dt-based (the shared
//  useArcadeEngine feeds a fixed 1/60 s step). React renders are
//  driven only by the coarse callbacks (phase changes, prizes, HUD
//  at 4 Hz) — never by the sim.
//
//  Coordinates: the whole sim runs in a fixed 400×560 WORLD space
//  (y down). The canvas layer owns the world↔pixel fit transform;
//  this hook never sees a pixel.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

// ── World geometry (canvas draws from these too) ───────────────────

export const WORLD_W = 400;
export const WORLD_H = 560;
export const RAIL_Y = 70; // trolley rail centerline
export const FLOOR_Y = 468; // pit floor (glass cabinet bottom)
export const WALL_L = 26; // interior glass walls
export const WALL_R = 374;
export const CHUTE_WALL_X = 104; // divider between the chute and the pit
export const CHUTE_WALL_TOP = 404; // items must clear this to knock in
export const CHUTE_HOME_X = 64; // trolley park position over the chute
export const CLAW_NECK = 18; // rail centerline → palm at zero cable
export const PALM_R = 15; // claw palm hitbox radius
export const TROLLEY_MIN = 44;
export const TROLLEY_MAX = WALL_R - 24;
const CHUTE_SENSOR_Y = FLOOR_Y + 26; // fall past this inside the chute = paid

// ── Tuning table ───────────────────────────────────────────────────

export const RUN_TOKENS_DEFAULT = 4;

const G = 920; // gravity, world units/s²
const TROLLEY_VMAX = 150;
const TROLLEY_ACCEL = 620;
const TRANSPORT_VMAX = 125; // slower with a prize swinging underneath
const DROP_SPEED = 175; // cable extend rate
const RETRACT_SPEED = 120; // cable retract rate (÷ mass drag when loaded)
const GRAB_CLOSE_S = 0.45; // prong close time
const RELEASE_OPEN_S = 0.4; // prong open time over the chute
const IMPACT_SETTLE_S = 0.12; // clunk → prongs start closing
const GRAB_LINGER_S = 0.18; // closed prongs hold the pose before lifting
const MAX_PALM_Y = FLOOR_Y - 5;

// Pile solver.
const SOLVER_ITERS = 3;
const CORR_PERCENT = 0.6; // positional correction strength
const CORR_SLOP = 0.4; // penetration allowance before correcting
const SLEEP_SPEED2 = 30; // (units/s)² below which a grounded body drowses
const SLEEP_AFTER_S = 0.45;
const WAKE_SPEED = 42; // an approaching body faster than this wakes sleepers

// Hold-joint swing (the prize pendulums under the palm during the carry).
const SWING_K = 58;
const SWING_C = 6.5;
const SWING_MAX = 14;

// ── Item catalogue ─────────────────────────────────────────────────

export type ClawRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type ClawItemType =
  | 'rainier-can'
  | 'flying-salmon'
  | 'kraken-plush'
  | 'space-needle'
  | 'fremont-troll'
  | 'chihuly-orb';

export interface ClawItemDef {
  type: ClawItemType;
  name: string;
  rarity: ClawRarity;
  chips: number;
  /** Emoji used on the DOM prize card (canvas draws real vector art). */
  glyph: string;
  /** One-liner for the prize card. */
  blurb: string;
  r: number; // collision radius, world units
  density: number; // mass = density · r² (normalized to the can)
  friction: number; // pile contact friction (plush grips, glass skates)
  restitution: number;
  /**
   * Fraction of (r + prong reach) the grab center may be off the item's
   * center of mass and still enclose it. Spheres and slick fish shrink it.
   */
  apertureFactor: number;
  /** Chance to survive ONE stress event at a perfect center grab… */
  keepPerfect: number;
  /** …and at the very edge of the aperture. */
  keepEdge: number;
  /**
   * Exponent shaping keep between those ends: q^curve. High = punishing
   * (top-heavy or dense items demand near-perfect center-of-mass grabs).
   */
  gripCurve: number;
  /** How many of these are seeded into the pile. */
  count: number;
}

export const CLAW_ITEMS: ClawItemDef[] = [
  {
    type: 'rainier-can',
    name: 'Rainier Tallboy',
    rarity: 'common',
    chips: 250,
    glyph: '🍺',
    blurb: 'Vitamin R. A cylinder that practically asks to be gripped.',
    r: 13,
    density: 1.0,
    friction: 0.45,
    restitution: 0.18,
    apertureFactor: 0.95,
    keepPerfect: 0.995,
    keepEdge: 0.72,
    gripCurve: 1.0,
    count: 3,
  },
  {
    type: 'flying-salmon',
    name: 'Pike Place Flying Salmon',
    rarity: 'uncommon',
    chips: 500,
    glyph: '🐟',
    blurb: 'Fresh off the throw and slick as the low tide. Expect wriggling.',
    r: 15,
    density: 1.0,
    friction: 0.12,
    restitution: 0.3,
    apertureFactor: 0.62,
    keepPerfect: 0.93,
    keepEdge: 0.2,
    gripCurve: 1.4,
    count: 2,
  },
  {
    type: 'kraken-plush',
    name: 'Seattle Kraken Plush',
    rarity: 'uncommon',
    chips: 750,
    glyph: '🐙',
    blurb: 'Release the (squishable) Kraken. The plush fur grips the prongs back.',
    r: 17,
    density: 0.55,
    friction: 0.85,
    restitution: 0.12,
    apertureFactor: 1.0,
    keepPerfect: 0.985,
    keepEdge: 0.55,
    gripCurve: 0.8,
    count: 2,
  },
  {
    type: 'space-needle',
    name: 'Space Needle Miniature',
    rarity: 'rare',
    chips: 1500,
    glyph: '🗼',
    blurb: '605 feet of Seattle in six inches of die-cast. All the weight is in the saucer.',
    r: 14,
    density: 1.15,
    friction: 0.5,
    restitution: 0.22,
    apertureFactor: 0.7,
    keepPerfect: 0.9,
    keepEdge: 0.15,
    gripCurve: 2.0,
    count: 2,
  },
  {
    type: 'fremont-troll',
    name: 'Fremont Troll Statue',
    rarity: 'epic',
    chips: 5000,
    glyph: '🗿',
    blurb: 'Solid cast stone, VW Beetle included. The claw motor files a complaint.',
    r: 19,
    density: 2.6,
    friction: 0.7,
    restitution: 0.06,
    apertureFactor: 0.8,
    keepPerfect: 0.86,
    keepEdge: 0.04,
    gripCurve: 2.3,
    count: 1,
  },
  {
    type: 'chihuly-orb',
    name: 'Chihuly Glass Orb',
    rarity: 'legendary',
    chips: 10000,
    glyph: '🔮',
    blurb: 'Hand-blown, museum-grade, utterly frictionless. The white whale of the cabinet.',
    r: 15,
    density: 1.4,
    friction: 0.04,
    restitution: 0.4,
    apertureFactor: 0.55,
    keepPerfect: 0.88,
    keepEdge: 0.08,
    gripCurve: 1.8,
    count: 1,
  },
];

export const RARITY_META: Record<ClawRarity, { label: string; color: string }> = {
  common: { label: 'COMMON', color: '#b8c4d4' },
  uncommon: { label: 'UNCOMMON', color: '#7dff9b' },
  rare: { label: 'RARE', color: '#5eb8ff' },
  epic: { label: 'EPIC', color: '#b56bff' },
  legendary: { label: 'LEGENDARY', color: '#ffd75e' },
};

// ── Sim state ──────────────────────────────────────────────────────

export type ClawPhase =
  | 'idle'
  | 'dropping'
  | 'grabbing'
  | 'retracting'
  | 'transporting'
  | 'releasing'
  | 'over';

export interface ClawBody {
  id: number;
  def: ClawItemDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angVel: number;
  r: number;
  invMass: number;
  sleepT: number;
  asleep: boolean;
  grounded: boolean;
  /** Set when the prongs open over the chute — distinguishes knock-ins. */
  releasedOverChute: boolean;
}

export interface ClawHold {
  body: ClawBody;
  /** Grab quality 0..1 — 1 = dead-center on the center of mass. */
  q: number;
  relX: number; // pendulum offset under the palm
  relVX: number;
  hang: number; // palm → item-center hang distance
}

export interface ClawPrize {
  type: ClawItemType;
  name: string;
  rarity: ClawRarity;
  chips: number;
  glyph: string;
  blurb: string;
  /** True when the item tumbled in without being carried — a lucky knock. */
  knockIn: boolean;
}

export interface ClawSim {
  phase: ClawPhase;
  phaseT: number;
  trolleyX: number;
  trolleyV: number;
  dir: -1 | 0 | 1;
  aimX: number | null;
  cableLen: number;
  prongClose: number; // 0 fully open → 1 fully closed
  held: ClawHold | null;
  bodies: ClawBody[];
  tokensLeft: number;
  chips: number;
  prizes: ClawPrize[];
  motorTrolley: boolean;
  motorCable: boolean;
}

export type MotorKind = 'trolley' | 'cable';

export interface ClawPhysicsOptions {
  tokens?: number; // default RUN_TOKENS_DEFAULT
  /** Deterministic pile + slip rolls; omit for a fresh machine each run. */
  seed?: number;
  onPhaseChange?: (phase: ClawPhase) => void;
  /** The claw head hit the pile (or floor). strength 0..1 for juice scale. */
  onImpact?: (strength: number) => void;
  /** Prongs finished closing. hit=false means they closed on air. */
  onGrab?: (hit: boolean, type?: ClawItemType, quality?: number) => void;
  /** The grip failed a stress roll — the prize is falling. */
  onSlip?: (type: ClawItemType) => void;
  onPrize?: (prize: ClawPrize) => void;
  /** A servo spun up or down — drive the motor loop SFX from this. */
  onMotor?: (kind: MotorKind, on: boolean) => void;
  /** DROP was refused (claw parked over the chute, or no tokens). */
  onDeny?: () => void;
  /** 4 Hz + on every token/chip change. */
  onHudTick?: (tokensLeft: number, chips: number) => void;
  onGameOver?: (chips: number, prizes: ClawPrize[]) => void;
}

export interface ClawPhysicsApi {
  simRef: MutableRefObject<ClawSim>;
  /** Advance one fixed step — call from the engine's update(). */
  step: (dt: number) => void;
  /** Directional motor input (buttons / arrow keys). Overrides aim. */
  setDir: (dir: -1 | 0 | 1) => void;
  /** Touch-drag steering: ease the trolley toward a world X. Idle only. */
  aimAt: (worldX: number) => void;
  clearAim: () => void;
  /** Spend a token and start the drop cycle. No-op outside idle. */
  drop: () => void;
}

// ── Small deterministic PRNG (pile layout + slip rolls) ────────────

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

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ── Body factory + pile seeding ────────────────────────────────────

function makeBody(id: number, def: ClawItemDef, x: number, y: number): ClawBody {
  const mass = def.density * (def.r * def.r) / (13 * 13); // can ≈ mass 1
  return {
    id,
    def,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    angVel: 0,
    r: def.r,
    invMass: 1 / mass,
    sleepT: 0,
    asleep: false,
    grounded: false,
    releasedOverChute: false,
  };
}

function seedPile(rng: () => number): ClawBody[] {
  const bodies: ClawBody[] = [];
  // Interleave types so heavies aren't all buried at one end.
  const bag: ClawItemDef[] = [];
  for (const def of CLAW_ITEMS) for (let i = 0; i < def.count; i++) bag.push(def);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const lo = CHUTE_WALL_X + 34;
  const hi = WALL_R - 34;
  bag.forEach((def, i) => {
    const x = lo + rng() * (hi - lo);
    const y = FLOOR_Y - 24 - Math.floor(i / 4) * 42 - rng() * 16;
    const b = makeBody(i + 1, def, x, y);
    b.angle = (rng() - 0.5) * 0.9;
    bodies.push(b);
  });
  return bodies;
}

// ═══════════════════════════════════════════════════════════════════
//  The hook
// ═══════════════════════════════════════════════════════════════════

export function useClawPhysics(options: ClawPhysicsOptions = {}): ClawPhysicsApi {
  // Fresh closures every render, zero engine restarts (engine convention).
  const optRef = useRef(options);
  optRef.current = options;

  const rngRef = useRef<() => number>(() => Math.random());
  const simRef = useRef<ClawSim>(null as unknown as ClawSim);
  const hudAccRef = useRef(0);
  const flagsRef = useRef({
    nudged: false, // prong shove fired this grab
    grabbed: false, // grab evaluated this cycle
    midRolled: false, // transport stress roll fired
    jolted: false, // top-of-retract jolt fired
    overFired: false,
    transportFrom: 0,
  });

  // Build the machine once per mount: seed the pile, then pre-settle it
  // so play starts on a dead-still heap instead of a souvenir avalanche.
  if (simRef.current === null) {
    const seed = optRef.current.seed;
    rngRef.current = mulberry32(seed === undefined ? (Math.random() * 2 ** 31) | 0 : seed);
    const sim: ClawSim = {
      phase: 'idle',
      phaseT: 0,
      trolleyX: (CHUTE_WALL_X + WALL_R) / 2,
      trolleyV: 0,
      dir: 0,
      aimX: null,
      cableLen: 0,
      prongClose: 0,
      held: null,
      bodies: seedPile(rngRef.current),
      tokensLeft: optRef.current.tokens ?? RUN_TOKENS_DEFAULT,
      chips: 0,
      prizes: [],
      motorTrolley: false,
      motorCable: false,
    };
    simRef.current = sim;
    for (let i = 0; i < 180; i++) stepBodies(sim, 1 / 60, null);
    for (const b of sim.bodies) {
      b.vx = 0;
      b.vy = 0;
      b.angVel = 0;
      b.asleep = true;
    }
  }

  // ── Physics internals ────────────────────────────────────────────

  function wake(b: ClawBody) {
    b.asleep = false;
    b.sleepT = 0;
  }

  /**
   * Integrate + collide the free bodies. `palm` is the claw head as a
   * kinematic obstacle while it's down among the pile (null otherwise);
   * returns true if the palm touched anything this step.
   */
  function stepBodies(
    sim: ClawSim,
    dt: number,
    palm: { x: number; y: number; vy: number } | null,
  ): boolean {
    const heldBody = sim.held?.body ?? null;
    let palmTouched = false;

    // Integrate.
    for (const b of sim.bodies) {
      if (b === heldBody || b.asleep) continue;
      b.vy += G * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += b.angVel * dt;
      b.angVel *= 0.985;
      b.grounded = false;
    }

    // Iterative pair + bounds resolution.
    for (let iter = 0; iter < SOLVER_ITERS; iter++) {
      for (let i = 0; i < sim.bodies.length; i++) {
        const a = sim.bodies[i];
        if (a === heldBody) continue;
        for (let j = i + 1; j < sim.bodies.length; j++) {
          const b = sim.bodies[j];
          if (b === heldBody) continue;
          if (a.asleep && b.asleep) continue;
          resolvePair(a, b);
        }
      }
      for (const b of sim.bodies) {
        if (b === heldBody || b.asleep) continue;
        resolveBounds(b);
      }
      if (palm) {
        for (const b of sim.bodies) {
          if (b === heldBody) continue;
          if (resolvePalm(b, palm)) palmTouched = true;
        }
      }
    }

    // Sleep bookkeeping: grounded and slow for a while → freeze solid.
    for (const b of sim.bodies) {
      if (b === heldBody || b.asleep) continue;
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (b.grounded && sp2 < SLEEP_SPEED2) {
        b.sleepT += dt;
        if (b.sleepT > SLEEP_AFTER_S) {
          b.asleep = true;
          b.vx = 0;
          b.vy = 0;
          b.angVel = 0;
        }
      } else {
        b.sleepT = 0;
      }
    }
    return palmTouched;
  }

  function resolvePair(a: ClawBody, b: ClawBody) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const min = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 === 0) return;

    // A fast mover plowing into a sleeper wakes it before we resolve.
    if (a.asleep && Math.hypot(b.vx, b.vy) > WAKE_SPEED) wake(a);
    if (b.asleep && Math.hypot(a.vx, a.vy) > WAKE_SPEED) wake(b);

    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const imA = a.asleep ? 0 : a.invMass;
    const imB = b.asleep ? 0 : b.invMass;
    const imSum = imA + imB;
    if (imSum === 0) return;

    const corr = (Math.max(min - d - CORR_SLOP, 0) * CORR_PERCENT) / imSum;
    a.x -= nx * corr * imA;
    a.y -= ny * corr * imA;
    b.x += nx * corr * imB;
    b.y += ny * corr * imB;

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;
    const e = (a.def.restitution + b.def.restitution) * 0.5;
    const jn = (-(1 + e) * vn) / imSum;
    a.vx -= jn * nx * imA;
    a.vy -= jn * ny * imA;
    b.vx += jn * nx * imB;
    b.vy += jn * ny * imB;

    // Coulomb friction along the tangent, clamped to μ·jn.
    const tx = -ny;
    const ty = nx;
    const vt = rvx * tx + rvy * ty;
    const mu = (a.def.friction + b.def.friction) * 0.5;
    const jt = clamp(-vt / imSum, -mu * jn, mu * jn);
    a.vx -= jt * tx * imA;
    a.vy -= jt * ty * imA;
    b.vx += jt * tx * imB;
    b.vy += jt * ty * imB;

    // Anything resting on something is "grounded enough" to drowse.
    if (ny > 0.5) b.grounded = true;
    if (ny < -0.5) a.grounded = true;
  }

  function resolveBounds(b: ClawBody) {
    // Side glass.
    if (b.x - b.r < WALL_L) {
      b.x = WALL_L + b.r;
      if (b.vx < 0) b.vx = -b.vx * b.def.restitution;
    } else if (b.x + b.r > WALL_R) {
      b.x = WALL_R - b.r;
      if (b.vx > 0) b.vx = -b.vx * b.def.restitution;
    }

    // Pit floor — only where there IS floor. Centers left of the divider
    // are over the chute hole and keep falling.
    if (b.x >= CHUTE_WALL_X && b.y + b.r > FLOOR_Y) {
      b.y = FLOOR_Y - b.r;
      if (b.vy > 0) b.vy = Math.abs(b.vy) < 26 ? 0 : -b.vy * b.def.restitution;
      b.vx *= Math.max(0, 1 - b.def.friction * 5 * (1 / 60));
      b.angVel = b.vx / b.r; // roll, don't skate
      b.grounded = true;
    }

    // Chute divider: a capsule from the wall top down past the floor.
    // Circle-vs-segment keeps pit items from rolling into the hole while
    // letting lifted (or lucky) items pass above the wall top.
    const segTop = CHUTE_WALL_TOP;
    const segBot = FLOOR_Y + 60;
    if (b.y + b.r > segTop - 2 && Math.abs(b.x - CHUTE_WALL_X) < b.r + 6) {
      const cy = clamp(b.y, segTop, segBot);
      const dx = b.x - CHUTE_WALL_X;
      const dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      const min = b.r + 3; // wall half-thickness
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        let nx = dx / d;
        const ny = dy / d;
        // Perched dead-center on the wall top is unstable in real life
        // too — bias the tumble toward whichever side it leans.
        if (Math.abs(ny) > 0.94) nx += b.x >= CHUTE_WALL_X ? 0.2 : -0.2;
        b.x += nx * (min - d);
        b.y += ny * (min - d);
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= (1 + b.def.restitution) * vn * nx;
          b.vy -= (1 + b.def.restitution) * vn * ny;
        }
      }
    }
  }

  /** The claw head shoves the pile around while it's down there. */
  function resolvePalm(b: ClawBody, palm: { x: number; y: number; vy: number }): boolean {
    const dx = b.x - palm.x;
    const dy = b.y - palm.y;
    const min = b.r + PALM_R - 2;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 === 0) return false;
    wake(b);
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    b.x += nx * (min - d);
    b.y += ny * (min - d);
    // Kinematic push: give the item the palm's descent along the normal.
    const vn = b.vx * nx + b.vy * ny - palm.vy * ny;
    if (vn < 0) {
      b.vx -= vn * nx;
      b.vy -= vn * ny;
    }
    return true;
  }

  // ── Claw cycle helpers ───────────────────────────────────────────

  function setPhase(sim: ClawSim, phase: ClawPhase) {
    sim.phase = phase;
    sim.phaseT = 0;
    optRef.current.onPhaseChange?.(phase);
  }

  function setMotor(sim: ClawSim, kind: MotorKind, on: boolean) {
    const key = kind === 'trolley' ? 'motorTrolley' : 'motorCable';
    if (sim[key] === on) return;
    sim[key] = on;
    optRef.current.onMotor?.(kind, on);
  }

  function palmY(sim: ClawSim): number {
    return RAIL_Y + CLAW_NECK + sim.cableLen;
  }

  function fireHud(sim: ClawSim) {
    optRef.current.onHudTick?.(sim.tokensLeft, sim.chips);
  }

  /** keep = P(grip survives one stress event) for this grab quality. */
  function keepChance(def: ClawItemDef, q: number): number {
    return def.keepEdge + (def.keepPerfect - def.keepEdge) * Math.pow(clamp(q, 0, 1), def.gripCurve);
  }

  function slipRoll(sim: ClawSim, softer: boolean) {
    const held = sim.held;
    if (!held) return;
    let p = keepChance(held.body.def, held.q);
    if (softer) p = Math.sqrt(p); // the carry bump is gentler than the jolt
    if (rngRef.current() <= p) return;
    // The grip fails: the prize drops out of the prongs mid-air.
    const b = held.body;
    b.vx = sim.trolleyV * 0.6 + held.relVX;
    b.vy = 30;
    wake(b);
    sim.held = null;
    optRef.current.onSlip?.(b.def.type);
  }

  function releaseHeld(sim: ClawSim, overChute: boolean) {
    const held = sim.held;
    if (!held) return;
    const b = held.body;
    b.vx = sim.trolleyV + held.relVX;
    b.vy = 20;
    b.releasedOverChute = overChute;
    wake(b);
    sim.held = null;
  }

  function evaluateGrab(sim: ClawSim) {
    const px = sim.trolleyX;
    const py = palmY(sim);
    let best: ClawBody | null = null;
    let bestDist = Infinity;
    for (const b of sim.bodies) {
      const dx = Math.abs(b.x - px);
      const dy = b.y - py;
      const reach = b.def.apertureFactor * (b.r + 9);
      // The item must sit under the palm, inside the closed prong cage.
      if (dy < -6 || dy > b.r + PALM_R + 8) continue;
      if (dx > reach) continue;
      const dist = Math.hypot(dx, dy - b.r * 0.4);
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    if (!best) {
      optRef.current.onGrab?.(false);
      return;
    }
    const reach = best.def.apertureFactor * (best.r + 9);
    const q = 1 - Math.abs(best.x - px) / reach;
    wake(best);
    // Waking the neighbors: the pile shifts when a piece is pulled out.
    for (const n of sim.bodies) {
      if (n !== best && Math.hypot(n.x - best.x, n.y - best.y) < best.r + n.r + 8) wake(n);
    }
    best.vx = 0;
    best.vy = 0;
    best.angVel = 0;
    sim.held = {
      body: best,
      q: clamp(q, 0, 1),
      relX: best.x - px,
      relVX: 0,
      hang: best.r * 0.55 + 7,
    };
    optRef.current.onGrab?.(true, best.def.type, sim.held.q);
  }

  /** Prongs at half-close plow through neighbors that aren't the target. */
  function prongShove(sim: ClawSim) {
    const px = sim.trolleyX;
    const py = palmY(sim);
    for (const b of sim.bodies) {
      const dx = b.x - px;
      const dy = b.y - py;
      const range = b.r + 20;
      if (Math.abs(dx) > range || dy < -10 || dy > range + 8) continue;
      wake(b);
      const s = 1 - Math.abs(dx) / range;
      b.vx += (dx >= 0 ? 1 : -1) * 30 * s;
      b.vy -= 10 * s;
    }
  }

  function checkChute(sim: ClawSim) {
    for (let i = sim.bodies.length - 1; i >= 0; i--) {
      const b = sim.bodies[i];
      if (sim.held?.body === b) continue;
      if (b.x < CHUTE_WALL_X && b.y > CHUTE_SENSOR_Y) {
        sim.bodies[i] = sim.bodies[sim.bodies.length - 1];
        sim.bodies.pop();
        const prize: ClawPrize = {
          type: b.def.type,
          name: b.def.name,
          rarity: b.def.rarity,
          chips: b.def.chips,
          glyph: b.def.glyph,
          blurb: b.def.blurb,
          knockIn: !b.releasedOverChute,
        };
        sim.chips += prize.chips;
        sim.prizes.push(prize);
        optRef.current.onPrize?.(prize);
        fireHud(sim);
      }
    }
  }

  // ── The claw state machine ───────────────────────────────────────

  function stepClaw(sim: ClawSim, dt: number): { x: number; y: number; vy: number } | null {
    const flags = flagsRef.current;
    sim.phaseT += dt;
    let palm: { x: number; y: number; vy: number } | null = null;

    switch (sim.phase) {
      case 'idle': {
        // Directional motor, or ease toward the touch-drag aim point.
        let targetV = sim.dir * TROLLEY_VMAX;
        if (sim.dir === 0 && sim.aimX !== null) {
          const dx = sim.aimX - sim.trolleyX;
          targetV = clamp(dx * 6, -TROLLEY_VMAX, TROLLEY_VMAX);
          if (Math.abs(dx) < 1.5) targetV = 0;
        }
        const dv = clamp(targetV - sim.trolleyV, -TROLLEY_ACCEL * dt, TROLLEY_ACCEL * dt);
        sim.trolleyV += dv;
        sim.trolleyX = clamp(sim.trolleyX + sim.trolleyV * dt, TROLLEY_MIN, TROLLEY_MAX);
        if (sim.trolleyX === TROLLEY_MIN || sim.trolleyX === TROLLEY_MAX) sim.trolleyV = 0;
        setMotor(sim, 'trolley', Math.abs(sim.trolleyV) > 6);
        break;
      }

      case 'dropping': {
        sim.trolleyV = 0;
        sim.cableLen += DROP_SPEED * dt;
        const py = palmY(sim);
        palm = { x: sim.trolleyX, y: py, vy: DROP_SPEED };
        const hitFloor = py >= Math.min(MAX_PALM_Y, FLOOR_Y - 5);
        if (hitFloor) sim.cableLen = Math.min(MAX_PALM_Y, FLOOR_Y - 5) - RAIL_Y - CLAW_NECK;
        // Contact with the pile is detected by stepBodies (palm shove);
        // stepClaw is told through flags.palmTouched set below in step().
        if (hitFloor) {
          optRef.current.onImpact?.(0.7);
          setPhase(sim, 'grabbing');
          flags.nudged = false;
          flags.grabbed = false;
        }
        break;
      }

      case 'grabbing': {
        palm = { x: sim.trolleyX, y: palmY(sim), vy: 0 };
        if (sim.phaseT < IMPACT_SETTLE_S) break;
        sim.prongClose = clamp(sim.prongClose + dt / GRAB_CLOSE_S, 0, 1);
        if (!flags.nudged && sim.prongClose >= 0.5) {
          flags.nudged = true;
          prongShove(sim);
        }
        if (!flags.grabbed && sim.prongClose >= 1) {
          flags.grabbed = true;
          evaluateGrab(sim);
        }
        if (flags.grabbed && sim.phaseT >= IMPACT_SETTLE_S + GRAB_CLOSE_S + GRAB_LINGER_S) {
          setPhase(sim, 'retracting');
          flags.jolted = false;
        }
        break;
      }

      case 'retracting': {
        // A heavy prize drags the winch.
        const drag = sim.held ? 1 / (1 + (1 / sim.held.body.invMass) * 0.06) : 1;
        sim.cableLen = Math.max(0, sim.cableLen - RETRACT_SPEED * drag * dt);
        if (sim.cableLen === 0 && !flags.jolted) {
          // The cable tops out with a mechanical JOLT — the classic
          // heartbreak moment. One hard stress roll.
          flags.jolted = true;
          optRef.current.onImpact?.(0.35);
          slipRoll(sim, false);
        }
        if (sim.cableLen === 0 && sim.phaseT > 0.15) {
          setPhase(sim, 'transporting');
          flags.midRolled = false;
          flags.transportFrom = sim.trolleyX;
        }
        break;
      }

      case 'transporting': {
        const dx = CHUTE_HOME_X - sim.trolleyX;
        const targetV = clamp(dx * 5, -TRANSPORT_VMAX, TRANSPORT_VMAX);
        const dv = clamp(targetV - sim.trolleyV, -TROLLEY_ACCEL * dt, TROLLEY_ACCEL * dt);
        sim.trolleyV += dv;
        sim.trolleyX += sim.trolleyV * dt;
        setMotor(sim, 'trolley', true);
        const mid = (flagsRef.current.transportFrom + CHUTE_HOME_X) / 2;
        if (!flags.midRolled && sim.trolleyX <= mid) {
          // The carriage rattles crossing the rail joint — softer roll.
          flags.midRolled = true;
          slipRoll(sim, true);
        }
        if (Math.abs(dx) < 2) {
          sim.trolleyX = CHUTE_HOME_X;
          sim.trolleyV = 0;
          setMotor(sim, 'trolley', false);
          setPhase(sim, 'releasing');
        }
        break;
      }

      case 'releasing': {
        sim.prongClose = clamp(sim.prongClose - dt / RELEASE_OPEN_S, 0, 1);
        if (sim.held && sim.prongClose <= 0.5) releaseHeld(sim, true);
        if (sim.prongClose <= 0) {
          if (sim.tokensLeft > 0) {
            setPhase(sim, 'idle');
          } else {
            setPhase(sim, 'over');
            flags.overFired = false;
          }
        }
        break;
      }

      case 'over': {
        // Give the last release time to tumble through the chute sensor
        // before declaring the final haul.
        if (!flags.overFired && sim.phaseT > 1.4) {
          flags.overFired = true;
          optRef.current.onGameOver?.(sim.chips, sim.prizes.slice());
        }
        break;
      }
    }

    setMotor(sim, 'cable', sim.phase === 'dropping' || sim.phase === 'retracting');

    // Pendulum the held prize under the palm.
    const held = sim.held;
    if (held) {
      held.relVX += (-SWING_K * held.relX - SWING_C * held.relVX) * dt;
      // Trolley acceleration swings the load (visible on transport start).
      held.relVX -= sim.trolleyV * dt * 1.6;
      held.relX = clamp(held.relX + held.relVX * dt, -SWING_MAX, SWING_MAX);
      const b = held.body;
      b.x = sim.trolleyX + held.relX;
      b.y = palmY(sim) + held.hang;
      b.vx = sim.trolleyV + held.relVX;
      b.vy = 0;
      b.angle += (held.relX * 0.045 - b.angle) * Math.min(1, dt * 10);
    }

    return palm;
  }

  // ── Public API ───────────────────────────────────────────────────

  const step = useCallback((dt: number) => {
    const sim = simRef.current;
    const palm = stepClaw(sim, dt);
    const touched = stepBodies(sim, dt, palm);
    // First contact with the pile while dropping = the impact clunk.
    if (touched && sim.phase === 'dropping') {
      optRef.current.onImpact?.(Math.min(1, sim.cableLen / 260 + 0.35));
      setPhase(sim, 'grabbing');
      flagsRef.current.nudged = false;
      flagsRef.current.grabbed = false;
    }
    checkChute(sim);

    hudAccRef.current += dt;
    if (hudAccRef.current >= 0.25) {
      hudAccRef.current = 0;
      fireHud(sim);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDir = useCallback((dir: -1 | 0 | 1) => {
    const sim = simRef.current;
    sim.dir = dir;
    if (dir !== 0) sim.aimX = null;
  }, []);

  const aimAt = useCallback((worldX: number) => {
    const sim = simRef.current;
    if (sim.phase !== 'idle') return;
    sim.aimX = clamp(worldX, TROLLEY_MIN, TROLLEY_MAX);
  }, []);

  const clearAim = useCallback(() => {
    simRef.current.aimX = null;
  }, []);

  const drop = useCallback(() => {
    const sim = simRef.current;
    if (sim.phase !== 'idle') return;
    if (sim.tokensLeft <= 0 || sim.trolleyX <= CHUTE_WALL_X + 10) {
      // Parked over its own chute (or broke): the machine refuses.
      optRef.current.onDeny?.();
      return;
    }
    sim.tokensLeft -= 1;
    sim.dir = 0;
    sim.aimX = null;
    sim.trolleyV = 0;
    setMotor(sim, 'trolley', false);
    setPhase(sim, 'dropping');
    fireHud(sim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kill motor callbacks on unmount so loop SFX can't be left running.
  useEffect(() => {
    return () => {
      const sim = simRef.current;
      if (sim) {
        sim.motorTrolley = false;
        sim.motorCable = false;
      }
    };
  }, []);

  return { simRef, step, setDir, aimAt, clearAim, drop };
}
