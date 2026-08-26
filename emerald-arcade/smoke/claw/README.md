# Emerald City Claw smoke harness

Headless E2E for the Emerald City Claw cabinet. Mounts the real
`EmeraldClawGame` wrapper (→ `ClawMachineCanvas` → `useClawPhysics` →
shared `useArcadeEngine`) with a **seeded machine** (`seed=7` in
`main.tsx`) so the souvenir pile is deterministic, then plays it
touch-emulated:

1. Intro → **INSERT TOKEN** (audio prime path).
2. Asserts the seeded pile (11 items), 4 tokens, idle state, and that
   the canvas is actually painting (distinct-color sample).
3. Drives the `[◀]`/`[▶]` hold-buttons and asserts the trolley moves
   each way (readings taken after the carriage coasts to rest —
   momentum drift poisons immediate reads).
4. An auto-player drags the glass to park the claw over the easiest
   *exposed* prize (cans → plush → …, via the `?eadebug` `__clawSim`
   handle), taps **DROP CLAW**, and rides all four tokens.
5. Asserts every state-machine stop was reached (`dropping`,
   `grabbing`, `retracting`, `transporting`, `releasing`), prize cards
   get stashed, the haul screen total matches the sim, and
   **CLAIM** delivers exactly that total through `onClaim` + closes.
6. Zero page/console errors.

Grip RNG can zero a run even with good aim, so a 0-chip run triggers
ONE full replay (page reload) before failing — same policy as the
cherry smoke's catch retry.

## Running it

```sh
node emerald-arcade/smoke/claw/run.js
```

Builds with Vite + Tailwind from `arena/node_modules` (the module has
no toolchain of its own). Tailwind is wired here **on purpose** — the
wrapper is Tailwind-styled, so this harness doubles as proof of the
documented host contract: any host that mounts `EmeraldClawGame` must
include `emerald-arcade/src/**/*.{ts,tsx}` in its Tailwind content
glob (same contract as the odyssey module).

Expected tail of output:

```
PASS  onClaim delivered the haul (750 vs 750)
PASS  claim closes the modal (onClose fired)
PASS  zero page errors
PASS  zero console errors

SMOKE PASS
```

Per the release policy in CLAUDE.md: this gate must pass (along with
`node test-emerald-arcade-smoke.js` at the repo root) before any host
that mounts the arcade is deployed.
