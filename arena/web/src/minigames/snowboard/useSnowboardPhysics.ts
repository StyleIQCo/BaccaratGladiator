// ═══════════════════════════════════════════════════════════════════
//  SNOQUALMIE NIGHT SHRED — physics core.
//
//  Top-down night snowboarding: the camera auto-scrolls downhill, so
//  every entity spawns at y = canvas.height and rides UP the screen.
//  The rider holds a fixed screen row near the top (maximum look-ahead
//  down the slope). This hook owns the ENTIRE simulation — the spawner,
//  carve inertia, slalom scoring, wipeouts, airtime, and the 45-second
//  clock down to the lodge.
//
//  Performance contract (same rules as useHotdogPhysics):
//    • Every per-frame value lives in a ref. React renders exactly
//      twice per run: canvas mount, and game over via onGameOver.
//    • step() allocates nothing except event score popups. Dead
//      entities are compacted in place — no .filter() garbage at
//      60–120 fps on a warm phone.
//    • All motion is dt-based (px/sec): a 120 Hz ProMotion iPhone and
//      a throttled 30 fps Android carve the identical mountain.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';

// ── Types ──────────────────────────────────────────────────────────

/** What the rider is doing. Distinct from the run's GameStatus. */
export type RiderStatus = 'carving' | 'airborne' | 'wiped_out';
export type GameStatus = 'idle' | 'running' | 'over';
export type EntityKind = 'gate' | 'tree' | 'rock' | 'ramp';
/** Fired the frame something happens — renderer/SFX hang off these
 *  without any React state involved. */
export type ShredEvent = 'gate' | 'gate_missed' | 'wipeout' | 'ramp' | 'land';

export interface TrailEntity {
  kind: EntityKind;
  x: number;        // centre; for gates, the centre of the GAP
  y: number;        // centre; scrolls upward every frame
  gapW: number;     // gates only — clear width between the poles
  seed: number;     // stable per-entity jitter for the renderer
  scored: boolean;  // gate resolved / ramp already launched
  dead: boolean;    // culled off the top; compacted at end of step()
}

export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;   // seconds alive
  ttl: number;   // seconds until removed
}

/** Handed to onGameOver — the results screen shows this math verbatim. */
export interface RunSummary {
  baseScore: number;   // chips banked during the run
  maxCombo: number;    // best slalom streak (≥ 1 for the multiply)
  totalChips: number;  // baseScore × maxCombo — the payoff
  distanceM: number;   // vertical metres shredded, for flavour
  wipeouts: number;
}

export interface SnowboardPhysicsOptions {
  runSeconds?: number;                       // default 45
  onGameOver?: (summary: RunSummary) => void;
  onEvent?: (ev: ShredEvent, combo: number) => void;
}

// ── Tuning table ───────────────────────────────────────────────────
// Collision boxes are deliberately smaller than the art (drawn sizes
// live in the renderer) — near-misses should FEEL like near-misses.

export const ENTITY_STATS: Record<
  EntityKind,
  { weight: number; w: number; h: number }
> = {
  gate: { weight: 0.42, w: 150, h: 14 },   // w here = default gap, poles are non-solid
  tree: { weight: 0.28, w: 30, h: 40 },
  rock: { weight: 0.14, w: 34, h: 24 },
  ramp: { weight: 0.16, w: 58, h: 34 },
};
const SPAWN_ORDER: EntityKind[] = ['gate', 'tree', 'rock', 'ramp'];

export const RUN_SECONDS_DEFAULT = 45;
export const PLAYER_W = 30;           // rider AABB (centre-based)
export const PLAYER_H = 42;
const PLAYER_Y_FRAC = 0.3;            // rider row — high on screen = long look-ahead
const EDGE_MARGIN = 30;               // trail walls

// Downhill speed: eased toward a cruise curve so wipeouts recover in
// seconds, not the whole run. cruise(t) ramps over the full 45 s.
const SPEED_START = 330;              // px/s scroll at t=0…
const SPEED_MAX = 620;                // …to this at the lodge
const RECOVER_RATE = 0.55;            // 1/s — pull toward cruise (post-wipeout rebuild)
export const MPH_PER_PX = 0.12;       // 330→~40 MPH, 620→~74 MPH on the gauge

