# Service-worker isolation (PROPOSED PATCH — not yet applied)

The classic root `sw.js` (`CACHE_VERSION = 'bg-v110'`) is cache-first for the
shell. If it ever caches `/arena/*`, stale arena assets would survive a rollback
and defeat the kill switch. Two independent guards:

## A. Arena ships its OWN service worker, scoped to /arena/

`web/public/sw.js` is registered with `{ scope: '/arena/' }`. A root SW and a
`/arena/`-scoped SW coexist fine — scope is longest-prefix-match.

## B. Make the ROOT sw.js explicitly ignore /arena/ (one line, deploy-gated)

In `sw.js`'s `fetch` handler, before any `caches.match`, add:

```js
// Never intercept the Grand Arena — it owns its own SW + a no-store config.
if (new URL(event.request.url).pathname.startsWith('/arena/')) return;
```

> ⚠️ Applying this edits a release-gated file. Per project policy + memory:
> bump `CACHE_VERSION` (`bg-v110` → next), deploy `sw.js`, and run the relevant
> classic-game E2E (`test-theme-smoke.js`, `test-ios-bundle.js`) BEFORE shipping.
> This patch is documented here so the arena work doesn't silently touch the
> classic deploy path. Apply it only when you explicitly choose to.
