// ═══════════════════════════════════════════════════════════════════
//  RAINIER SUMMIT SCRAMBLE — physics core.
//
//  Emerald City Arcade cabinet #3: a vertical endless climber. An
//  alpine mountain goat bounces up an ever-scrolling face of Mount
//  Rainier — icy ledges auto-launch it, the finger steers left/right,
//  falling seracs end the run, golden carabiners pay chips, and
//  surviving the full clock plants the flag on the summit.
//
//  This hook owns the ENTIRE simulation — the auto-scrolling camera,
//  procedural ledge field, goat ballistics, serac rain, carabiner
//  pickups, scoring, and the summit clock.
//
//  Same performance contract as useHotdogPhysics / useFishTossPhysics
//  (the template for every arcade cabinet here):
//    • Every per-frame value lives in a ref. React renders exactly
//      twice per run: canvas mount, and game over via onGameOver.
//    • step() allocates nothing except spawned entities and score
//      popups. Dead entities are compacted in place — no .filter()
//      garbage.
//    • All motion is dt-based (px/sec) — 120 Hz ProMotion and a
//      throttled 30 fps Android play the identical game.
//
//  Coordinates: world-space, +y down (canvas convention). The camera
//  is camYRef — the world y of the screen's TOP edge — and it only
//  ever DECREASES (the mountain scrolls up). screenY = worldY - camY.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type GameStatus = 'idle' | 'running' | 'over';
/** 'summit' = survived the clock, 'fell' = dropped off camera, 'hazard' = serac hit. */
export type GameOverReason = 'summit' | 'fell' | 'hazard';

export interface GoatState {
  x: number;    // centre, world px
  y: number;
  vx: number;   // px/s
  vy: number;   // px/s, gravity applies
}

export interface Ledge {
  x: number;      // centre
  y: number;      // TOP surface — the goat's feet land exactly here
  w: number;
  seed: number;   // stable jitter for icicles / cracks in the renderer
  dead: boolean;
}

export interface Serac {
  x: number;
  y: number;      // centre
  vx: number;
  vy: number;
  r: number;      // collision radius (the renderer builds its polygon from this)
  spin: number;   // radians, cosmetic tumble
  spinVel: number;
  seed: number;
  nearMissed: boolean; // one bleat per boulder, no matter how long it hangs around
  dead: boolean;
}

export interface Carabiner {
  x: number;
  y: number;      // rest height; renderer bobs it by phase
  phase: number;  // advances at BOB_HZ — shared by bob + glow pulse
  seed: number;
  dead: boolean;
}

export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;   // seconds alive
  ttl: number;   // seconds until removed
}

export interface RainierPhysicsOptions {
  runSeconds?: number;   // default 30 — the summit clock
  onGameOver?: (finalScore: number, reason: GameOverReason, altitudeM: number) => void;
  /** Fired the frame the goat's hooves hit a ledge (world coords) —
   *  the renderer hangs ice-chip FX and the crunch SFX off this
   *  without any React state involved. */
  onLand?: (x: number, y: number) => void;
  /** Fired when a carabiner is snagged (world coords) — clink + sparkles. */
  onCollect?: (x: number, y: number) => void;
  /** Fired once per serac that whistles past without connecting — the
   *  goat bleats in triumph. */
  onNearMiss?: () => void;
}

// ── Tuning table ───────────────────────────────────────────────────

export const RUN_SECONDS_DEFAULT = 30;
export const GOAT_W = 40;             // collision AABB — art hangs a little outside it
export const GOAT_H = 34;
export const LEDGE_H = 16;            // visual slab thickness (collision is the top line only)
export const CARABINER_R = 14;

export const CARABINER_CHIPS = 100;
export const SUMMIT_BONUS = 5_000;

// Altitude flavour: the run starts at Camp Muir and the display caps
// at Rainier's true summit. Purely cosmetic — 4 px of climb = 1 m.
export const BASE_ALT_M = 3_105;
export const SUMMIT_ALT_M = 4_392;
const PX_PER_M = 4;

