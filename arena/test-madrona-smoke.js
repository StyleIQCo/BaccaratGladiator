#!/usr/bin/env node
// Madrona Wood Labyrinth smoke — touch-emulated walkthrough of the
// 🪵 WOOD LABYRINTH Demo Hub tab: the demo card renders, the labyrinth
// modal opens with its legend, the marble inventory equips IRON, a run
// starts on the real canvas (touch-drag tilt actually rolls the
// marble), then the cabinet's ?madronaDebug sim handle drives the
// deterministic beats — iron SHATTERS a cracked barrier, the marble
// reaches the emerald — and the trail-report plaque claims chips into
// the local best. Same serving + tap conventions as
// test-rainier-smoke.js: real browser, touchscreen taps, so z-index
// and overlay regressions surface the way they would on a phone. A
// pageerror counter guards the canvas game loop — any runtime throw in
// physics/render/sfx fails the run.
//
// Prereq: a built bundle. Point DIST_DIR at a snapshot build — deploys
// sync from a snapshot of dist/, never live dist/ (parallel builds in
// this shared worktree have caused HTML↔asset hash mismatches), so
// test the same snapshot you're about to ship.
//
// Usage:
//   node test-madrona-smoke.js                        # PORT=4951 default
//   DIST_DIR=/path/to/dist node test-madrona-smoke.js
//   SHOTS_DIR=/tmp/shots node test-madrona-smoke.js   # also save PNGs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST_DIR || join(HERE, 'web', 'dist');
const FLAGS = join(HERE, 'config', 'flags.json');
const PORT = Number(process.env.PORT) || 4951;
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
const debugState = page => page.evaluate(() => window.__madronaDebug && window.__madronaDebug.getState());
const shot = async (page, name) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

// ── The walkthrough ─────────────────────────────────────────────────
(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log(`\nMadrona smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    let pageErrors = 0;
    page.on('pageerror', e => { pageErrors++; console.log('  [pageerror] ' + e.message); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    // ?game=madrona deep-links the tab; madronaRun=25 keeps the clock
    // roomy for the scripted beats; madronaDebug arms the sim handle.
    const url = `http://127.0.0.1:${PORT}/arena/?game=madrona&madronaRun=25&madronaDebug`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });

    console.log('\nWOOD LABYRINTH tab — demo card (via ?game= deep link)');
    // NB: headers are styled with Tailwind `uppercase`, and innerText
    // reflects text-transform — assert the RENDERED casing.
    await page.waitForFunction(seeing('MADRONA WOOD LABYRINTH'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('BEST RUN')), 'demo card shows the best-run stat');
    await shot(page, '1-madrona-tab');

    console.log('\nLabyrinth modal — intro legend + marble inventory');
    await tapWhenStill(page, '▶ PLAY');
    await page.waitForFunction(seeing('KNOT-HOLES'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('BARRIERS')), 'legend lists the cracked barriers');
    await shot(page, '2-intro');

    // The loadout door: equip the iron heavy-ball. Tap targets match on
    // textContent (SOURCE casing) — CSS `uppercase` only affects innerText.
    await tapWhenStill(page, 'Change');
    await page.waitForFunction(seeing('DESTRUCTION'), { timeout: 5_000 });
    // NB: card names are styled `uppercase` — innerText reflects the
    // RENDERED casing, while the tap below matches source textContent.
    ok(await page.evaluate(seeing('IRON HEAVY-BALL')), 'inventory lists the iron heavy-ball');
    await shot(page, '3-inventory');
    await tapWhenStill(page, 'Iron Heavy-Ball');
    await page.waitForFunction(`!${seeing('DESTRUCTION')}`, { timeout: 5_000 });
    ok(true, 'selecting a marble closes the inventory');

    console.log('\nThe run — real touch tilt, then debug-driven beats');
    await tapWhenStill(page, 'Roll Out');
    await page.waitForFunction('!!window.__madronaDebug', { timeout: 8_000 });
    await sleep(300);
    let st = await debugState(page);
    ok(st && st.status === 'running', 'physics running after ROLL OUT');
    ok(st && st.marble === 'iron', `iron equipped in the game loop (${st && st.marble})`);
    ok(st && st.barriers === 2, `2 destructible barriers standing (${st && st.barriers})`);

    // REAL touch tilt: hold right of the canvas centre — the marble
    // must actually roll (exercises pointer → setTilt → integration).
    const canvasBox = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    ok(!!canvasBox, 'canvas mounted');
    const x0 = (await debugState(page)).pos.x;
    await page.touchscreen.touchStart(canvasBox.x + canvasBox.width * 0.8, canvasBox.y + canvasBox.height / 2);
    await sleep(120);
    await page.touchscreen.touchMove(canvasBox.x + canvasBox.width * 0.82, canvasBox.y + canvasBox.height / 2);
    await sleep(800);
    st = await debugState(page);
    await page.touchscreen.touchEnd();
    ok(st.pos.x > x0 + 0.4, `touch-drag tilts the board — marble rolled ${x0.toFixed(2)} → ${st.pos.x.toFixed(2)}`);
    await shot(page, '4-rolling');

    // IRON SMASH: momentum through the cracked barrier at (4,4).
    const scoreBefore = (await debugState(page)).score;
    await page.evaluate(() => {
      window.__madronaDebug.setTilt(0, 0);
      window.__madronaDebug.teleport(4.5, 3.4);
      window.__madronaDebug.setVel(0, 5);
    });
    await sleep(700);
    st = await debugState(page);
    ok(st.barriers === 1, `iron at speed shatters the barrier (2 → ${st.barriers})`);
    ok(st.score >= scoreBefore + 150, `smash chips paid (${scoreBefore} → ${st.score})`);

    // Roll onto the emerald: run ends, the plaque prints.
    await page.evaluate(() => {
      window.__madronaDebug.teleport(7.5, 8.6);
      window.__madronaDebug.setVel(0, 5);
    });
    await page.waitForFunction(
      'window.__madronaDebug && window.__madronaDebug.getState().status === "over"',
      { timeout: 8_000 },
    );
    ok(true, 'reaching the emerald ends the run');
    await page.waitForFunction(seeing('TRAIL REPORT'), { timeout: 8_000 });
    ok(await page.evaluate(seeing('TOTAL CHIPS')), 'plaque itemizes the total');
    await shot(page, '5-plaque');

    await tapWhenStill(page, 'Claim');
    await page.waitForFunction(`!${seeing('TRAIL REPORT')}`, { timeout: 5_000 });
    ok(true, 'claim dismisses the modal');
    const best = await page.evaluate(() => Number(localStorage.getItem('arena.madrona.best')) || 0);
    ok(best > 0, `claimed chips GT-merge into the local best (${best})`);
    await shot(page, '6-after-claim');

    console.log('\nReduced motion — card and modal still render without the springs');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });
    await page.waitForFunction(seeing('MADRONA WOOD LABYRINTH'), { timeout: 5_000 });
    await tapWhenStill(page, '▶ PLAY');
    await page.waitForFunction(seeing('KNOT-HOLES'), { timeout: 5_000 });
    ok(true, 'reduced-motion intro reaches the legend');
    await shot(page, '7-reduced-motion');

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
