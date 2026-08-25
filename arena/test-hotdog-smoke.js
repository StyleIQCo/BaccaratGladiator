#!/usr/bin/env node
// Hotdog Drop smoke — touch-emulated walkthrough of the 🌭 HOTDOG DROP
// Demo Hub tab. Complements test-arena-e2e.js: this drives the BUILT
// web bundle in a real browser with touchscreen taps, so z-index and
// overlay regressions surface the way they would on a phone.
//
// Flow: the SHARE deep link (?game=hotdog) lands straight on the game
// intro (legend incl. pretzel + beer rows) → DROP IN starts the canvas
// run → touch-drag steers → run ends (timer or hazard) → results
// overlay with Claim + Challenge-a-friend → claim closes the modal,
// persists chips to localStorage, and the launch card is behind it.
//
// The run is shortened via the `?hotdogRun=6` test hook so the full
// loop fits in a smoke-test budget.
//
// Prereq: `npm run build` in web/ (serves web/dist directly, plus
// config/flags.json at the /arena/config path KillSwitchGate fetches).
//
// Usage:
//   node test-hotdog-smoke.js               # PORT=4937 by default
//   SHOTS_DIR=/tmp/shots node test-hotdog-smoke.js   # also save PNGs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
// DIST_DIR lets you point at a snapshot build — deploys sync from a
// snapshot of dist/, so test the same snapshot you're about to ship.
const DIST = process.env.DIST_DIR || join(HERE, 'web', 'dist');
const FLAGS = join(HERE, 'config', 'flags.json');
const PORT = Number(process.env.PORT) || 4937;
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

// ── Touch helpers (same idiom as test-odyssey-smoke.js) ─────────────
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

/** Tap a button once its rect holds still — modal springs move targets. */
async function tapSettled(page, text) {
  let prev = null;
  for (let i = 0; i < 25; i++) {
    const r = await rectOf(page, text);
    if (r && prev && Math.abs(r.x - prev.x) < 0.5 && Math.abs(r.y - prev.y) < 0.5) {
      await page.touchscreen.tap(r.x, r.y);
      return;
    }
    prev = r;
    await new Promise(res => setTimeout(res, 100));
  }
  throw new Error(`tap target never settled: "${text}"`);
}

async function tap(page, text) {
  const r = await rectOf(page, text);
  if (!r) throw new Error(`tap target not found: "${text}"`);
  await page.touchscreen.tap(r.x, r.y);
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
  console.log(`\nHotdog smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    // Enter through the SHARE deep link: ?game=hotdog selects the tab AND
    // auto-opens the intro. 6-second runs via the test hook.
    await page.goto(`http://127.0.0.1:${PORT}/arena/?game=hotdog&hotdogRun=6`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });
    await page.evaluate(() => {
      localStorage.removeItem('arena.hotdog.best');
      localStorage.removeItem('arena.hotdog.chips');
      // Zero-score board: ANY scoring run cracks the top 10, making the
      // signup prompt deterministic whenever the run caught something.
      localStorage.setItem(
        'arena.hotdog.board',
        JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ name: `BOT${i}`, score: 0 }))),
      );
    });

    console.log('\nDeep link + intro modal');
    // NOTE: seeing() reads innerText, which reflects CSS text-transform —
    // the buttons render uppercase, so match "DROP IN!" not "Drop In!".
    // (tap/tapSettled match textContent, which stays as authored.)
    await page.waitForFunction(seeing('DROP IN!'), { timeout: 8_000 });
    ok(true, 'share deep link (?game=hotdog) lands straight on the intro');
    await shot(page, '1-deeplink-intro');
    ok(await page.evaluate(seeing('Bavarian Pretzel')), 'legend lists the pretzel');
    ok(await page.evaluate(seeing('Beer Stein')), 'legend lists the beer stein');
    ok(await page.evaluate(seeing('GAME OVER')), 'legend warns about the burnt dog');
    await shot(page, '2-intro');

    console.log('\nGameplay');
    await tapSettled(page, 'Drop In!');
    await page.waitForSelector('canvas', { visible: true, timeout: 5_000 });
    ok(true, 'DROP IN mounts the game canvas');
    // Steer with real touch drags while the run plays out.
    const canvas = await page.$('canvas');
    const box = await canvas.boundingBox();
    const cy = box.y + box.height * 0.8;
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
    await shot(page, '3-mid-run');

    console.log('\nResults + claim');
    // 6s run (or an early burnt-dog death) → results overlay either way.
    await page.waitForFunction(seeing('CLAIM CHIPS'), { timeout: 15_000 });
    ok(await page.evaluate(seeing('chips!')), 'results overlay shows the chip count');
    ok(await page.evaluate(seeing('CHALLENGE A FRIEND')), 'results overlay offers the share button');
    // Let the score count-up settle, then read the final number: with the
    // zero board, any nonzero run MUST surface the top-10 signup prompt.
    await new Promise(r => setTimeout(r, 1500));
    const caught = await page.evaluate(() => {
      const m = document.body.innerText.match(/([\d,]+)\s*chips!/);
      return m ? Number(m[1].replace(/,/g, '')) : 0;
    });
    if (caught > 0) {
      ok(await page.evaluate(seeing('TOP 10 RUN')), `run caught ${caught} → top-10 signup prompt shows`);
      ok(await page.evaluate(seeing('SIGN UP')), 'signup CTA button is present');
    } else {
      console.log('  – zero-catch run: signup prompt correctly absent (not asserted)');
      ok(!(await page.evaluate(seeing('TOP 10 RUN'))), 'no signup prompt on a zero run');
    }
    await shot(page, '4-results');
    await tapSettled(page, 'Claim Chips');
    await page.waitForFunction(`!${seeing('CLAIM CHIPS')}`, { timeout: 5_000 });
    ok(true, 'claim dismisses the modal');
    const persisted = await page.evaluate(() => ({
      best: localStorage.getItem('arena.hotdog.best'),
      chips: localStorage.getItem('arena.hotdog.chips'),
    }));
    ok(persisted.best !== null && persisted.chips !== null, 'claimed chips persist to localStorage');
    await page.waitForFunction(seeing('CHIPS CLAIMED'), { timeout: 5_000 });
    ok(true, 'launch card is back with the stats row');
    await shot(page, '5-card-after-claim');
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ hotdog smoke green');
  process.exit(failures ? 1 : 0);
})();
