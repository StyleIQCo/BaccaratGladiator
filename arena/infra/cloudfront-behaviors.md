# CloudFront wiring — distribution `E16CNCRHHS193O`

Add **two behaviors** to the existing distribution. Do NOT change the default
behavior — that's what keeps the classic game untouched and instantly safe.

## 1. Static arena frontend — `/arena/*`

- **Origin:** existing S3 origin (`baccaratgladiator.com`). Files live under the
  `arena/` key prefix, uploaded by `deploy-arena.sh`.
- **Viewer protocol policy:** redirect-to-HTTPS
- **Cache policy:** CachingOptimized, **except** `/arena/config/flags.json` and
  `/arena/config/round.json` → CachingDisabled (so the kill switch is never stale).
- **Precedence:** above the default `/*` behavior.

## 2. WebSocket / API — `/arena/ws/*`

- **Origin:** new ALB (or App Runner / API Gateway WebSocket) fronting the
  gateway nodes. Recommended prod: gateways on ECS Fargate behind an ALB, a
  single engine task holding the Redis leader lock.
- **Origin protocol:** HTTPS only
- **Cache policy:** CachingDisabled
- **Origin request policy:** AllViewer (forwards `Upgrade`/`Connection` headers
  required for the WebSocket handshake)
- **Allowed methods:** GET, HEAD, OPTIONS (+ POST if you expose any HTTP fallback)

## Rollback via CloudFront

- **Fast:** flip `config/flags.json` (no behavior change needed).
- **Hard:** edit behavior #1's origin to a maintenance bucket, or delete
  behaviors #1 and #2. The default `/*` behavior — the classic game — is never
  modified, so it cannot break.
