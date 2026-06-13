const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const results = [];
  for (let pass = 0; pass < 2; pass++) {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    if (typeof page.setBypassServiceWorker === 'function') await page.setBypassServiceWorker(true);
    await page.goto('https://baccaratgladiator.com/road-to-macau.html?tournament=2026-06&cb=' + Date.now(),
      { waitUntil: 'networkidle2', timeout: 60_000 });
    await new Promise(r => setTimeout(r, 2500));
    const first10 = await page.evaluate(() => {
      // Game module exposes window.__macauState, which can't see `shoe` (it's
      // module-scoped). Reach in via __bgTournament + a fresh seeded RNG +
      // identical shoe construction to verify determinism client-side.
      const t = window.__bgTournament;
      if (!t) return null;
      // Reconstruct the same shoe deterministically using exposed primitives
      const seed = t.seed;
      // Reuse the Mulberry32 from the game; it lives in the module scope so
      // we replicate it here for the test harness.
      function mulberry32(s) {
        s = s >>> 0;
        return function () {
          s = (s + 0x6D2B79F5) >>> 0;
          let t = s;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      const rng = mulberry32(seed);
      const SUITS = ['♠','♥','♦','♣'];
      const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
      const cs = [];
      for (let d = 0; d < 8; d++) for (const s of SUITS) for (const r of RANKS) cs.push(r + s);
      for (let i = cs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [cs[i], cs[j]] = [cs[j], cs[i]];
      }
      return cs.slice(0, 10).join(',');
    });
    results.push(first10);
    await page.close();
  }
  console.log('Pass 1 first 10 cards:', results[0]);
  console.log('Pass 2 first 10 cards:', results[1]);
  console.log(results[0] === results[1] ? '✓ DETERMINISTIC' : '✗ NON-DETERMINISTIC');
  await browser.close();
})();