const GRAVITY = 1180;                 // px/s²
const JUMP_VEL = 640;                 // px/s — apex ≈ 173 px, every gap below is reachable
const SCROLL_START = 55;              // px/s camera climb at t=0…
const SCROLL_END = 175;               // …ramping to this by the final second
const FOLLOW_FRAC = 0.32;             // goat above this screen line drags the camera up faster
const FALL_MARGIN = 70;               // px below the screen before the run ends

const STEER_GAIN = 6;                 // finger offset (px) → desired vx (px/s)
const MAX_VX = 430;
const STEER_EASE = 12;                // 1/s — how fast vx chases the desired value

const LEDGE_GAP_START = 84;           // vertical spacing ramps up with progress…
const LEDGE_GAP_END = 132;
const LEDGE_GAP_MAX = 150;            // …but never past what JUMP_VEL can clear
const LEDGE_W_START = 96;             // slabs shrink as the air thins
const LEDGE_W_END = 58;
const LEDGE_MARGIN = 26;              // keep slabs off the canyon walls
const SPAWN_AHEAD = 260;              // px of ledge field kept ready above the camera
const GC_BELOW = 80;                  // px below the screen before garbage collection
const CARABINER_CHANCE = 0.34;        // per spawned ledge

const SERAC_GRACE = 3.5;              // calm seconds before the icefall wakes up
const SERAC_GAP_START = 2.6;          // seconds between drops at t=0…
const SERAC_GAP_END = 1.15;           // …ramping to this
const SERAC_GRAVITY = 300;            // gentler than the goat's — arcs stay readable
const SERAC_VY_MAX = 520;             // terminal velocity
const MAX_SERACS = 8;
const NEAR_MISS_X = 84;               // horizontal closeness that earns a bleat

const POPUP_TTL = 0.8;
const POPUP_RISE = 70;                // px/s (world-space — rises with the mountain)

// ── The hook ───────────────────────────────────────────────────────

export interface RainierPhysics {
  // Refs the renderer reads every frame (never trigger React renders):
  goatRef: MutableRefObject<GoatState>;
  camYRef: MutableRefObject<number>;          // world y of the screen top — subtract to draw
  scrollSpeedRef: MutableRefObject<number>;   // current auto-scroll, px/s
  ledgesRef: MutableRefObject<Ledge[]>;
  seracsRef: MutableRefObject<Serac[]>;
  carabinersRef: MutableRefObject<Carabiner[]>;
  popupsRef: MutableRefObject<ScorePopup[]>;
  scoreRef: MutableRefObject<number>;         // chips
  collectedRef: MutableRefObject<number>;     // carabiners snagged — the "×N" stat
  altitudeRef: MutableRefObject<number>;      // metres, BASE_ALT_M → SUMMIT_ALT_M
  statusRef: MutableRefObject<GameStatus>;
  timeLeftRef: MutableRefObject<number>;      // seconds to the summit, clamped ≥ 0
  landPulseRef: MutableRefObject<number>;     // 1 → 0 after each bounce; drives squash
  collectPulseRef: MutableRefObject<number>;  // 1 → 0 after each carabiner; score bounce
  hazardFlashRef: MutableRefObject<number>;   // 1 → 0 after a serac hit; red flash
  shakeRef: MutableRefObject<number>;         // seconds of screen shake remaining
  // Imperative API for the canvas component:
  start: (canvasW: number, canvasH: number) => void;
  step: (dt: number, canvasW: number, canvasH: number) => void;
  setPointerX: (x: number) => void;
  endRun: (reason: GameOverReason) => void;
}

