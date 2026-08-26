#!/usr/bin/env node
// Snoqualmie Night Shred smoke — touch-emulated walkthrough of the
// 🏂 NIGHT SHRED Demo Hub tab. Drives the BUILT web bundle in a real
// browser with touchscreen taps, so z-index and overlay regressions
// surface the way they would on a phone.
//
// Flow: deep link (?game=shred) lands straight on the game intro
// (legend incl. gates + kicker + hazards) → SHRED starts the canvas
// run → HUD overlay (MPH / COMBO / clock) is visible → touch-drag
// carves → 6-second run (via the `?shredRun=6` test hook) reaches the
// lodge → RUN COMPLETE card shows the base × combo payoff math →
// claim closes the modal, persists chips to localStorage, and the
// launch card is behind it.
//
// Prereq: a SNAPSHOT vite build (never live web/dist — parallel builds
// in the shared worktree cause HTML↔asset hash mismatches):
//   npx vite build --outDir <snapshot> --emptyOutDir   (in web/)
//   DIST_DIR=<snapshot> node test-snowboard-smoke.js
//
// Usage:
//   node test-snowboard-smoke.js              # PORT=5177 by default
//   SHOTS_DIR=/tmp/shots node test-snowboard-smoke.js   # also save PNGs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST_DIR || join(HERE, 'web', 'dist');
const FLAGS = join(HERE, 'config', 'flags.json');
const PORT = Number(process.env.PORT) || 5177;
const SHOTS = process.env.SHOTS_DIR || null;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures++; };

// ── Static server: dist under /arena/, flags at the gate's fetch path ──
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, `http://localhost:${PORT}`).pathname;
    if (path === '/arena/config/flags.json') {
      res.setHeader('content-type', 'application/json');
      res.end(await readFile(FLAGS));
      return;
    }
    let rel = path.startsWith('/arena') ? path.slice('/arena'.length) : path;
    if (rel === '' || rel === '/') rel = '/index.html';
    const file = normalize(join(DIST, rel));
    if (!file.startsWith(DIST)) { res.statusCode = 403; res.end(); return; }
    const data = await readFile(file).catch(() => null);
    if (!data) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    res.end(data);
  } catch (e) {
    res.statusCode = 500; res.end(String(e));
  }
});

// ── Touch helpers (same idiom as test-hotdog-smoke.js) ──────────────
async function rectOf(page, text, onlyButtons = true) {
  return page.evaluate(({ text, onlyButtons }) => {
    const els = [...document.querySelectorAll(onlyButtons ? 'button' : 'body *')]
      .filter(el => el.textContent?.includes(text))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .sort((a, b) => a.textContent.length - b.textContent.length);
    const el = els[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { text, onlyButtons });
}

/** Tap a button once its rect holds still — modal springs move targets.
 *  (The Claim button's idle pulse is a scale about its centre, so the
 *  centre rectOf returns is still a stable target.)
 *  Scroll-robust: a taller hub (each new tab can wrap the nav another
 *  row) shifts everything below it, and the game modal anchors inside
 *  the transformed tab content — at 390×844 the target can settle a
 *  fraction of a pixel BELOW the fold, where touchscreen.tap silently
 *  does nothing (found by baccaratgladiator-a1's 15th-tab candidate:
 *  live y=804.8 tappable, candidate y=844.9 dead). So after settling,
 *  centre the button via scrollIntoView, re-measure, then tap. */
async function tapSettled(page, text) {
  let prev = null;
  for (let i = 0; i < 25; i++) {
    const r = await rectOf(page, text);
    if (r && prev && Math.abs(r.x - prev.x) < 0.5 && Math.abs(r.y - prev.y) < 0.5) {
      await page.evaluate(t => {
        const els = [...document.querySelectorAll('button')]
          .filter(el => el.textContent?.includes(t))
          .filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; })
          .sort((a, b) => a.textContent.length - b.textContent.length);
        els[0]?.scrollIntoView({ block: 'center', behavior: 'instant' });
      }, text);
      await new Promise(res => setTimeout(res, 150));
      const fresh = await rectOf(page, text);
      if (!fresh) throw new Error(`tap target vanished after scroll: "${text}"`);
      await page.touchscreen.tap(fresh.x, fresh.y);
      return;
    }
    prev = r;
    await new Promise(res => setTimeout(res, 100));
  }
  throw new Error(`tap target never settled: "${text}"`);
}

const seeing = t => `document.body.innerText.includes(${JSON.stringify(t)})`;
const shot = async (page, name) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

