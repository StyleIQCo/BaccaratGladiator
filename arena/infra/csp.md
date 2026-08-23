# Content-Security-Policy delta for the arena

Your CloudFront sends `script-src 'self'` (CDN module imports silently fail —
see the project memory note). The arena is fully self-hosted/bundled, so no CDN
scripts. The ONE thing CSP will otherwise break is the WebSocket connection.

For responses under `/arena/*`, the policy must include the WS origin in
`connect-src`:

```
connect-src 'self' wss://baccaratgladiator.com https://baccaratgladiator.com;
script-src 'self';
media-src 'self';            # GenAI dealer .mp4 served same-origin
img-src 'self' data:;
```

If the WebSocket terminates on a different host than the page (e.g. a raw ALB
domain rather than the `/arena/ws/*` CloudFront behavior), add that exact origin
to `connect-src` — otherwise the browser blocks the upgrade with no useful error.
Prefer routing WS through `/arena/ws/*` on the same domain so `'self'` covers it.
