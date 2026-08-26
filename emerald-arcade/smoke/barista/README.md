# Barista Rush smoke harness

Headless E2E for the Pike St. Barista Rush cabinet. Mounts the real
`BaristaRushCanvas` (which mounts the real `useBaristaPhysics` +
`useArcadeEngine`), then drives two complete drink loops with pointer
input, waiting on **actual stage transitions** (via the canvas'
`onStageChange` prop) rather than guessed sleeps:

1. **Drink 1 — the ruined path**: tamp tap → hold the valve until the
   cup overflows. Asserts the drink logs as `ruined` with 0 chips.
2. **Drink 2 — the full line**: tamp tap → measured ~1.6 s pull →
   circle trace on the latte-art foam. Asserts a non-ruined grade.

Also asserts: `onGameOver` fires, ≥2 drinks served, all four stations
reached (`tamp`/`pull`/`art`/`serve`), 4 Hz HUD ticks flowed, no page
errors, and the canvas isn't blank (pixel-range sample).

## Running it

`emerald-arcade/` has no toolchain of its own yet (it hoists arena/web's
at integration time, like the odyssey module). The harness needs
`esbuild`, `react`, `react-dom` resolvable next to a copy of `src/`,
plus the repo root's `puppeteer`:

```sh
# from a scratch dir containing: this smoke/ dir, a copy of emerald-arcade/src,
# and a package.json with esbuild + react + react-dom (+ typescript to typecheck)
./node_modules/.bin/tsc --noEmit                          # strict typecheck of src/
./node_modules/.bin/esbuild smoke/barista/entry.tsx \
  --bundle --jsx=automatic --outfile=smoke/barista/bundle.js
node smoke/barista/run.js
```

Expected tail of output:

```
stages: tamp → pull → serve → tamp → pull → art → serve → tamp
over: {"score":250,"drinks":2,...,"log":[{...,"grade":"ruined","chips":0},{...,"grade":"good","chips":250}]}
SMOKE PASS
```

Per the release policy in CLAUDE.md: this gate must pass before any
host that mounts the arcade is deployed.
