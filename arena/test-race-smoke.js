#!/usr/bin/env node
// Daily Jumbotron Race smoke — touch-emulated walkthrough of the
// standalone race page (/arena/race-demo.html). Same serving + tap
// conventions as test-lore-smoke.js / test-odyssey-smoke.js: drives the
// BUILT bundle in a real browser with touchscreen taps so z-index and
// overlay regressions surface the way they would on a phone.
//
// Flow: demo shell renders → PLAY opens the jumbotron → champion cards
// render → picking one starts the race → all 3 racers actually MOVE
// (transform-x sampled twice) → live leader caption shows → payout
// modal pays +5,000 (picked winner) or +1,000 (participation) →
// COLLECT credits the wallet exactly → replay works (demo harness
// clears the daily lock) → ✕ closes back to the shell → the
// reduced-motion path still runs a full race to payout.
//
// Prereq: a built bundle. Point DIST_DIR at a snapshot build — deploys
// sync from a snapshot of dist/, never live dist/ (parallel builds in
// this shared worktree have caused HTML↔asset hash mismatches), so
// test the same snapshot you're about to ship.
//
// Usage:
//   DIST_DIR=/path/to/snapshot node test-race-smoke.js
//   SHOTS_DIR=/tmp/shots node test-race-smoke.js   # also save PNGs
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

const START_CHIPS = 12_340; // demo shell's seed wallet
const WIN = 5_000, LOSE = 1_000;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Static server: dist under /arena/, flags at the gate's fetch path ──
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wav': 'audio/wav',
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

// ── Touch helpers (same conventions as test-lore-smoke.js) ──────────
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

/** Wait until a real tap would land on the button — elementFromPoint
 *  respects pointer-events and overlays, so this only resolves once
 *  nothing is covering the target. */
async function waitTappable(page, text, timeout = 8_000) {
  await page.waitForFunction(t => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(t));
    if (!b) return false;
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el === b || b.contains(el);
  }, { timeout }, text);
}

const seeing = t => `document.body.innerText.includes(${JSON.stringify(t)})`;
const shot = async (page, name) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

const racerXs = page => page.evaluate(() =>
  [...document.querySelectorAll('.will-change-transform')].map(el => Math.round(el.getBoundingClientRect().x)));

/** Drive one full race to the payout modal; returns the payout amount. */
async function raceToPayout(page, championText) {
  await tapWhenStill(page, championText);
  await sleep(1_000);
  const early = await racerXs(page);
  ok(early.length === 3, `3 racers on track (saw ${early.length})`);
  await sleep(3_000);
  const mid = await racerXs(page);
  ok(mid.every((x, i) => Math.abs(x - early[i]) > 10),
    `all racers moving (t1=${JSON.stringify(early)} t4=${JSON.stringify(mid)})`);
  ok(await page.evaluate(seeing('LEADS!')), 'live leader caption is up');
  // race is 10s + a 0.8s modal beat; give it slack
  await page.waitForFunction(seeing('COLLECT'), { timeout: 16_000 });
  const won = await page.evaluate(seeing(`+${WIN.toLocaleString('en-US')}`));
  ok(won || await page.evaluate(seeing(`+${LOSE.toLocaleString('en-US')}`)),
    `payout shown: ${won ? 'WINNER +5,000' : 'participation +1,000'}`);
  return won ? WIN : LOSE;
}

// ── The walkthrough ─────────────────────────────────────────────────
(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log(`\nRace smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/race-demo.html`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    let pageErrors = 0;
    page.on('pageerror', e => { pageErrors++; console.log('  [pageerror] ' + e.message); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await page.goto(`http://127.0.0.1:${PORT}/arena/race-demo.html`, { waitUntil: 'networkidle0' });

    console.log('\nShell → selection');
    await page.waitForFunction(seeing('DAILY JUMBOTRON RACE'), { timeout: 10_000 });
    ok(await page.evaluate(seeing(START_CHIPS.toLocaleString('en-US'))), `wallet seeds at ${START_CHIPS.toLocaleString('en-US')}`);
    await tapWhenStill(page, 'PLAY TODAY');
    await page.waitForFunction(seeing('PICK YOUR CHAMPION'), { timeout: 5_000 });
    for (const name of ['Cyber-Bike', 'Roman Chariot', 'Texas Muscle'])
      ok(await page.evaluate(seeing(name)), `champion card renders: ${name}`);
    await shot(page, '1-selection');

    console.log('\nRace 1 — full motion to payout');
    const p1 = await raceToPayout(page, 'Cyber-Bike');
    await shot(page, '2-payout');
    await waitTappable(page, 'COLLECT');
    await tapWhenStill(page, 'COLLECT');
    const total1 = (START_CHIPS + p1).toLocaleString('en-US');
    await page.waitForFunction(seeing(total1), { timeout: 5_000 });
    ok(true, `wallet credited exactly: ${total1}`);

    console.log('\nReplay + close');
    await tapWhenStill(page, 'PLAY TODAY');
    await page.waitForFunction(seeing('PICK YOUR CHAMPION'), { timeout: 5_000 });
    ok(true, 'replay reaches selection (demo harness clears the daily lock)');
    await tap(page, '✕');
    await page.waitForFunction(`!${seeing('PICK YOUR CHAMPION')}`, { timeout: 5_000 });
    ok(await page.evaluate(seeing('PLAY TODAY')), '✕ closes back to the shell');

    // Reduced motion needs a fresh page: framer samples the media query
    // per mount, so flip the emulation and reload (wallet state resets).
    console.log('\nReduced motion — race still runs to payout');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('DAILY JUMBOTRON RACE'), { timeout: 10_000 });
    await tapWhenStill(page, 'PLAY TODAY');
    await page.waitForFunction(seeing('PICK YOUR CHAMPION'), { timeout: 5_000 });
    const p2 = await raceToPayout(page, 'Roman Chariot');
    await waitTappable(page, 'COLLECT');
    await tapWhenStill(page, 'COLLECT');
    await page.waitForFunction(seeing((START_CHIPS + p2).toLocaleString('en-US')), { timeout: 5_000 });
    ok(true, 'reduced-motion run credits the wallet');
    await shot(page, '3-reduced-motion-done');

    ok(pageErrors === 0, `no uncaught page errors (${pageErrors})`);
  } catch (e) {
    ok(false, `walkthrough aborted: ${e.message}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
