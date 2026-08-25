#!/usr/bin/env node
// Fish Toss smoke — touch-emulated walkthrough of the 🐟 FISH TOSS
// Demo Hub tab: leaderboard renders its canned board (gold champion
// row, prize ladder, countdown), the challenge modal opens, a full
// (shortened) run plays on the real canvas, and the results card logs
// the catch. Same serving + tap conventions as test-lore-smoke.js /
// test-odyssey-smoke.js: real browser, touchscreen taps, so z-index
// and overlay regressions surface the way they would on a phone.
// A pageerror counter guards the canvas game loop — any runtime throw
// in physics/render fails the run.
//
// Prereq: a built bundle. Point DIST_DIR at a snapshot build — deploys
// sync from a snapshot of dist/, never live dist/ (parallel builds in
// this shared worktree have caused HTML↔asset hash mismatches), so
// test the same snapshot you're about to ship.
//
// Usage:
//   node test-fishtoss-smoke.js                        # PORT=4941 default
//   DIST_DIR=/path/to/dist node test-fishtoss-smoke.js
//   SHOTS_DIR=/tmp/shots node test-fishtoss-smoke.js   # also save PNGs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST_DIR || join(HERE, 'web', 'dist');
const FLAGS = join(HERE, 'config', 'flags.json');
const PORT = Number(process.env.PORT) || 4941;
const SHOTS = process.env.SHOTS_DIR || null;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// ── Touch helpers (same conventions as the other smokes) ────────────
async function rectOf(page, text, onlyButtons = true) {
  return page.evaluate(({ text, onlyButtons }) => {
    const els = [...document.querySelectorAll(onlyButtons ? 'button' : 'body *')]
      .filter(el => el.textContent?.includes(text))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .sort((a, b) => a.textContent.length - b.textContent.length);
    const el = els[0];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { text, onlyButtons });
}

async function tap(page, text, onlyButtons = true) {
  const r = await rectOf(page, text, onlyButtons);
  if (!r) {
    const dump = await page.evaluate(() =>
      [...document.querySelectorAll('button')].map(b => JSON.stringify(b.textContent)).join(' '));
    throw new Error(`tap target not found: "${text}" — buttons: ${dump}`);
  }
  await page.touchscreen.tap(r.x, r.y);
}

// Framer springs move tap targets mid-flight — aim only once the rect
// holds still between two samples.
async function tapWhenStill(page, text) {
  let prev = await rectOf(page, text);
  for (let i = 0; i < 25; i++) {
    await sleep(100);
    const next = await rectOf(page, text);
    if (next && prev && Math.abs(next.x - prev.x) < 0.5 && Math.abs(next.y - prev.y) < 0.5) {
      await page.touchscreen.tap(next.x, next.y);
      return;
    }
    prev = next;
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
  console.log(`\nFish Toss smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    let pageErrors = 0;
    page.on('pageerror', e => { pageErrors++; console.log('  [pageerror] ' + e.message); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    // fishRun=3: a 3-second run so the whole play→results→log loop fits the smoke.
    await page.goto(`http://127.0.0.1:${PORT}/arena/?fishRun=3`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });

    console.log('\nFISH TOSS tab — demo card + canned leaderboard');
    await tap(page, 'FISH TOSS');
    // NB: headers are styled with Tailwind `uppercase`, and innerText
    // reflects text-transform — assert the RENDERED casing.
    await page.waitForFunction(seeing('PIKE PLACE FISH TOSS'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('WEEKLY BEST')), 'demo card shows the weekly-best stat');
    ok(await page.evaluate(seeing('TOP FISHMONGER')), 'leaderboard header renders');
    ok(await page.evaluate(seeing('Salmon Slinger Sal')), 'rank 1 rival on the board');
    ok(await page.evaluate(seeing('MASTER FISHMONGER')), 'champion row wears the crown badge');
    ok(await page.evaluate(seeing('+50K chips')), 'prize ladder rides the rows');
    ok(await page.evaluate(seeing('Payout in')), 'week-end countdown chip renders');
    await shot(page, '1-fishtoss-tab');

    console.log('\nChallenge modal — intro → a full (3s) run → results');
    await tapWhenStill(page, '▶ PLAY');
    await page.waitForFunction(seeing('King Salmon (flops!)'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('The Old Boot')), 'legend lists the hazard');
    await shot(page, '2-intro');
    // NB: tap targets match on textContent (SOURCE casing) — the CSS
    // `uppercase` only affects innerText, which `seeing()` uses.
    await tapWhenStill(page, "Toss 'Em!");
    // The canvas is now live. Slide the finger so the catcher moves at
    // least once during the run — exercises the pointer path.
    await sleep(400);
    await page.touchscreen.tap(200, 300);
    await sleep(400);
    await page.touchscreen.tap(200, 600);
    // Results card mounts when the clock (3s) runs out — or earlier if
    // the boot finds the catcher. Either way: the haul line appears.
    await page.waitForFunction(seeing('YOUR HAUL'), { timeout: 10_000 });
    ok(true, 'run ended → results card appears');
    const headline = await page.evaluate(() =>
      document.body.innerText.includes("DOCK'S CLOSED") ? 'time' :
      document.body.innerText.includes('THE OLD BOOT') ? 'hazard' : 'missing');
    ok(headline !== 'missing', `results headline present (${headline})`);
    await shot(page, '3-results');

    // Log the catch (or Done on a zero-fish run) — modal closes either way.
    const btn = (await page.evaluate(seeing('LOG THE CATCH'))) ? 'Log the Catch' : 'Done';
    await tapWhenStill(page, btn);
    await page.waitForFunction(`!${seeing('YOUR HAUL')}`, { timeout: 5_000 });
    ok(true, `results dismissed via ${btn}`);
    // A scoring run must move the board: the demo GT-merges it, so the
    // pinned me-row (or a top-10 YOU row) appears.
    if (btn === 'Log the Catch') {
      const merged = await page.waitForFunction(
        `${seeing('You — Rank')} || ${seeing('YOU')}`, { timeout: 5_000 },
      ).then(() => true).catch(() => false);
      ok(merged, 'logged catch GT-merges into the demo board');
    }
    await shot(page, '4-after-log');

    console.log('\nReduced motion — board still renders without the glow loops');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });
    await tap(page, 'FISH TOSS');
    await page.waitForFunction(seeing('TOP FISHMONGER'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('MASTER FISHMONGER')), 'reduced-motion board keeps the champion badge');
    await shot(page, '5-reduced-motion');

    ok(pageErrors === 0, `no page errors during the run (${pageErrors})`);
  } catch (e) {
    failures++;
    console.error('\nFATAL:', e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'SMOKE GREEN' : `${failures} FAILURE(S)`}`);
  process.exit(failures ? 1 : 0);
})();
