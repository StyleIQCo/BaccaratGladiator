// ═══════════════════════════════════════════════════════════════════
//  HOTDOG PARACHUTE DROP — physics core.
//
//  Daily-challenge mini-game: the player steers a parachuting basket
//  while hotdogs rain past. This hook owns the ENTIRE simulation —
//  spawning, gravity, the chili-cheese sine wobble, AABB catch tests,
//  scoring, and the 30-second clock.
//
//  Performance contract (the whole point of this file):
//    • Every per-frame value lives in a ref. React renders exactly
//      twice per run: once when the canvas mounts, once at game over
//      (via the onGameOver callback → parent flips to the results UI).
//    • step() allocates nothing except caught-item score popups.
//      Dead items are compacted in place — no .filter() garbage at
//      60–120 fps on a warm phone.
//    • All motion is dt-based (px/sec), so a 120 Hz ProMotion iPhone
//      and a throttled 30 fps Android play the identical game.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type ItemKind =
  | 'plain_hotdog'
  | 'pretzel'
  | 'mustard_relish'
  | 'beer_stein'
  | 'chili_cheese'
  | 'burnt_hotdog';
export type GameStatus = 'idle' | 'running' | 'over';
export type GameOverReason = 'time' | 'hazard';
export type HazardMode = 'end_run' | 'penalty';

export interface FallingItem {
  kind: ItemKind;
  x: number;            // centre, logical px (post-wobble — this is what you draw & collide)
  y: number;            // centre
  baseX: number;        // wobble oscillates around this
  vy: number;           // px/s, grows under gravity up to terminal
  spin: number;         // cosmetic tumble, radians
  spinVel: number;      // rad/s
  wobblePhase: number;  // chili_cheese: primary sine phase
  wobbleAmp: number;    //   px
  wobbleHz: number;     //   Hz — a second sine at 2.7× freq makes it "erratic"
  seed: number;         // stable per-item jitter for the renderer (topping blobs)
  dead: boolean;        // caught or off-screen; compacted at end of step()
}

export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;   // seconds alive
  ttl: number;   // seconds until removed
}

export interface HotdogPhysicsOptions {
  runSeconds?: number;                // default 30
  hazardMode?: HazardMode;            // 'end_run' (default): burnt dog kills the run
  onGameOver?: (finalScore: number, reason: GameOverReason) => void;
  /** Fired the frame something lands in the basket (hazards included) —
   *  the renderer hangs SFX and celebration particles off this without
   *  any React state involved. */
  onCatch?: (kind: ItemKind) => void;
}

// ── Tuning table ───────────────────────────────────────────────────
// Weights are spawn probabilities (sum ≈ 1). Speeds are BASE fall
// speeds in px/s; gravity accelerates each item up to 1.5× base.
// w/h are per-kind AABBs — steins are tall, pretzels squat, so one
// global box would feel unfair on near-misses.

export const ITEM_STATS: Record<
  ItemKind,
  { weight: number; minVy: number; maxVy: number; chips: number; wobble: boolean; popupColor: string; w: number; h: number }
> = {
  plain_hotdog:   { weight: 0.40, minVy: 130, maxVy: 180, chips: 50,  wobble: false, popupColor: '#ffe066', w: 58, h: 26 },
  pretzel:        { weight: 0.18, minVy: 170, maxVy: 230, chips: 150, wobble: false, popupColor: '#e8b04f', w: 36, h: 32 },
  mustard_relish: { weight: 0.18, minVy: 220, maxVy: 280, chips: 200, wobble: false, popupColor: '#b6e34a', w: 58, h: 26 },
  beer_stein:     { weight: 0.10, minVy: 200, maxVy: 260, chips: 350, wobble: false, popupColor: '#ffcf3f', w: 30, h: 36 },
  chili_cheese:   { weight: 0.08, minVy: 320, maxVy: 400, chips: 500, wobble: true,  popupColor: '#ff8c3b', w: 58, h: 26 },
  burnt_hotdog:   { weight: 0.06, minVy: 240, maxVy: 320, chips: 0,   wobble: false, popupColor: '#ff4d4d', w: 58, h: 26 },
};
const SPAWN_ORDER: ItemKind[] = [
  'plain_hotdog', 'pretzel', 'mustard_relish', 'beer_stein', 'chili_cheese', 'burnt_hotdog',
];

