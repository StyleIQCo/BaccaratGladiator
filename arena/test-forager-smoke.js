#!/usr/bin/env node
// Puget Sound Forager smoke — touch-emulated walkthrough of the
// 🦪 SOUND FORAGER Demo Hub tab: the demo card renders, the modal
// opens on the quota intro, a full (shortened) run plays on the real
// canvas with a hop through ALL THREE zones (mudflat taps, a pot drop
// off the dock, a reel press in deep water), and the results card
// closes the loop. Same serving + tap conventions as the other arena
// smokes: real browser, touchscreen taps, so z-index and overlay
// regressions surface the way they would on a phone. A pageerror
// counter guards the canvas game loop — any runtime throw in
// physics/render fails the run.
//
// NB: a 6-second run can't fill the boil quota, so this exercises the
// consolation ("Tide's Out") path; the BOIL BONANZA cinematic has no
// automated coverage yet and needs a manual pass before any deploy
// that leans on it.
//
// Prereq: a built bundle. Point DIST_DIR at a snapshot build — deploys
// sync from a snapshot of dist/, never live dist/ (parallel builds in
// this shared worktree have caused HTML↔asset hash mismatches), so
// test the same snapshot you're about to ship.
//
// Usage:
//   node test-forager-smoke.js                        # PORT=4947 default
//   DIST_DIR=/path/to/dist node test-forager-smoke.js
//   SHOTS_DIR=/tmp/shots node test-forager-smoke.js   # also save PNGs
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

/** Centre of the live game canvas (throws if none mounted). */
async function canvasCenter(page) {
  const r = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const b = c.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  if (!r) throw new Error('no canvas mounted');
  return r;
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
  console.log(`\nForager smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    let pageErrors = 0;
    page.on('pageerror', e => { pageErrors++; console.log('  [pageerror] ' + e.message); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    // forageRun=6: a 6-second tide so the whole play→results→claim loop
    // fits the smoke (the boil quota is unfillable — see header note).
    await page.goto(`http://127.0.0.1:${PORT}/arena/?forageRun=6`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });

    console.log('\nSOUND FORAGER tab — demo card');
    await tap(page, 'SOUND FORAGER');
    await page.waitForFunction(seeing('THE PUGET SOUND FORAGER'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('BEST HAUL')), 'demo card shows the best-haul stat');
    ok(await page.evaluate(seeing('CHIPS CLAIMED')), 'demo card shows the claimed-chips stat');
    await shot(page, '1-forager-tab');

    console.log('\nIntro — quota legend');
    await tapWhenStill(page, '▶ PLAY');
    // The quota legend only exists inside the modal intro — wait on it,
    // not on the title (the demo card behind repeats the title).
    await page.waitForFunction(seeing('Dungeness'), { timeout: 5_000 });
    ok(await page.evaluate(seeing('King Salmon')), 'legend lists the king salmon');
    ok(await page.evaluate(seeing('Geoduck')), 'legend lists the geoduck');
    // NB: the bonus line is styled `uppercase`? No — but the button is:
    // innerText reflects rendered casing, textContent keeps source casing.
    ok(await page.evaluate(seeing('25,000')), 'boil bonus advertised');
    await shot(page, '2-intro');

    console.log('\nRun — hop through all three zones on the one canvas');
    await tapWhenStill(page, 'Low Tide');
    await page.waitForFunction(seeing('MUDFLATS'), { timeout: 5_000 });
    ok(await page.evaluate(() => !!document.querySelector('canvas')), 'game canvas mounted');
    ok(await page.evaluate(seeing('0/10')), 'HUD tracker starts at 0/10 clams');
    // Zone 1: whack the flat a few times (bubble catches are a bonus,
    // the assertion is "the tap path doesn't throw").
    const c1 = await canvasCenter(page);
    await page.touchscreen.tap(c1.x, c1.y);
    await sleep(250);
    await page.touchscreen.tap(c1.x - 60, c1.y + 40);
    await sleep(250);
    await shot(page, '3-mudflats');
    // Zone 2: dock — a canvas tap is aim+release, which commits a drop.
    await tap(page, 'THE DOCK');
    await sleep(300);
    const c2 = await canvasCenter(page);
    await page.touchscreen.tap(c2.x, c2.y);
    await sleep(400);
    await shot(page, '4-dock');
    // Zone 3: deep water — tap = a press/release on the reel.
    await tap(page, 'DEEP WATER');
    await sleep(300);
    const c3 = await canvasCenter(page);
    await page.touchscreen.tap(c3.x, c3.y);
    await shot(page, '5-deep');

    // Results mount when the 6s tide runs out. Tailwind `uppercase` on
    // the headline means innerText renders "TIDE'S OUT!".
    await page.waitForFunction(seeing("TIDE'S OUT"), { timeout: 15_000 });
    ok(true, 'run ended → consolation card appears');
    ok(await page.evaluate(seeing('/10')), 'haul recap shows quota fractions');
    await shot(page, '6-results');

    // Sell the haul (or Done on an empty run) — modal closes either way.
    const btn = (await page.evaluate(seeing('SELL THE HAUL'))) ? 'Sell the Haul' : 'Done';
    await tapWhenStill(page, btn);
    await page.waitForFunction(`!${seeing("TIDE'S OUT")}`, { timeout: 5_000 });
    ok(true, `results dismissed via ${btn}`);
    ok(await page.evaluate(seeing('BEST HAUL')), 'back on the demo card');
    await shot(page, '7-after-claim');

    console.log('\nReduced motion — full loop again without the springs');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });
    await tap(page, 'SOUND FORAGER');
    await page.waitForFunction(seeing('THE PUGET SOUND FORAGER'), { timeout: 5_000 });
    await tapWhenStill(page, '▶ PLAY');
    await page.waitForFunction(seeing('Dungeness'), { timeout: 5_000 });
    await tapWhenStill(page, 'Low Tide');
    await page.waitForFunction(seeing('MUDFLATS'), { timeout: 5_000 });
    await page.waitForFunction(seeing("TIDE'S OUT"), { timeout: 15_000 });
    ok(true, 'reduced-motion run reaches results');
    await shot(page, '8-reduced-motion');

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
