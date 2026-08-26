#!/usr/bin/env node
// Whale Watch smoke — touch-emulated walkthrough of the 🐋 WHALE WATCH
// Demo Hub tab: the demo card renders, the ?game=whales deep link lands
// on the tab, the challenge modal opens, a full (shortened) run plays on
// the real canvas with hold/release taps exercised, and the GOLDEN HOUR
// results card logs the voyage. Same serving + tap conventions as
// test-fishtoss-smoke.js: real browser, touchscreen taps, so z-index
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
//   node test-whalewatch-smoke.js                        # PORT=4945 default
//   DIST_DIR=/path/to/dist node test-whalewatch-smoke.js
//   SHOTS_DIR=/tmp/shots node test-whalewatch-smoke.js   # also save PNGs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST_DIR || join(HERE, 'web', 'dist');
const FLAGS = join(HERE, 'config', 'flags.json');
const PORT = Number(process.env.PORT) || 4945;
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
  console.log(`\nWhale Watch smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    let pageErrors = 0;
    page.on('pageerror', e => { pageErrors++; console.log('  [pageerror] ' + e.message); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    // whaleRun=4: a 4-second sunset so the whole play→results→log loop
    // fits the smoke. ?game=whales also exercises the deep link.
    await page.goto(`http://127.0.0.1:${PORT}/arena/?game=whales&whaleRun=4`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });

    console.log('\nWHALE WATCH tab — deep link + demo card');
    // NB: headers are styled with Tailwind `uppercase`, and innerText
    // reflects text-transform — assert the RENDERED casing.
    await page.waitForFunction(seeing('SALISH SEA WHALE WATCH'), { timeout: 5_000 });
    ok(true, '?game=whales deep link lands on the tab');
    ok(await page.evaluate(seeing('BEST WATCH')), 'demo card shows the best-watch stat');
    await shot(page, '1-whales-tab');

    console.log('\nChallenge modal — intro → a full (4s) run → results');
    await tapWhenStill(page, '▶ PLAY');
    // Legend rows carry no text-transform — source casing renders as-is.
    await page.waitForFunction(seeing('Humpback Tail Slap (hangs)'), { timeout: 5_000 });
    ok(await page.evaluate(seeing("Dall's Porpoise (fast & low)")), 'legend lists the porpoise');
    ok(await page.evaluate(seeing('Orca (big arc)')), 'legend lists the orca');
    await shot(page, '2-intro');
    // NB: tap targets match on textContent (SOURCE casing) — the CSS
    // `uppercase` only affects innerText, which `seeing()` uses.
    await tapWhenStill(page, 'Push Off');
    // The canvas is now live. Tap-hold twice so the paddle/hold/release
    // pointer path runs at least once during the shortened watch.
    await sleep(500);
    await page.touchscreen.tap(120, 500);
    await sleep(600);
    await page.touchscreen.tap(280, 500);
    // GOLDEN HOUR mounts when the 4-second sun goes down.
    await page.waitForFunction(seeing('GOLDEN HOUR'), { timeout: 12_000 });
    ok(true, 'sunset ended the run → GOLDEN HOUR results card appears');
    ok(await page.evaluate(seeing('chips')), 'results card shows the chip tally');
    await shot(page, '3-results');

    // Log the voyage (or Done on a zero-chip run) — modal closes either way.
    const btn = (await page.evaluate(seeing('LOG THE VOYAGE'))) ? 'Log the Voyage' : 'Done';
    await tapWhenStill(page, btn);
    await page.waitForFunction(`!${seeing('GOLDEN HOUR')}`, { timeout: 5_000 });
    ok(true, `results dismissed via ${btn}`);
    // A scoring run must GT-merge into the demo card's BEST WATCH stat.
    if (btn === 'Log the Voyage') {
      const best = await page.evaluate(() => {
        const m = document.body.innerText.match(/BEST WATCH\s*\n\s*([\d,]+)/);
        return m ? Number(m[1].replace(/,/g, '')) : 0;
      });
      ok(best > 0, `logged voyage GT-merges into best watch (${best})`);
    }
    await shot(page, '4-after-log');

    console.log('\nReduced motion — tab still renders without the motion loops');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('SALISH SEA WHALE WATCH'), { timeout: 10_000 });
    ok(await page.evaluate(seeing('BEST WATCH')), 'reduced-motion card keeps the stat block');
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