export const RUN_SECONDS_DEFAULT = 30;
export const ITEM_W = 58;             // hotdog AABB (centre-based)
export const ITEM_H = 26;
export const CATCHER_W = 96;          // basket AABB
export const CATCHER_H = 40;
const CATCHER_BOTTOM = 58;            // basket centre sits this far above the canvas floor
const GRAVITY = 160;                  // px/s²
const TERMINAL_MULT = 1.5;            // vy cap = base × this
const SPAWN_START = 0.85;             // seconds between spawns at t=0…
const SPAWN_END = 0.34;               // …ramping to this by the final second
const MAX_ITEMS = 40;                 // hard cap — spawner skips a beat rather than flood
const EDGE_MARGIN = 26;               // keep spawns/wobble inside the walls
const PLAYER_EASE = 14;               // 1/s — how snappily the basket chases the finger
const HAZARD_PENALTY = 250;           // chips lost in 'penalty' mode
const POPUP_TTL = 0.8;
const POPUP_RISE = 70;                // px/s

/** Single source of truth for the basket's AABB — renderer and collision share it. */
export function getCatcherBox(centerX: number, canvasH: number) {
  return { cx: centerX, cy: canvasH - CATCHER_BOTTOM, w: CATCHER_W, h: CATCHER_H };
}

/** Centre-based AABB overlap. */
function aabb(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
}

function rollKind(): ItemKind {
  let r = Math.random();
  for (const kind of SPAWN_ORDER) {
    r -= ITEM_STATS[kind].weight;
    if (r <= 0) return kind;
  }
  return 'plain_hotdog';
}

// ── The hook ───────────────────────────────────────────────────────

export interface HotdogPhysics {
  // Refs the renderer reads every frame (never trigger React renders):
  playerXRef: MutableRefObject<number>;      // smoothed basket centre — draw this
  itemsRef: MutableRefObject<FallingItem[]>;
  popupsRef: MutableRefObject<ScorePopup[]>;
  scoreRef: MutableRefObject<number>;
  statusRef: MutableRefObject<GameStatus>;
  timeLeftRef: MutableRefObject<number>;     // seconds, clamped ≥ 0
  catchPulseRef: MutableRefObject<number>;   // 1 → 0 after each catch; drives score bounce
  hazardFlashRef: MutableRefObject<number>;  // 1 → 0 after a burnt catch; red screen flash
  shakeRef: MutableRefObject<number>;        // seconds of screen shake remaining
  // Imperative API for the canvas component:
  start: (canvasW: number) => void;
  step: (dt: number, canvasW: number, canvasH: number) => void;
  setPointerX: (x: number) => void;
  endRun: (reason: GameOverReason) => void;
}

