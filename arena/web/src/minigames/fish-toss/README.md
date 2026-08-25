# Pike Place Fish Toss — Weekly Fishmonger

Weekly arcade mini-game with automated chip payouts. The full cabinet
lives here, paired the same way `minigames/hotdog` is:

- `useFishTossPhysics.ts` — refs-only simulation (ballistic throw arcs,
  the king salmon's mid-air flop, AABB catches, the 30s clock)
- `FishTossCanvas.tsx` — procedural renderer: drizzly dusk market,
  striped stall, string lights, and both mongers in canon dress
- `FishTossChallenge.tsx` — intro → run → results modal; submits via
  `onSubmitScore`
- `FishmongerLeaderboard.tsx` + `useFishmonger.ts` — the weekly board
  (live socket, or `demoSnapshot` for the Demo Hub)
- `FishTossDemo.tsx` — the 🐟 FISH TOSS Demo Hub tab (local GT-merge)

## Character canon (locked 2026-08-25)

The fishmonger who throws and catches the fish wears:

- **Waterproof bib overalls** in safety **orange** (hi-vis yellow is the
  acceptable alternate), with yellow buckle hardware and hi-vis cuffs
- **Red-plaid flannel shirt** worn UNDER the overalls, sleeves visible
- **Knit beanie** (teal, with a fold band)
- Yellow rubber gloves

The header mascot in `FishmongerLeaderboard.tsx` implements this spec as
inline SVG — the future game sprite must match it.

## How it works

- **Start a run**: emit `ft:run_start` → server replies `ft:run_token`
  with a single-use run proof (wire `FishTossChallenge.onRunStart` to
  `useFishmonger().startRun`).
- **Submit a run**: emit `ft:submit` `{ score, runId, meId, handle,
  avatarKey }` → server replies `ft:submit_result` + a fresh
  `ft:snapshot`. The token is consumed atomically; submits without one,
  replays, instant submits (<1s elapsed), and scores beyond ~1.2k pts
  per elapsed second are all silently dropped.
- **Read the board**: emit `ft:get` `{ meId }` → `ft:snapshot` (top 10,
  your row, prize ladder, week end timestamp).
- **Weekly best**: Redis `ZADD GT` on `ft:lb:{weekKey}` — only a higher
  single run ever replaces your score. Durable mirror: `FishmongerScore`.
- **Payouts**: the engine leader sweeps every minute; within a minute of
  Monday 00:00 UTC (right after Sunday 23:59) the ended week pays
  50K / 25K / 10K / 5K×7 chips via `creditChips` with idemKey
  `ft:{weekKey}:{userId}`, receipted in `ChipTransaction`
  (`MINIGAME_PAYOUT`) and `FishmongerPayout`.

## Testing

Backend E2E (store semantics, mirror, payout, sweep, live gateway ws):

```sh
docker compose up -d redis postgres
npm -w packages/persistence run db:migrate
DATABASE_URL=postgres://bg:bg@localhost:5432/social \
  node_modules/.bin/tsx test-fishtoss-e2e.js   # from arena/
```

UI smoke (touch-emulated: tab → board → full shortened run → results →
GT-merge; guards the canvas loop with a pageerror counter):

```sh
DIST_DIR=/path/to/dist-snapshot node test-fishtoss-smoke.js   # from arena/
```

Run both before any deploy that touches fish-toss (release policy in
the repo root CLAUDE.md).

## Remaining trust gap

Run scores are gated by the server-issued run proof above. What's still
client-claimed is IDENTITY (userId/handle/avatarKey) — the same trust
level as the gateway HELLO — until Cognito-verified profiles land.