export function useRainierPhysics(opts: RainierPhysicsOptions = {}): RainierPhysics {
  // Latest-ref pattern: callers can pass inline closures without
  // destabilising the loop — we read the freshest values at runtime.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const goatRef = useRef<GoatState>({ x: 0, y: 0, vx: 0, vy: 0 });
  const camYRef = useRef(0);
  const scrollSpeedRef = useRef(SCROLL_START);
  const ledgesRef = useRef<Ledge[]>([]);
  const seracsRef = useRef<Serac[]>([]);
  const carabinersRef = useRef<Carabiner[]>([]);
  const popupsRef = useRef<ScorePopup[]>([]);
  const scoreRef = useRef(0);
  const collectedRef = useRef(0);
  const altitudeRef = useRef(BASE_ALT_M);
  const statusRef = useRef<GameStatus>('idle');
  const timeLeftRef = useRef(RUN_SECONDS_DEFAULT);
  const landPulseRef = useRef(0);
  const collectPulseRef = useRef(0);
  const hazardFlashRef = useRef(0);
  const shakeRef = useRef(0);

  const elapsedRef = useRef(0);
  const pointerXRef = useRef(0);
  const nextLedgeYRef = useRef(0);     // world y of the NEXT slab to generate (decreases)
  const seracClockRef = useRef(0);

  const endRun = useCallback((reason: GameOverReason) => {
    if (statusRef.current !== 'running') return;
    statusRef.current = 'over';
    optsRef.current.onGameOver?.(scoreRef.current, reason, Math.round(altitudeRef.current));
  }, []);

  /** One slab, plus maybe a carabiner floating on the jump line above it. */
  const spawnLedge = useCallback((canvasW: number, progress: number) => {
    const w = (LEDGE_W_START + (LEDGE_W_END - LEDGE_W_START) * progress) * (0.85 + Math.random() * 0.3);
    const x = LEDGE_MARGIN + w / 2 + Math.random() * (canvasW - 2 * LEDGE_MARGIN - w);
    const y = nextLedgeYRef.current;
    ledgesRef.current.push({ x, y, w, seed: Math.random() * 1000, dead: false });

    if (Math.random() < CARABINER_CHANCE) {
      carabinersRef.current.push({
        x: Math.min(Math.max(x + (Math.random() - 0.5) * 48, LEDGE_MARGIN), canvasW - LEDGE_MARGIN),
        y: y - 52 - Math.random() * 36,   // on the arc the bounce naturally traces
        phase: Math.random() * Math.PI * 2,
        seed: Math.random() * 1000,
        dead: false,
      });
    }

    const gap = Math.min(
      LEDGE_GAP_MAX,
      (LEDGE_GAP_START + (LEDGE_GAP_END - LEDGE_GAP_START) * progress) * (0.85 + Math.random() * 0.3),
    );
    nextLedgeYRef.current = y - gap;
  }, []);

  const start = useCallback((canvasW: number, canvasH: number) => {
    ledgesRef.current.length = 0;
    seracsRef.current.length = 0;
    carabinersRef.current.length = 0;
    popupsRef.current.length = 0;
    scoreRef.current = 0;
    collectedRef.current = 0;
    altitudeRef.current = BASE_ALT_M;
    elapsedRef.current = 0;
    timeLeftRef.current = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    landPulseRef.current = 0;
    collectPulseRef.current = 0;
    hazardFlashRef.current = 0;
    shakeRef.current = 0;
    scrollSpeedRef.current = SCROLL_START;
    camYRef.current = 0;
    seracClockRef.current = SERAC_GRACE;

    // Base camp: one generous slab under the goat, then the field above.
    const baseY = canvasH - 72;
    ledgesRef.current.push({ x: canvasW / 2, y: baseY, w: 150, seed: 0.5, dead: false });
    const goat = goatRef.current;
    goat.x = canvasW / 2;
    goat.y = baseY - GOAT_H / 2;
    goat.vx = 0;
    goat.vy = -JUMP_VEL;               // the run opens mid-leap — no dead first frame
    pointerXRef.current = canvasW / 2;

    nextLedgeYRef.current = baseY - LEDGE_GAP_START;
    while (nextLedgeYRef.current > camYRef.current - SPAWN_AHEAD) spawnLedge(canvasW, 0);

    statusRef.current = 'running';
  }, [spawnLedge]);

  const setPointerX = useCallback((x: number) => {
    pointerXRef.current = x;
  }, []);

  const step = useCallback((dt: number, canvasW: number, canvasH: number) => {
    if (statusRef.current !== 'running') return;
    // Tab-switch / hitch protection: a 3-second background pause must
    // not tunnel the goat through every ledge in one frame.
    dt = Math.min(dt, 0.05);

    // ── Clock ──
    const runSeconds = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    elapsedRef.current += dt;
    timeLeftRef.current = Math.max(0, runSeconds - elapsedRef.current);
    const progress = Math.min(elapsedRef.current / runSeconds, 1);

    // ── Camera: relentless auto-scroll, ramping with progress ──
    scrollSpeedRef.current = SCROLL_START + (SCROLL_END - SCROLL_START) * progress;
    camYRef.current -= scrollSpeedRef.current * dt;

    // ── Goat: finger steers vx, gravity owns vy ──
    const goat = goatRef.current;
    const desiredVx = Math.min(Math.max((pointerXRef.current - goat.x) * STEER_GAIN, -MAX_VX), MAX_VX);
    goat.vx += (desiredVx - goat.vx) * (1 - Math.exp(-STEER_EASE * dt));

    const prevFeet = goat.y + GOAT_H / 2;
    goat.vy += GRAVITY * dt;
    goat.x += goat.vx * dt;
    goat.y += goat.vy * dt;

    // Canyon walls: firm ice, no wraparound.
    const halfW = GOAT_W / 2;
    if (goat.x < halfW) { goat.x = halfW; goat.vx = 0; }
    else if (goat.x > canvasW - halfW) { goat.x = canvasW - halfW; goat.vx = 0; }

    // ── Landing: swept feet-vs-top test, auto-bounce ──
    if (goat.vy > 0) {
      const feet = goat.y + GOAT_H / 2;
      const ledges = ledgesRef.current;
      for (let i = 0; i < ledges.length; i++) {
        const l = ledges[i];
        if (prevFeet <= l.y && feet >= l.y && Math.abs(goat.x - l.x) < (l.w + GOAT_W) / 2 - 6) {
          goat.y = l.y - GOAT_H / 2;
          goat.vy = -JUMP_VEL;
          landPulseRef.current = 1;
          optsRef.current.onLand?.(goat.x, l.y);
          break;
        }
      }
    }

    // Goat climbing fast? The camera keeps it on the follow line rather
    // than letting it vanish off the top.
    const followLine = camYRef.current + canvasH * FOLLOW_FRAC;
    if (goat.y < followLine) camYRef.current = goat.y - canvasH * FOLLOW_FRAC;

    // ── Ledge field: generate ahead of the camera, GC behind it ──
    while (nextLedgeYRef.current > camYRef.current - SPAWN_AHEAD) spawnLedge(canvasW, progress);

    const gcLine = camYRef.current + canvasH + GC_BELOW;
    const ledges = ledgesRef.current;
    for (let i = 0; i < ledges.length; i++) if (ledges[i].y > gcLine) ledges[i].dead = true;

    // ── Seracs: the icefall ──
    seracClockRef.current -= dt;
    if (seracClockRef.current <= 0 && seracsRef.current.length < MAX_SERACS) {
      const r = 14 + Math.random() * 10;
      seracsRef.current.push({
        // Biased toward the goat's lane — dodging is the game.
        x: Math.min(Math.max(goat.x + (Math.random() - 0.5) * canvasW * 0.9, r), canvasW - r),
        y: camYRef.current - 40,
        vx: (Math.random() - 0.5) * 60,
        vy: 60,
        r,
        spin: Math.random() * Math.PI * 2,
        spinVel: (Math.random() - 0.5) * 3,
        seed: Math.random() * 1000,
        nearMissed: false,
        dead: false,
      });
      const gap = SERAC_GAP_START + (SERAC_GAP_END - SERAC_GAP_START) * progress;
      seracClockRef.current = gap * (0.8 + Math.random() * 0.4); // ±20% jitter
    }

    const seracs = seracsRef.current;
    for (let i = 0; i < seracs.length; i++) {
      const s = seracs[i];
      s.vy = Math.min(s.vy + SERAC_GRAVITY * dt, SERAC_VY_MAX);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.spin += s.spinVel * dt;

      if (s.y > gcLine) { s.dead = true; continue; }

      // Circle-vs-AABB: closest point on the goat's box to the boulder.
      const cx = Math.min(Math.max(s.x, goat.x - halfW), goat.x + halfW);
      const cy = Math.min(Math.max(s.y, goat.y - GOAT_H / 2), goat.y + GOAT_H / 2);
      const dx = s.x - cx, dy = s.y - cy;
      if (dx * dx + dy * dy < s.r * s.r) {
        hazardFlashRef.current = 1;
        shakeRef.current = 0.5;
        popupsRef.current.push({ x: goat.x, y: goat.y - 30, text: 'SERAC!', color: '#ff4d4d', age: 0, ttl: POPUP_TTL });
        endRun('hazard');
        return; // run is over — freeze the world this exact frame
      }
      // Whistled past without connecting → one triumphant bleat.
      if (!s.nearMissed && s.y - goat.y > s.r + GOAT_H / 2 && Math.abs(s.x - goat.x) < NEAR_MISS_X) {
        s.nearMissed = true;
        optsRef.current.onNearMiss?.();
      }
    }

    // ── Carabiners: bob, glow, snag ──
    const carabiners = carabinersRef.current;
    for (let i = 0; i < carabiners.length; i++) {
      const c = carabiners[i];
      c.phase += dt * 3;
      if (c.y > gcLine) { c.dead = true; continue; }
      if (
        Math.abs(goat.x - c.x) < CARABINER_R + halfW - 4 &&
        Math.abs(goat.y - c.y) < CARABINER_R + GOAT_H / 2 - 4
      ) {
        c.dead = true;
        scoreRef.current += CARABINER_CHIPS;
        collectedRef.current += 1;
        collectPulseRef.current = 1;
        popupsRef.current.push({ x: c.x, y: c.y, text: `+${CARABINER_CHIPS}`, color: '#ffd23f', age: 0, ttl: POPUP_TTL });
        optsRef.current.onCollect?.(c.x, c.y);
      }
    }

    // In-place compaction — zero garbage, order preserved.
    let write = 0;
    for (let i = 0; i < ledges.length; i++) if (!ledges[i].dead) ledges[write++] = ledges[i];
    ledges.length = write;
    write = 0;
    for (let i = 0; i < seracs.length; i++) if (!seracs[i].dead) seracs[write++] = seracs[i];
    seracs.length = write;
    write = 0;
    for (let i = 0; i < carabiners.length; i++) if (!carabiners[i].dead) carabiners[write++] = carabiners[i];
    carabiners.length = write;

    // ── Popups drift up and fade; same compaction trick ──
    const popups = popupsRef.current;
    for (let i = 0; i < popups.length; i++) {
      popups[i].age += dt;
      popups[i].y -= POPUP_RISE * dt;
    }
    write = 0;
    for (let i = 0; i < popups.length; i++) if (popups[i].age < popups[i].ttl) popups[write++] = popups[i];
    popups.length = write;

    // ── Juice decay ──
    landPulseRef.current = Math.max(0, landPulseRef.current - dt * 4);
    collectPulseRef.current = Math.max(0, collectPulseRef.current - dt * 3.5);
    hazardFlashRef.current = Math.max(0, hazardFlashRef.current - dt * 2.5);
    shakeRef.current = Math.max(0, shakeRef.current - dt);

    // ── Altitude (display only) ──
    altitudeRef.current = Math.min(SUMMIT_ALT_M, BASE_ALT_M + Math.max(0, -camYRef.current) / PX_PER_M);

    // ── End conditions ──
    if (goat.y - camYRef.current > canvasH + FALL_MARGIN) {
      endRun('fell');
      return;
    }
    if (timeLeftRef.current <= 0) {
      scoreRef.current += SUMMIT_BONUS;
      altitudeRef.current = SUMMIT_ALT_M;
      popupsRef.current.push({
        x: goat.x, y: goat.y - 40, text: `SUMMIT! +${SUMMIT_BONUS.toLocaleString()}`,
        color: '#ffd23f', age: 0, ttl: 1.2,
      });
      endRun('summit');
    }
  }, [spawnLedge, endRun]);

  // Stable identity: the canvas mounts once and keeps this object for
  // the life of the run — no effect re-subscriptions mid-game.
  return useMemo<RainierPhysics>(() => ({
    goatRef, camYRef, scrollSpeedRef, ledgesRef, seracsRef, carabinersRef, popupsRef,
    scoreRef, collectedRef, altitudeRef, statusRef, timeLeftRef,
    landPulseRef, collectPulseRef, hazardFlashRef, shakeRef,
    start, step, setPointerX, endRun,
  }), [start, step, setPointerX, endRun]);
}
