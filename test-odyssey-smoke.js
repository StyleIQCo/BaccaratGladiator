/* test-odyssey-smoke.js — E2E smoke for the odyssey/ dual-campaign module.
 *
 * Builds the harness in odyssey/smoke/ (Vite + Tailwind from
 * arena/node_modules) and drives the full flow touch-emulated:
 *   selector (countdown + LIVE badge) → gong select → campaign map
 *   (10 nodes, BOSS on 2/5/10, Tailwind contract, locked-node rejection)
 *   → cutscene (typewriter, skip-tap, SET SAIL CTA) → stage transition
 *   (storm→sail→arrive→dissolve promise) → table → BigWinOverlay (3s).
 *
 * Usage: node test-odyssey-smoke.js
 * The module ships nowhere yet, but run this before wiring it into any
 * tester-facing host or touching odyssey/src.
 */
const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const SMOKE_DIR = path.join(ROOT, 'odyssey', 'smoke');
const DIST = path.join(SMOKE_DIR, 'dist');
const VITE = path.join(ROOT, 'arena', 'node_modules', '.bin', 'vite');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tap(page, selector) {
  const el = await page.waitForSelector(selector, { timeout: 8000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`no boundingBox for ${selector}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

(async () => {
  // ---- build the harness --------------------------------------------------
  if (!fs.existsSync(VITE)) {
    console.log(`FAIL  vite not found at ${VITE} — run npm install in arena/`);
    process.exit(1);
  }
  const build = spawnSync(VITE, ['build'], { cwd: SMOKE_DIR, encoding: 'utf8' });
  if (build.status !== 0) {
    console.log('FAIL  harness build failed:\n' + (build.stderr || build.stdout));
    process.exit(1);
  }
  check(true, 'harness builds (vite + tailwind)');

  // ---- serve dist ---------------------------------------------------------
  const server = http
    .createServer((req, res) => {
      const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const file = path.join(DIST, url);
      if (!file.startsWith(DIST) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    })
    .listen(0);
  const port = server.address().port;

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() && msg.location().url) || '';
    // Missing audio assets fail silently by design; favicon is the harness's.
    if (url.includes('/audio/odyssey/') || msg.text().includes('/audio/odyssey/')) return;
    if (url.includes('favicon.ico')) return;
    consoleErrors.push(`${msg.text()} @ ${url}`);
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });

    // --- Campaign selector -------------------------------------------------
    await page.waitForSelector('[data-testid="campaign-selector"]', { timeout: 8000 });
    check(true, 'selector renders');
    const countdown = await page.$eval('[data-testid="odyssey-countdown"]', (n) => n.textContent);
    check(
      /ENDS IN (\d+d )?\d\d:\d\d:\d\d|EVENT ENDED/.test(countdown),
      `selector countdown ticking ("${countdown}")`,
    );
    check((await page.$('[data-testid="odyssey-live-badge"]')) !== null, 'LIVE badge present');

    await tap(page, '[data-testid="campaign-card-odyssey"]');

    // --- Campaign map ------------------------------------------------------
    await page.waitForSelector('[data-testid="odyssey-campaign-map"]', { timeout: 8000 });
    check(true, 'gong select → map renders');

    // Tailwind contract: if the content globs miss odyssey/src, the map root
    // loses its utility classes (flex column layout) and renders unstyled.
    const mapDisplay = await page.$eval(
      '[data-testid="odyssey-campaign-map"]',
      (n) => getComputedStyle(n).display,
    );
    check(mapDisplay === 'flex', `tailwind styles applied (map display=${mapDisplay})`);

    const nodeCount = await page.$$eval('[data-testid^="map-node-"]', (ns) => ns.length);
    check(nodeCount === 10, `10 nodes (got ${nodeCount})`);
    // Boss ports fly the crossed-swords marker (locked titles hide as "???").
    const bossIds = await page.$$eval('[data-testid^="map-node-"]', (ns) =>
      ns
        .filter((n) => n.textContent.includes('⚔️'))
        .map((n) => Number(n.getAttribute('data-testid').replace('map-node-', ''))),
    );
    check(
      JSON.stringify(bossIds.sort((a, b) => a - b)) === '[2,5,10]',
      `boss markers on 2/5/10 (got ${JSON.stringify(bossIds)})`,
    );
    const statuses = await page.$$eval('[data-testid^="map-node-"]', (ns) =>
      ns.map((n) => [n.getAttribute('data-testid'), n.getAttribute('data-status')]),
    );
    const s1 = statuses.find(([id]) => id === 'map-node-1')[1];
    const s2 = statuses.find(([id]) => id === 'map-node-2')[1];
    check(s1 === 'unlocked' && s2 === 'locked', `node statuses (1=${s1}, 2=${s2})`);
    const lockedLabel = await page.$eval('[data-testid="map-node-2"]', (n) => n.textContent);
    check(lockedLabel.includes('???'), 'locked titles hidden as "???"');

    const progressChip = await page.$eval('[data-testid="map-progress"]', (n) => n.textContent);
    check(
      progressChip.includes('0 / 10') && progressChip.includes('0 / 3'),
      `stage + relic counters ("${progressChip.trim()}")`,
    );
    const mapCountdown = await page.$eval('[data-testid="map-countdown"]', (n) => n.textContent);
    check(
      /ENDS IN (\d+d )?\d\d:\d\d:\d\d|LIMITED TIME|EVENT ENDED/.test(mapCountdown),
      `map countdown ("${mapCountdown.trim()}")`,
    );
    check((await page.$('[data-testid="map-ship"]')) !== null, 'ship docked at current node');

    // Locked node tap must NOT open the cutscene.
    await tap(page, '[data-testid="map-node-5"]');
    await sleep(700);
    check((await page.$('[data-testid="narrative-cutscene"]')) === null, 'locked node rejected');

    // --- Cutscene (paged: narrative → dialogue lines → objective + CTA) ----
    await tap(page, '[data-testid="map-node-1"]');
    await page.waitForSelector('[data-testid="narrative-cutscene"]', { timeout: 8000 });
    check(true, 'cutscene opens on unlocked node');
    await sleep(800); // entrance + first typed glyphs
    const partial = await page.$eval('[data-testid="cutscene-text"]', (n) => n.textContent);
    await tap(page, '[data-testid="cutscene-advance"]'); // finish page 1 instantly
    await sleep(300);
    const full = await page.$eval('[data-testid="cutscene-text"]', (n) => n.textContent);
    check(
      full.includes('Win three hands to clear your mind') && partial.length < full.length,
      `typewriter streams then skip-completes (${partial.length} → ${full.length} chars)`,
    );
    // Page through the dialogue until the objective seal + CTA arm.
    let ctaVisible = false;
    for (let i = 0; i < 10 && !ctaVisible; i++) {
      await tap(page, '[data-testid="cutscene-advance"]');
      await sleep(400);
      ctaVisible = (await page.$('[data-testid="cutscene-cta"]')) !== null;
    }
    check(ctaVisible, 'paged through dialogue to the objective seal + CTA');
    const ctaText = await page.$eval('[data-testid="cutscene-cta"]', (n) => n.textContent);
    check(ctaText.trim() === 'SET SAIL', `ctaLabel override ("${ctaText.trim()}")`);

    // --- Stage transition --------------------------------------------------
    await tap(page, '[data-testid="cutscene-cta"]');
    await page.waitForSelector('[data-testid="stage-transition"]', { timeout: 8000 });
    check(true, 'CTA → transition overlay appears');
    await page.waitForSelector('[data-testid="table-scene"]', { timeout: 12000 });
    check(true, 'transition promise resolved → table scene');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="stage-transition"]'),
      { timeout: 8000 },
    );
    check(true, 'transition overlay dismounted after dissolve');

    // --- Big win overlay ---------------------------------------------------
    await tap(page, '[data-testid="jackpot-btn"]');
    await sleep(400);
    const midOpacity = await page.$eval('[data-testid="big-win-overlay"]', (n) => getComputedStyle(n).opacity);
    const midText = await page.$eval('[data-testid="big-win-overlay"]', (n) => n.textContent);
    check(midOpacity === '1' && midText.includes('TROJAN HORSE'), `jackpot fires (opacity=${midOpacity})`);
    await sleep(3100);
    const endOpacity = await page.$eval('[data-testid="big-win-overlay"]', (n) => getComputedStyle(n).opacity);
    check(endOpacity === '0', `jackpot ends at 3s (opacity=${endOpacity})`);

    // --- Runtime hygiene ---------------------------------------------------
    check(pageErrors.length === 0, `zero page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
    check(consoleErrors.length === 0, `zero console errors (audio 404s excluded)${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
  } catch (err) {
    failures++;
    console.log('FAIL  smoke aborted:', err.message);
    if (pageErrors.length) console.log('      page errors:', pageErrors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})();