// Carving: a soft spring toward the finger with light damping — the
// board GLIDES through the target like an edge on ice instead of
// snapping to it. Low damping = the overshoot IS the carve feel.
const STEER_ACCEL = 26;               // (px/s²) per px of error
const CARVE_DAMPING = 3.2;            // 1/s exponential velocity bleed
const AIR_STEER_MULT = 0.4;           // reduced authority mid-360
const TUMBLE_STEER_MULT = 0.15;       // barely any authority while ragdolling
const MAX_VX = 560;                   // px/s sideways cap

// Slalom gates.
const GATE_CHIPS = 100;               // award = base × current combo
const GATE_GAP_START = 150;           // px between poles at t=0…
const GATE_GAP_END = 118;             // …tightening by the lodge

// Hazards.
const WIPEOUT_PENALTY = 500;
const WIPEOUT_SPEED_MULT = 0.35;      // speed cliff on impact
const WIPEOUT_TUMBLE = 0.9;           // seconds of no-control ragdoll
const INVULN_SECONDS = 2.0;           // flashing i-frames from impact

// Kicker ramps.
const AIR_SECONDS = 1.5;              // one full 360 in the renderer
const AIR_BONUS = 1000;               // "SICK AIR"
const LAND_GRACE = 0.3;               // silent i-frames on touchdown — landing
                                      // inside a tree you never saw isn't a skill issue

// Spawner: distance-based, not time-based — faster riding = denser
// mountain, which is the correct difficulty curve for a downhill.
const SPAWN_GAP_START = 300;          // px of slope between spawn beats at t=0…
const SPAWN_GAP_END = 210;            // …by the final stretch
const MAX_ENTITIES = 48;              // hard cap — spawner skips a beat, never floods
const CULL_Y = -90;                   // fully off the top edge
const METERS_PER_PX = 0.08;

const POPUP_TTL = 0.9;
const POPUP_RISE = 70;                // px/s

/** Single source of truth for the rider's screen row — renderer and
 *  collision share it. */
export function getPlayerY(canvasH: number): number {
  return canvasH * PLAYER_Y_FRAC;
}

/** Centre-based AABB overlap. */
function aabb(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
}

function rollKind(): EntityKind {
  let r = Math.random();
  for (const kind of SPAWN_ORDER) {
    r -= ENTITY_STATS[kind].weight;
    if (r <= 0) return kind;
  }
  return 'gate';
}

// ── The hook ───────────────────────────────────────────────────────

export interface SnowboardPhysics {
  // Refs the renderer reads every frame (never trigger React renders):
  playerXRef: MutableRefObject<number>;
  playerVxRef: MutableRefObject<number>;     // drives board tilt + carve hiss volume
  speedRef: MutableRefObject<number>;        // px/s downhill scroll
  speedFracRef: MutableRefObject<number>;    // 0–1 of SPEED_MAX, for gauges/wind
  riderRef: MutableRefObject<RiderStatus>;
  statusRef: MutableRefObject<GameStatus>;
  entitiesRef: MutableRefObject<TrailEntity[]>;
  popupsRef: MutableRefObject<ScorePopup[]>;
  scoreRef: MutableRefObject<number>;        // base chips (pre-multiplier payoff)
  comboRef: MutableRefObject<number>;
  maxComboRef: MutableRefObject<number>;
  timeLeftRef: MutableRefObject<number>;     // seconds, clamped ≥ 0
  airFracRef: MutableRefObject<number>;      // 0→1 through the jump; drives the 360
  invulnRef: MutableRefObject<number>;       // seconds of flashing i-frames left
  wipeFlashRef: MutableRefObject<number>;    // 1 → 0 after impact; red screen flash
  shakeRef: MutableRefObject<number>;        // seconds of screen shake remaining
  gatePulseRef: MutableRefObject<number>;    // 1 → 0 after a clean gate; combo bounce
  // Imperative API for the canvas component:
  start: (canvasW: number) => void;
  step: (dt: number, canvasW: number, canvasH: number) => void;
  setPointerX: (x: number) => void;
  endRun: () => void;
}

