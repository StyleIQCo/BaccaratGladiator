# The Odyssey — Dual-Campaign Module

A self-contained React/TypeScript module for the limited-time "Odyssey" story
campaign. **Nothing in the live 62-stage game is imported, modified, or
depended on** — this directory is a parallel codebase that a Next.js (App
Router) or any React host can mount.

## Parallel-state guarantee

- Odyssey progress lives only under `ODYSSEY_STORAGE_KEY`
  (`bg_odyssey_progress_v1`) — a namespace the classic game never reads.
- No file outside `odyssey/` is touched. The deploy scripts
  (`deploy.sh`, `deploy-arena.sh`) do not ship this directory.

## Layout

```
odyssey/src/
  data/odysseyStoryData.ts        10 stages (Lotus-Eaters → Great Hall of
                                  Ithaca; bosses at 2, 5, 10): narrative text,
                                  dialogue, audio themes, machine-readable win
                                  conditions + table modifiers, map coords,
                                  ActiveCampaign ('CLASSIC' | 'ODYSSEY') +
                                  namespaced progress load/save
  hooks/useAudioEngine.ts         Singleton BGM crossfade + pooled SFX engine
  hooks/useCanvasParticles.ts     Single-canvas rAF particle engine (embers/coins)
  components/BossAtmosphere.tsx   Fullscreen ember backdrop (bosses + map)
  components/BigWinOverlay.tsx    Imperative coin-shower jackpot overlay (3s)
  components/CampaignSelector.tsx Classic vs Odyssey landing screen (pulsing
                                  LIVE badge + countdown to ODYSSEY_EVENT_ENDS_AT)
  components/NarrativeCutsceneModal.tsx
                                  Paged pre-table story gate (intro/victory
                                  modes): stone-drag entrance, DOM-direct
                                  typewriter + clack SFX, objective seal,
                                  ctaLabel-able CTA (default ENTER THE TABLE)
  components/StageTransitionOverlay.tsx
                                  Imperative stage-clear voyage: thunder shake →
                                  ship glides the chart (rAF, no state) →
                                  triumph chime → dissolve; play() → Promise
  components/OdysseyCampaignMap.tsx
                                  10-node Mediterranean map: ember backdrop,
                                  aegean_guitar BGM, dotted route + traveled
                                  gold stretch, bobbing ship at the current
                                  node, relic counter, lock shake + clank
  components/OdysseyCampaignFlow.tsx
                                  Map → cutscene wiring: sailable tap opens
                                  the intro cutscene with a "SET SAIL" CTA;
                                  the CTA hands the stage to onEnterTable
```

## Peer dependencies (host app provides)

- `react` / `react-dom` ^18 or ^19
- `framer-motion` ^11
- `typescript` ^5

## Audio assets

The engine expects files under the host's public root:

```
/public/audio/odyssey/bgm/  mystic_chords.mp3  boss_drums.mp3  ocean_ambient.mp3
                            orchestral_overture.mp3  aegean_guitar.mp3
/public/audio/odyssey/sfx/  card_slide.mp3  gong.mp3  stone_drag.mp3
                            typewriter_clack.mp3  jackpot_chime.mp3  metal_clank.mp3
                            thunderclap.mp3  ocean_waves.mp3  triumph_chime.mp3
                            sword_unsheathe.mp3
```

Missing files fail silently (playback promise rejection is swallowed), so the
UI works before audio is dropped in. Note the prod CSP (`script-src 'self'`)
— keep assets self-hosted, no CDN imports.

## Performance rules encoded here

- Particles: one `<canvas>` + `requestAnimationFrame` + mutable refs. No DOM
  nodes per particle, no `useState` in the hot path, object pool with
  swap-remove (steady state allocates nothing), DPR capped at 2, no
  `shadowBlur`, rAF self-suspends when idle or the tab is hidden.
- Audio: one shared engine instance; BGM crossfades survive route changes;
  SFX are pooled and throttleable (typewriter clacks); playback queues until
  the first user gesture (iOS autoplay policy).

## Smoke-test hooks

Components expose `data-testid` attributes (`campaign-selector`,
`campaign-card-classic`, `campaign-card-odyssey`, `odyssey-live-badge`,
`odyssey-countdown`, `boss-atmosphere`, `big-win-overlay`,
`narrative-cutscene`, `cutscene-advance`, `cutscene-text`, `cutscene-cta`,
`cutscene-close`, `stage-transition`, `odyssey-campaign-map`, `map-exit`,
`map-progress`, `map-countdown`, `map-ship`, `map-node-<id>` with a
`data-status` of cleared/unlocked/locked) for the project's Puppeteer
touch-tap smoke tests.

Run the E2E gate with `node test-odyssey-smoke.js` from the repo root — it
builds the harness in `odyssey/smoke/` (Vite + Tailwind borrowed from
`arena/node_modules`) and drives the full selector → map → cutscene →
voyage → jackpot flow under touch emulation.

**Tailwind note:** `OdysseyCampaignMap` is styled with Tailwind utility
classes (arbitrary values only — no theme extensions). The host's tailwind
config must add `odyssey/src/**/*.{ts,tsx}` to its `content` globs or the
map renders unstyled; its custom keyframes ship in the component's own
`<style>` tag. The other odyssey components are inline-styled and need no
CSS build.
