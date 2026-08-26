/* test-madrona-smoke.js — E2E smoke for the Madrona Wood Labyrinth cabinet.
 *
 * Builds the harness in emerald-arcade/smoke-madrona/ (Vite + Tailwind from
 * arena/node_modules) and drives the full flow touch-emulated:
 *   intro → marble inventory (3 cards, steel equipped) → equip IRON →
 *   ROLL OUT → engine renders (canvas pixel check) → REAL touch-drag tilts
 *   the board and the marble actually rolls → via the ?madronaDebug sim
 *   handle: iron at speed SHATTERS a cracked barrier (collision box gone,
 *   smash chips paid, plow-through position) → glass at the same speed
 *   BOUNCES (barrier survives) → glass rolls onto the emerald → run ends →
 *   trail-report plaque → claim → done view with the bank credited.
 *
 * Usage: node test-madrona-smoke.js
 * The module ships nowhere yet, but run this before wiring the labyrinth
 * into any tester-facing host or touching emerald-arcade/src/minigames/madrona.
 */
const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const SMOKE_DIR = path.join(ROOT, 'emerald-arcade', 'smoke-madrona');
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

const debugState = (page) =>
  page.evaluate(() => window.__madronaDebug && window.__madronaDebug.getState());

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
  check(true, 'harness builds (vite + tailwind, arena-hoisted toolchain)');

  // ---- serve dist ---------------------------------------------------------
  const server = http
    .createServer((req, res) => {
      const pathname = req.url.split('?')[0];
      const url = pathname === '/' ? '/index.html' : pathname;
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
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/?madronaDebug`, { waitUntil: 'networkidle0' });

  // ---- intro + marble inventory ------------------------------------------
  await page.waitForSelector('[data-testid="madrona-start"]', { timeout: 8000 });
  check(true, 'intro renders (ROLL OUT visible)');

  await tap(page, '[data-testid="madrona-choose"]');
  await page.waitForSelector('[data-testid="marble-inventory"]', { timeout: 5000 });
  const cardCount = await page.$$eval('[data-testid^="marble-card-"]', (els) => els.length);
  check(cardCount === 3, `inventory shows 3 marble cards (got ${cardCount})`);
  const steelSelected = await page.$eval(
    '[data-testid="marble-card-steel"]',
    (el) => el.getAttribute('data-selected'),
  );
  check(steelSelected === 'true', 'steel equipped by default');

  await tap(page, '[data-testid="marble-card-iron"]');
  await page.waitForSelector('[data-testid="marble-inventory"]', { hidden: true, timeout: 5000 });
  check(true, 'selecting a marble closes the inventory');

  // ---- start the run ------------------------------------------------------
  await tap(page, '[data-testid="madrona-start"]');
  await page.waitForFunction(() => !!window.__madronaDebug, { timeout: 8000 });
  await sleep(300);
  let st = await debugState(page);
  check(st && st.status === 'running', 'physics running after ROLL OUT');
  check(st && st.marble === 'iron', `iron equipped in the game loop (got ${st && st.marble})`);
  check(st && st.barriers === 2, `2 destructible barriers on the board (got ${st && st.barriers})`);

  // Engine actually paints: the board is not a flat sheet of one color.
  const distinct = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return 0;
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4096) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return seen.size;
  });
  check(distinct > 4, `canvas renders the board (${distinct} sampled colors)`);

  // ---- REAL touch tilt: hold right of centre, the marble must roll -------
  const canvasBox = await (await page.$('canvas')).boundingBox();
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  const x0 = (await debugState(page)).pos.x;
  await page.touchscreen.touchStart(cx + canvasBox.width * 0.3, cy);
  await sleep(120);
  await page.touchscreen.touchMove(cx + canvasBox.width * 0.32, cy);
  await sleep(800);
  st = await debugState(page);
  await page.touchscreen.touchEnd();
  check(st.pos.x > x0 + 0.4, `touch-drag tilts the board — marble rolled ${x0.toFixed(2)} → ${st.pos.x.toFixed(2)}`);

  // ---- IRON SMASH: momentum through the cracked barrier at (4,4) ---------
  const scoreBefore = (await debugState(page)).score;
  await page.evaluate(() => {
    window.__madronaDebug.setTilt(0, 0);
    window.__madronaDebug.teleport(4.5, 3.4);
    window.__madronaDebug.setVel(0, 5);
  });
  await sleep(700);
  st = await debugState(page);
  check(st.barriers === 1, `iron at speed shatters the barrier (barriers 2 → ${st.barriers})`);
  check(st.smashed === 1, `smash counted (${st.smashed})`);
  check(st.score >= scoreBefore + 150, `smash chips paid (${scoreBefore} → ${st.score})`);
  check(st.pos.y > 4.4, `marble plowed THROUGH the plank (y=${st.pos.y.toFixed(2)})`);

  // ---- GLASS BOUNCE: same speed, zero breakPower, barrier survives -------
  await page.evaluate(() => {
    window.__madronaDebug.setMarble('glass');
    window.__madronaDebug.teleport(2.4, 9.5);
    window.__madronaDebug.setVel(6, 0);
  });
  await sleep(600);
  st = await debugState(page);
  check(st.marble === 'glass', 'mid-run swap to glass reached the loop');
  check(st.barriers === 1, `glass cannot break barriers (still ${st.barriers} standing)`);
  check(st.smashed === 1, 'no phantom smash credited');
  check(st.pos.x < 3.0, `glass ricocheted off the plank (x=${st.pos.x.toFixed(2)})`);

  // ---- ROLL ONTO THE EMERALD ---------------------------------------------
  await page.evaluate(() => {
    window.__madronaDebug.teleport(7.5, 8.6);
    window.__madronaDebug.setVel(0, 5);
  });
  await page.waitForFunction(
    () => window.__madronaDebug && window.__madronaDebug.getState().status === 'over',
    { timeout: 6000 },
  );
  check(true, 'reaching the emerald ends the run');

  await page.waitForSelector('[data-testid="madrona-results"]', { timeout: 8000 });
  await sleep(1500); // plaque spring settles
  const total = await page.$eval('[data-testid="madrona-total"]', (el) =>
    parseInt(el.textContent.replace(/[^0-9]/g, ''), 10),
  );
  check(total >= 400, `trail report totals gems+smash+bonus (${total} chips)`);

  // ---- claim → bank -------------------------------------------------------
  await tap(page, '[data-testid="madrona-claim"]');
  await page.waitForSelector('[data-testid="madrona-bank"]', { timeout: 8000 });
  const bank = await page.$eval('[data-testid="madrona-bank"]', (el) => el.textContent);
  check(bank === `bank:${total}`, `claim banked exactly the plaque total (${bank})`);

  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ':\n' + pageErrors.join('\n') : ''}`);

  await browser.close();
  server.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FAIL  smoke crashed:', e);
  process.exit(1);
});
