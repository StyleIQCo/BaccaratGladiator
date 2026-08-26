#!/usr/bin/env node
// Rainier Summit Scramble smoke — touch-emulated walkthrough of the
// 🐐 RAINIER SCRAMBLE Demo Hub tab: the demo card renders, the
// challenge modal opens with its legend, a full (shortened) run plays
// on the real canvas with pointer steering, and the EXPEDITION
// COMPLETE card claims the chips into the local best. Same serving +
// tap conventions as test-fishtoss-smoke.js: real browser, touchscreen
// taps, so z-index and overlay regressions surface the way they would
// on a phone. A pageerror counter guards the canvas game loop — any
// runtime throw in physics/render/sfx fails the run.
//
// Prereq: a built bundle. Point DIST_DIR at a snapshot build — deploys
// sync from a snapshot of dist/, never live dist/ (parallel builds in
// this shared worktree have caused HTML↔asset hash mismatches), so
// test the same snapshot you're about to ship.
//
// Usage:
//   node test-rainier-smoke.js                        # PORT=4947 default
//   DIST_DIR=/path/to/dist node test-rainier-smoke.js
//   SHOTS_DIR=/tmp/shots node test-rainier-smoke.js   # also save PNGs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST_DIR || join(HERE, 'web', 'dist');
const FLAGS = join(HERE, 'config', 'flags.json');
const PORT = Number(process.env.PORT) || 4947;
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
  console.log(`\nRainier smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    let pageErrors = 0;
    page.on('pageerror', e => { pageErrors++; console.log('  [pageerror] ' + e.message); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    // rainierRun=3: a 3-second summit clock so the whole
    // play→results→claim loop fits the smoke. (Seracs wake at 3.5s and
    // the first blizzard at 8s+, so a 3s run reliably ends by summit.)
    await page.goto(`http://127.0.0.1:${PORT}/arena/?rainierRun=3`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });

    console.log('\nRAINIER SCRAMBLE tab — demo card');
    await tap(page, 'RAINIER SCRAMBLE');
    // NB: headers are styled with Tailwind `uppercase`, and innerText
    // reflects text-transform — assert the RENDERED casing.
    await page.waitForFunction(seeing('RAINIER SUMMIT SCRAMBLE'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('BEST EXPEDITION')), 'demo card shows the best-expedition stat');
    await shot(page, '1-rainier-tab');

    console.log('\nChallenge modal — intro → a full (3s) run → results');
    await tapWhenStill(page, '▶ PLAY');
    // NB: the legend rows are NOT styled `uppercase` (unlike the
    // headers), so innerText keeps the source casing here.
    await page.waitForFunction(seeing('Golden Carabiner'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('Falling Serac')), 'legend lists the serac hazard');
    ok(await page.evaluate(seeing('Whiteout')), 'legend warns about the blizzard');
    await shot(page, '2-intro');
    // NB: tap targets match on textContent (SOURCE casing) — the CSS
    // `uppercase` only affects innerText, which `seeing()` uses.
    await tapWhenStill(page, 'Begin Ascent');
    // The canvas is now live. Steer the goat left then right so the
    // pointer→setPointerX path is exercised at least once mid-run.
    await sleep(400);
    await page.touchscreen.tap(80, 420);
    await sleep(400);
    await page.touchscreen.tap(310, 420);
    // Results card mounts when the summit clock (3s) runs out — or
    // earlier if the goat falls. Either way: the expedition wraps.
    await page.waitForFunction(seeing('EXPEDITION COMPLETE'), { timeout: 12_000 });
    ok(true, 'run ended → EXPEDITION COMPLETE card appears');
    const headline = await page.evaluate(() =>
      document.body.innerText.includes('SUMMIT REACHED') ? 'summit' :
      document.body.innerText.includes('LONG WAY DOWN') ? 'fell' :
      document.body.innerText.includes('CRUSHED BY A SERAC') ? 'hazard' : 'missing');
    ok(headline !== 'missing', `results headline present (${headline})`);
    ok(await page.evaluate(seeing('ALTITUDE')), 'results card shows altitude reached');
    ok(await page.evaluate(seeing('CHIPS')), 'results card shows chips earned');
    await shot(page, '3-results');

    // Claim the chips (or Done on a zero-chip fall) — modal closes either way.
    const btn = (await page.evaluate(seeing('CLAIM CHIPS'))) ? 'Claim Chips' : 'Done';
    await tapWhenStill(page, btn);
    await page.waitForFunction(`!${seeing('EXPEDITION COMPLETE')}`, { timeout: 5_000 });
    ok(true, `results dismissed via ${btn}`);
    // A scoring run must land in the local best: the demo GT-merges it
    // into localStorage, which feeds the card's BEST EXPEDITION stat.
    if (btn === 'Claim Chips') {
      const best = await page.evaluate(() => Number(localStorage.getItem('arena.rainier.best')) || 0);
      ok(best > 0, `claimed chips GT-merge into the local best (${best})`);
    }
    await shot(page, '4-after-claim');

    console.log('\nReduced motion — card and modal still render without the springs');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });
    await tap(page, 'RAINIER SCRAMBLE');
    await page.waitForFunction(seeing('RAINIER SUMMIT SCRAMBLE'), { timeout: 5_000 });
    await tapWhenStill(page, '▶ PLAY');
    await page.waitForFunction(seeing('Golden Carabiner'), { timeout: 5_000 });
    ok(true, 'reduced-motion intro reaches the legend');
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
