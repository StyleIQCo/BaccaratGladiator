# Grand Arena — server-authoritative live baccarat

A **new, isolated service** that runs alongside the classic Baccarat Gladiator
static site. It shares **zero code** with the existing game, lives entirely
under the `/arena/` URL path, and can be killed or rolled back without touching
a single classic-game file.

```
https://baccaratgladiator.com/            → classic game (S3, NEVER edited by arena deploys)
https://baccaratgladiator.com/arena/      → this app (S3 /arena/ prefix, static React build)
https://baccaratgladiator.com/arena/ws/   → WebSocket → ALB → gateway nodes → engine
```

## Why a separate path (rollback story)

Because the classic game and the arena never share files, a bad arena release
cannot reach classic players. Rollback is "stop routing to the new thing,"
never "undo edits to the old thing." Three levers, fastest first:

| Lever | How | Time | Blast radius |
|-------|-----|------|--------------|
| **Kill switch** | set `config/flags.json` → `enabled:false`, upload + invalidate that one file | ~30s | arena only; shows "taking a break" + link to classic |
| **Path detach** | point the `/arena/*` CloudFront behavior at a maintenance page | ~minutes | arena only |
| **No-op** | classic `/` is never edited, so there is nothing to revert there | — | none |

## Layout

```
packages/
  shared/       protocol (wire schemas), phases, provablyFair  — imported by server AND client
  engine/       the ONE authoritative loop: GameLoop, CrashController, leader election, Redis bus
  gateway/      stateless, horizontally-scaled WS fan-out + client event handlers
  persistence/  ioredis clients, atomic ledger, round archive, the first-50 rain Lua
web/            React app, base path /arena/, kill-switch gate, theme context, video/CSS render
config/         round.json (timings/curve), flags.json (KILL SWITCH), themes/*.json (white-label)
infra/          cloudfront-behaviors.md, sw-bypass-patch.md, csp.md — the exact prod wiring
deploy-arena.sh deploys ONLY /arena/* — separate from the classic ./deploy.sh
test-arena-e2e.js  headless full-round + provably-fair gate (run before any /arena/ deploy)
```

## Local dev

```bash
docker compose up        # redis + 1 engine + 2 gateways
cd web && npm run dev     # vite on /arena/, proxies /arena/ws to gateway
```

## Before deploying — release policy

The arena frontend publishes to S3/CloudFront, so it is in scope for the
CLAUDE.md release policy, but the existing E2E scripts do NOT cover it. Run
`node test-arena-e2e.js` and report results to the user **before** any
`aws s3 cp` / invalidation. The classic-game E2E scripts are unaffected unless
arena code is later folded into `baccarat-game.html` or the iOS `www/` bundle.