export function useSnowboardPhysics(opts: SnowboardPhysicsOptions = {}): SnowboardPhysics {
  // Latest-ref pattern: callers can pass inline closures without
  // destabilising the loop — we read the freshest values at runtime.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const playerXRef = useRef(0);
  const playerVxRef = useRef(0);
  const pointerXRef = useRef(0);
  const speedRef = useRef(SPEED_START);
  const speedFracRef = useRef(0);
  const riderRef = useRef<RiderStatus>('carving');
  const statusRef = useRef<GameStatus>('idle');
  const entitiesRef = useRef<TrailEntity[]>([]);
  const popupsRef = useRef<ScorePopup[]>([]);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const timeLeftRef = useRef(RUN_SECONDS_DEFAULT);
  const elapsedRef = useRef(0);
  const distanceRef = useRef(0);      // px of slope covered
  const spawnDistRef = useRef(0);     // px of slope until the next spawn beat
  const airLeftRef = useRef(0);
  const airFracRef = useRef(0);
  const tumbleLeftRef = useRef(0);
  const invulnRef = useRef(0);
  const graceRef = useRef(0);         // landing i-frames — no flash, unlike invuln
  const wipeoutsRef = useRef(0);
  const wipeFlashRef = useRef(0);
  const shakeRef = useRef(0);
  const gatePulseRef = useRef(0);

  const endRun = useCallback(() => {
    if (statusRef.current !== 'running') return;
    statusRef.current = 'over';
    const baseScore = scoreRef.current;
    const maxCombo = Math.max(maxComboRef.current, 1);
    optsRef.current.onGameOver?.({
      baseScore,
      maxCombo,
      totalChips: baseScore * maxCombo,
      distanceM: Math.round(distanceRef.current * METERS_PER_PX),
      wipeouts: wipeoutsRef.current,
    });
  }, []);

  const start = useCallback((canvasW: number) => {
    entitiesRef.current.length = 0;
    popupsRef.current.length = 0;
    scoreRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    elapsedRef.current = 0;
    distanceRef.current = 0;
    spawnDistRef.current = 260;         // one breath of open snow before the first gate
    timeLeftRef.current = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    speedRef.current = SPEED_START;
    speedFracRef.current = SPEED_START / SPEED_MAX;
    playerXRef.current = canvasW / 2;
    playerVxRef.current = 0;
    pointerXRef.current = canvasW / 2;
    riderRef.current = 'carving';
    airLeftRef.current = 0;
    airFracRef.current = 0;
    tumbleLeftRef.current = 0;
    invulnRef.current = 0;
    graceRef.current = 0;
    wipeoutsRef.current = 0;
    wipeFlashRef.current = 0;
    shakeRef.current = 0;
    gatePulseRef.current = 0;
    statusRef.current = 'running';
  }, []);

  const setPointerX = useCallback((x: number) => {
    pointerXRef.current = x;
  }, []);

  const spawn = useCallback((canvasW: number, canvasH: number, progress: number) => {
    const entities = entitiesRef.current;
    if (entities.length >= MAX_ENTITIES) return;

    const kind = rollKind();
    const y0 = canvasH + 50;            // fully below the bottom edge

    if (kind === 'gate') {
      const gapW = GATE_GAP_START + (GATE_GAP_END - GATE_GAP_START) * progress;
      const lo = EDGE_MARGIN + gapW / 2 + 14;
      const hi = canvasW - EDGE_MARGIN - gapW / 2 - 14;
      entities.push({
        kind, gapW,
        x: lo + Math.random() * Math.max(hi - lo, 1),
        y: y0, seed: Math.random() * 1000, scored: false, dead: false,
      });
      return;
    }

    // Solids + ramps share flat placement; trees like company — a
    // rolled tree brings 0–2 friends staggered down-slope so the
    // forest reads as clumps, not a picket line.
    const count = kind === 'tree'
      ? 1 + (Math.random() < 0.45 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0)
      : 1;
    for (let i = 0; i < count && entities.length < MAX_ENTITIES; i++) {
      const st = ENTITY_STATS[kind];
      const lo = EDGE_MARGIN + st.w;
      const hi = canvasW - EDGE_MARGIN - st.w;
      entities.push({
        kind, gapW: 0,
        x: lo + Math.random() * Math.max(hi - lo, 1),
        y: y0 + i * (60 + Math.random() * 50),
        seed: Math.random() * 1000, scored: false, dead: false,
      });
    }
  }, []);

  const step = useCallback((dt: number, canvasW: number, canvasH: number) => {
    if (statusRef.current !== 'running') return;
    // Tab-switch / hitch protection: a background pause must not warp
    // the rider through half the mountain in one frame.
    dt = Math.min(dt, 0.05);

    // ── Clock ──
    const runSeconds = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    elapsedRef.current += dt;
    timeLeftRef.current = Math.max(0, runSeconds - elapsedRef.current);
    const progress = Math.min(elapsedRef.current / runSeconds, 1);

    // ── Downhill speed: ease toward the cruise curve ──
    // After a wipeout drops us to 35%, this pull rebuilds ~90% of the
    // deficit in about 4 seconds — punished, not parked.
    const cruise = SPEED_START + (SPEED_MAX - SPEED_START) * progress;
    speedRef.current += (cruise - speedRef.current) * Math.min(RECOVER_RATE * dt, 1);
    const speed = speedRef.current;
    speedFracRef.current = speed / SPEED_MAX;
    distanceRef.current += speed * dt;

    // ── Carving: spring + damping = ice glide, not finger-snap ──
    const rider = riderRef.current;
    const authority =
      rider === 'airborne' ? AIR_STEER_MULT :
      rider === 'wiped_out' ? TUMBLE_STEER_MULT : 1;
    const halfW = PLAYER_W / 2 + 4;
    const target = Math.min(Math.max(pointerXRef.current, halfW + EDGE_MARGIN), canvasW - halfW - EDGE_MARGIN);
    let vx = playerVxRef.current;
    vx += (target - playerXRef.current) * STEER_ACCEL * authority * dt;
    vx *= Math.exp(-CARVE_DAMPING * dt);
    vx = Math.min(Math.max(vx, -MAX_VX), MAX_VX);
    let px = playerXRef.current + vx * dt;
    if (px < halfW + EDGE_MARGIN) { px = halfW + EDGE_MARGIN; vx = 0; }        // trail wall:
    if (px > canvasW - halfW - EDGE_MARGIN) { px = canvasW - halfW - EDGE_MARGIN; vx = 0; } // kill, don't bounce
    playerXRef.current = px;
    playerVxRef.current = vx;

    // ── Rider state clocks ──
    if (rider === 'airborne') {
      airLeftRef.current -= dt;
      airFracRef.current = 1 - Math.max(airLeftRef.current, 0) / AIR_SECONDS;
      if (airLeftRef.current <= 0) {
        riderRef.current = 'carving';
        airFracRef.current = 0;
        graceRef.current = LAND_GRACE;
        optsRef.current.onEvent?.('land', comboRef.current);
      }
    } else if (rider === 'wiped_out') {
      tumbleLeftRef.current -= dt;
      if (tumbleLeftRef.current <= 0) riderRef.current = 'carving';
    }
    invulnRef.current = Math.max(0, invulnRef.current - dt);
    graceRef.current = Math.max(0, graceRef.current - dt);

    // ── Spawner: beats measured in slope distance, not seconds ──
    spawnDistRef.current -= speed * dt;
    const gap = SPAWN_GAP_START + (SPAWN_GAP_END - SPAWN_GAP_START) * progress;
    while (spawnDistRef.current <= 0) {
      spawn(canvasW, canvasH, progress);
      spawnDistRef.current += gap * (0.85 + Math.random() * 0.3); // ±15% jitter
    }

    // ── Entities: scroll up, resolve gates, collide solids ──
    const playerY = getPlayerY(canvasH);
    const protectedNow =
      riderRef.current === 'airborne' || invulnRef.current > 0 || graceRef.current > 0;
    const entities = entitiesRef.current;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      e.y -= speed * dt;
      if (e.y < CULL_Y) { e.dead = true; continue; }

      if (e.kind === 'gate') {
        // Resolve the frame the pole line crosses the rider's row.
        // Airborne still counts — flying a gate at 1.5× scale is style.
        if (!e.scored && e.y <= playerY) {
          e.scored = true;
          if (Math.abs(px - e.x) < e.gapW / 2 - PLAYER_W / 4) {
            comboRef.current += 1;
            maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
            const chips = GATE_CHIPS * comboRef.current;
            scoreRef.current += chips;
            gatePulseRef.current = 1;
            popupsRef.current.push({
              x: e.x, y: playerY - 20,
              text: comboRef.current > 1 ? `+${chips} ${comboRef.current}x!` : `+${chips}`,
              color: '#ffe066', age: 0, ttl: POPUP_TTL,
            });
            optsRef.current.onEvent?.('gate', comboRef.current);
          } else if (comboRef.current > 0) {
            comboRef.current = 0;
            popupsRef.current.push({
              x: e.x, y: playerY - 20, text: 'GATE MISSED', color: '#8aa0c8', age: 0, ttl: POPUP_TTL,
            });
            optsRef.current.onEvent?.('gate_missed', 0);
          }
        }
        continue;
      }

      const st = ENTITY_STATS[e.kind];
      if (!aabb(px, playerY, PLAYER_W, PLAYER_H, e.x, e.y, st.w, st.h)) continue;

      if (e.kind === 'ramp') {
        // One launch per kicker; a tumbling rider slides over it inert.
        if (!e.scored && riderRef.current === 'carving') {
          e.scored = true;
          riderRef.current = 'airborne';
          airLeftRef.current = AIR_SECONDS;
          airFracRef.current = 0;
          scoreRef.current += AIR_BONUS;
          popupsRef.current.push({
            x: px, y: playerY - 34, text: `SICK AIR! +${AIR_BONUS}`, color: '#29e6ff', age: 0, ttl: POPUP_TTL + 0.3,
          });
          optsRef.current.onEvent?.('ramp', comboRef.current);
        }
      } else if (!protectedNow && invulnRef.current <= 0) {
        // Tree or rock — WIPEOUT. The obstacle stays standing (it won,
        // after all); i-frames stop it re-triggering while overlapped.
        // (The live invuln check matters: two clustered trees hitting in
        // the SAME frame must not double-charge the penalty.)
        riderRef.current = 'wiped_out';
        tumbleLeftRef.current = WIPEOUT_TUMBLE;
        invulnRef.current = INVULN_SECONDS;
        speedRef.current *= WIPEOUT_SPEED_MULT;
        playerVxRef.current *= 0.3;
        comboRef.current = 0;
        scoreRef.current = Math.max(0, scoreRef.current - WIPEOUT_PENALTY);
        wipeoutsRef.current += 1;
        wipeFlashRef.current = 1;
        shakeRef.current = 0.5;
        popupsRef.current.push({
          x: px, y: playerY - 34, text: `WIPEOUT! -${WIPEOUT_PENALTY}`, color: '#ff4d4d', age: 0, ttl: POPUP_TTL + 0.3,
        });
        optsRef.current.onEvent?.('wipeout', 0);
      }
    }

    // In-place compaction — zero garbage, order preserved.
    let write = 0;
    for (let i = 0; i < entities.length; i++) {
      if (!entities[i].dead) entities[write++] = entities[i];
    }
    entities.length = write;

    // ── Popups drift up and fade; same compaction trick ──
    const popups = popupsRef.current;
    for (let i = 0; i < popups.length; i++) {
      popups[i].age += dt;
      popups[i].y -= POPUP_RISE * dt;
    }
    write = 0;
    for (let i = 0; i < popups.length; i++) {
      if (popups[i].age < popups[i].ttl) popups[write++] = popups[i];
    }
    popups.length = write;

    // ── Juice decay ──
    wipeFlashRef.current = Math.max(0, wipeFlashRef.current - dt * 2.5);
    shakeRef.current = Math.max(0, shakeRef.current - dt);
    gatePulseRef.current = Math.max(0, gatePulseRef.current - dt * 3.5);

    if (timeLeftRef.current <= 0) endRun();   // the lodge!
  }, [spawn, endRun]);

  // Stable identity: the canvas mounts once and keeps this object for
  // the life of the run — no effect re-subscriptions mid-game.
  return useMemo<SnowboardPhysics>(() => ({
    playerXRef, playerVxRef, speedRef, speedFracRef, riderRef, statusRef,
    entitiesRef, popupsRef, scoreRef, comboRef, maxComboRef, timeLeftRef,
    airFracRef, invulnRef, wipeFlashRef, shakeRef, gatePulseRef,
    start, step, setPointerX, endRun,
  }), [start, step, setPointerX, endRun]);
}