// ── The walkthrough ─────────────────────────────────────────────────
(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log(`\nNight Shred smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    // Enter through the deep link: ?game=shred selects the tab AND
    // auto-opens the intro. 6-second runs via the test hook.
    await page.goto(`http://127.0.0.1:${PORT}/arena/?game=shred&shredRun=6`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });
    await page.evaluate(() => {
      localStorage.removeItem('arena.shred.best');
      localStorage.removeItem('arena.shred.chips');
    });

    console.log('\nDeep link + intro modal');
    // NOTE: seeing() reads innerText, which reflects CSS text-transform —
    // the title/buttons render uppercase, so match "SHRED ▼" not "Shred ▼".
    // (tapSettled matches textContent, which stays as authored.)
    await page.waitForFunction(seeing('SHRED ▼'), { timeout: 8_000 });
    ok(true, 'deep link (?game=shred) lands straight on the intro');
    ok(await page.evaluate(seeing('SNOQUALMIE NIGHT SHRED')), 'intro shows the title');
    ok(await page.evaluate(seeing('Neon slalom gate')), 'legend lists the slalom gate');
    ok(await page.evaluate(seeing('Kicker ramp')), 'legend lists the kicker ramp');
    ok(await page.evaluate(seeing('Pine tree')), 'legend warns about the trees');
    ok(await page.evaluate(seeing('PAYOFF: BASE SCORE × MAX COMBO')), 'intro states the payoff math');
    await shot(page, '1-deeplink-intro');

    console.log('\nGameplay + HUD overlay');
    await tapSettled(page, 'Shred ▼');
    await page.waitForSelector('canvas', { visible: true, timeout: 5_000 });
    ok(true, 'SHRED mounts the game canvas');
    // The Tailwind HUD overlay renders alongside the canvas.
    await page.waitForFunction(seeing('MPH'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('COMBO')), 'HUD shows the combo multiplier');
    ok(await page.evaluate(seeing('MPH')), 'HUD shows the speed gauge');
    // Carve with real touch drags while the run plays out.
    const canvas = await page.$('canvas');
    const box = await canvas.boundingBox();
    const cy = box.y + box.height * 0.75;
    for (let pass = 0; pass < 3; pass++) {
      const from = box.x + box.width * (pass % 2 ? 0.15 : 0.85);
      const to = box.x + box.width * (pass % 2 ? 0.85 : 0.15);
      await page.touchscreen.touchStart(from, cy);
      for (let i = 0; i <= 10; i++) {
        await page.touchscreen.touchMove(from + ((to - from) * i) / 10, cy);
        await new Promise(r => setTimeout(r, 40));
      }
      await page.touchscreen.touchEnd();
      await new Promise(r => setTimeout(r, 400));
    }
    await shot(page, '2-mid-run');

    console.log('\nResults + claim');
    // 6-second run → the lodge → results card over the frozen frame.
    await page.waitForFunction(seeing('RUN COMPLETE!'), { timeout: 15_000 });
    ok(true, 'run reaches the lodge and the results card appears');
    ok(await page.evaluate(seeing('M SHREDDED')), 'results show the distance line');
    ok(await page.evaluate(seeing('chips!')), 'results show the chip payoff');
    ok(await page.evaluate(seeing('CLAIM CHIPS')), 'results offer the claim button');
    // Let the count-up settle, then read the payoff number.
    await new Promise(r => setTimeout(r, 1600));
    const chips = await page.evaluate(() => {
      const m = document.body.innerText.match(/([\d,]+)\s*chips!/);
      return m ? Number(m[1].replace(/,/g, '')) : 0;
    });
    console.log(`  – payoff on this run: ${chips.toLocaleString()} chips`);
    await shot(page, '3-results');
    await tapSettled(page, 'Claim Chips');
    await page.waitForFunction(`!${seeing('CLAIM CHIPS')}`, { timeout: 5_000 });
    ok(true, 'claim dismisses the modal');
    const persisted = await page.evaluate(() => ({
      best: localStorage.getItem('arena.shred.best'),
      chips: localStorage.getItem('arena.shred.chips'),
    }));
    ok(persisted.best !== null && persisted.chips !== null, 'claimed chips persist to localStorage');
    ok(Number(persisted.chips) === chips, 'persisted total matches the displayed payoff');
    await page.waitForFunction(seeing('CHIPS CLAIMED'), { timeout: 5_000 });
    ok(true, 'launch card is back with the stats row');
    await shot(page, '4-card-after-claim');
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ night shred smoke green');
  process.exit(failures ? 1 : 0);
})();