export function useHotdogPhysics(opts: HotdogPhysicsOptions = {}): HotdogPhysics {
  // Latest-ref pattern: callers can pass inline closures without
  // destabilising the loop — we read the freshest values at runtime.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const playerXRef = useRef(0);
  const playerTargetXRef = useRef(0);
  const itemsRef = useRef<FallingItem[]>([]);
  const popupsRef = useRef<ScorePopup[]>([]);
  const scoreRef = useRef(0);
  const statusRef = useRef<GameStatus>('idle');
  const timeLeftRef = useRef(RUN_SECONDS_DEFAULT);
  const elapsedRef = useRef(0);
  const spawnClockRef = useRef(0);
  const catchPulseRef = useRef(0);
  const hazardFlashRef = useRef(0);
  const shakeRef = useRef(0);

  const endRun = useCallback((reason: GameOverReason) => {
    if (statusRef.current !== 'running') return;
    statusRef.current = 'over';
    optsRef.current.onGameOver?.(scoreRef.current, reason);
  }, []);

  const start = useCallback((canvasW: number) => {
    itemsRef.current.length = 0;
    popupsRef.current.length = 0;
    scoreRef.current = 0;
    elapsedRef.current = 0;
    spawnClockRef.current = 0.5;        // beat of empty sky before the first dog
    timeLeftRef.current = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    catchPulseRef.current = 0;
    hazardFlashRef.current = 0;
    shakeRef.current = 0;
    playerXRef.current = canvasW / 2;
    playerTargetXRef.current = canvasW / 2;
    statusRef.current = 'running';
  }, []);

  const setPointerX = useCallback((x: number) => {
    playerTargetXRef.current = x;
  }, []);

  const spawn = useCallback((canvasW: number) => {
    const items = itemsRef.current;
    if (items.length >= MAX_ITEMS) return;

    const kind = rollKind();
    const stats = ITEM_STATS[kind];
    const wobbleAmp = stats.wobble ? 30 + Math.random() * 40 : 0;
    const lo = EDGE_MARGIN + stats.w / 2 + wobbleAmp;
    const hi = canvasW - EDGE_MARGIN - stats.w / 2 - wobbleAmp;
    const baseX = lo + Math.random() * Math.max(hi - lo, 1);

    items.push({
      kind,
      x: baseX,
      y: -stats.h,                      // just above the top edge
      baseX,
      vy: stats.minVy + Math.random() * (stats.maxVy - stats.minVy),
      spin: (Math.random() - 0.5) * 0.6,
      spinVel: (Math.random() - 0.5) * 1.6,
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleAmp,
      wobbleHz: stats.wobble ? 0.8 + Math.random() * 0.8 : 0,
      seed: Math.random() * 1000,
      dead: false,
    });
  }, []);

  const step = useCallback((dt: number, canvasW: number, canvasH: number) => {
    if (statusRef.current !== 'running') return;
    // Tab-switch / hitch protection: a 3-second background pause must not
    // teleport every item through the basket in one frame.
    dt = Math.min(dt, 0.05);

    // ── Clock ──
    const runSeconds = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    elapsedRef.current += dt;
    timeLeftRef.current = Math.max(0, runSeconds - elapsedRef.current);

    // ── Player: exponential ease toward the finger (frame-rate independent) ──
    const halfW = CATCHER_W / 2 + 6;
    const target = Math.min(Math.max(playerTargetXRef.current, halfW), canvasW - halfW);
    playerXRef.current += (target - playerXRef.current) * (1 - Math.exp(-PLAYER_EASE * dt));

    // ── Spawner: interval ramps down over the run (difficulty curve) ──
    spawnClockRef.current -= dt;
    const progress = Math.min(elapsedRef.current / runSeconds, 1);
    while (spawnClockRef.current <= 0) {
      spawn(canvasW);
      const base = SPAWN_START + (SPAWN_END - SPAWN_START) * progress;
      spawnClockRef.current += base * (0.8 + Math.random() * 0.4); // ±20% jitter
    }

    // ── Items: gravity, wobble, catch test ──
    const box = getCatcherBox(playerXRef.current, canvasH);
    const items = itemsRef.current;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const st = ITEM_STATS[it.kind];
      const terminal = st.minVy * TERMINAL_MULT + (st.maxVy - st.minVy);
      it.vy = Math.min(it.vy + GRAVITY * dt, terminal);
      it.y += it.vy * dt;
      it.spin += it.spinVel * dt;

      if (it.wobbleAmp > 0) {
        // Primary sine + a faster quarter-amplitude sine = "erratic" chili wobble.
        it.wobblePhase += Math.PI * 2 * it.wobbleHz * dt;
        it.x = it.baseX
          + Math.sin(it.wobblePhase) * it.wobbleAmp
          + Math.sin(it.wobblePhase * 2.7) * it.wobbleAmp * 0.35;
      }

      if (it.y > canvasH + st.h) { it.dead = true; continue; }

      if (aabb(it.x, it.y, st.w, st.h, box.cx, box.cy, box.w, box.h)) {
        it.dead = true;
        if (it.kind === 'burnt_hotdog') {
          optsRef.current.onCatch?.('burnt_hotdog');
          hazardFlashRef.current = 1;
          shakeRef.current = 0.4;
          if ((optsRef.current.hazardMode ?? 'end_run') === 'end_run') {
            popupsRef.current.push({ x: it.x, y: it.y, text: 'BURNT!', color: st.popupColor, age: 0, ttl: POPUP_TTL });
            endRun('hazard');
            return; // run is over — freeze the world this exact frame
          }
          scoreRef.current = Math.max(0, scoreRef.current - HAZARD_PENALTY);
          popupsRef.current.push({ x: it.x, y: it.y, text: `-${HAZARD_PENALTY}`, color: st.popupColor, age: 0, ttl: POPUP_TTL });
        } else {
          scoreRef.current += st.chips;
          catchPulseRef.current = 1;
          popupsRef.current.push({ x: it.x, y: it.y, text: `+${st.chips}`, color: st.popupColor, age: 0, ttl: POPUP_TTL });
          optsRef.current.onCatch?.(it.kind);
        }
      }
    }

    // In-place compaction — zero garbage, order preserved.
    let write = 0;
    for (let i = 0; i < items.length; i++) {
      if (!items[i].dead) items[write++] = items[i];
    }
    items.length = write;

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
    catchPulseRef.current = Math.max(0, catchPulseRef.current - dt * 3.5);
    hazardFlashRef.current = Math.max(0, hazardFlashRef.current - dt * 2.5);
    shakeRef.current = Math.max(0, shakeRef.current - dt);

    if (timeLeftRef.current <= 0) endRun('time');
  }, [spawn, endRun]);

  // Stable identity: the canvas mounts once and keeps this object for
  // the life of the run — no effect re-subscriptions mid-game.
  return useMemo<HotdogPhysics>(() => ({
    playerXRef, itemsRef, popupsRef, scoreRef, statusRef, timeLeftRef,
    catchPulseRef, hazardFlashRef, shakeRef,
    start, step, setPointerX, endRun,
  }), [start, step, setPointerX, endRun]);
}
