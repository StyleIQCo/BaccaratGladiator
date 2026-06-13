/*
  Anonymous visit beacon. Fires once per page load to POST /visit, which
  records a salted-hash of the client IP + timestamp server-side. No cookies,
  no accounts, no PII stored client-side. Self-hosted to satisfy CSP
  `script-src 'self'`; the POST is a `connect-src` request to the API the
  site already talks to, so no CSP change is needed.
*/
(function () {
  var base =
    (window.BG_CONFIG && window.BG_CONFIG.apiBaseUrl) ||
    'https://xr68waxn2h.execute-api.us-east-1.amazonaws.com';
  var url = base + '/visit';
  var payload = JSON.stringify({ path: location.pathname });

  // IMPORTANT: send as text/plain, not application/json. text/plain is a
  // CORS-safelisted content-type, so this stays a "simple" cross-origin
  // request with no preflight. An application/json body forces a CORS
  // preflight that sendBeacon cannot satisfy — the POST silently never
  // lands (you see only the OPTIONS 204). The Lambda json.loads() the body
  // regardless of content-type, so the payload is still parsed fine.
  try {
    if (navigator.sendBeacon) {
      // sendBeacon survives page unload and never blocks navigation.
      navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain' }));
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    }
  } catch (e) {
    /* analytics must never break the page */
  }
})();
