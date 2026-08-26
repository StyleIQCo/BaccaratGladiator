/* test-emerald-arcade-smoke.js — E2E smoke for the emerald-arcade/ module.
 *
 * Builds the harness in emerald-arcade/smoke/ (Vite from arena/node_modules)
 * and drives the full flow touch-emulated:
 *   hub (one card per config entry, lock states honored, tickets 3/3) →
 *   locked-card rejection →
 *   cherry card expansion → INSERT COIN → RainierCherryGame ready overlay →
 *   start → engine renders (canvas pixel checks) → basket follows a held
 *   touch → auto-player chases cherries via the ?eadebug sim handle and
 *   must actually CATCH some → 8s run ends → TIME! overlay → collect →
 *   back to hub with the ticket spent and chips banked.
 *
 * Usage: node test-emerald-arcade-smoke.js
 * The module ships nowhere yet, but run this before wiring it into any
 * tester-facing host or touching emerald-arcade/src.
 */
const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const SMOKE_DIR = path.join(ROOT, 'emerald-arcade', 'smoke');
const DIST = path.join(SMOKE_DIR, 'dist');
const VITE = path.join(ROOT, 'arena', 'node_modules', '.bin', 'vite');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Scroll the target to the carousel center first — offscreen snap-scroll
// cards have a boundingBox you can't physically tap.
async function tap(page, selector) {
  const el = await page.waitForSelector(selector, { timeout: 8000 });
  await el.evaluate((n) => n.scrollIntoView({ inline: 'center', block: 'nearest' }));
  await sleep(350);
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
  check(true, 'harness builds (vite, arena-hoisted toolchain)');

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
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() && msg.location().url) || '';
    if (url.includes('favicon.ico')) return;
    consoleErrors.push(`${msg.text()} @ ${url}`);
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/?eadebug=1`, { waitUntil: 'networkidle0' });

    // --- Hub -----------------------------------------------------------------
    await page.waitForSelector('[data-testid="arcade-hub"]', { timeout: 8000 });
    check(true, 'hub renders');
    await sleep(1100); // card entrance stagger

    // Expected counts come from the config module (exposed by the harness),
    // so a new emeraldArcadeData.ts entry is enough — no test edits.
    const expected = await page.evaluate(() => ({
      total: window.__EA_GAMES.length,
      locked: window.__EA_GAMES.filter((g) => !g.isUnlocked).length,
    }));
    const cardCount = await page.$$eval('[data-testid^="arcade-card-"]', (ns) => ns.length);
    check(
      cardCount === expected.total,
      `one card per config entry (${cardCount}/${expected.total})`,
    );
    const lockedCount = await page.$$eval(
      '[data-testid^="arcade-card-"][data-locked="true"]',
      (ns) => ns.length,
    );
    check(
      lockedCount === expected.locked,
      `lock states honored (${lockedCount}/${expected.locked} locked)`,
    );

    const tickets0 = await page.$eval('[data-testid="arcade-ticket-count"]', (n) => n.textContent);
    check(tickets0.trim() === '3/3', `daily tickets tracker reads 3/3 ("${tickets0.trim()}")`);

    // Locked card: expands with COMING SOON and a dead play button.
    await tap(page, '[data-testid="arcade-card-salmon-run-ladder"]');
    await page.waitForSelector('[data-testid="arcade-expanded"]', { timeout: 8000 });
    await sleep(500); // expansion spring
    const lockedBtn = await page.$eval('[data-testid="arcade-play-btn"]', (n) => [
      n.disabled,
      n.textContent,
    ]);
    check(
      lockedBtn[0] === true && /Coming Soon/i.test(lockedBtn[1]),
      `locked game refuses play ("${lockedBtn[1].trim()}")`,
    );
    await tap(page, '[data-testid="arcade-expanded-close"]');
    await sleep(500);

    // Cherry picker: coin insert → expansion → play.
    await tap(page, '[data-testid="arcade-card-rainier-cherry-picker"]');
    await page.waitForSelector('[data-testid="arcade-expanded"]', { timeout: 8000 });
    await sleep(500);
    const playBtn = await page.$eval('[data-testid="arcade-play-btn"]', (n) => [
      n.disabled,
      n.textContent,
    ]);
    check(
      playBtn[0] === false && /Insert Coin/i.test(playBtn[1]),
      `unlocked game arms INSERT COIN ("${playBtn[1].trim()}")`,
    );
    await tap(page, '[data-testid="arcade-play-btn"]');

    // --- Game: ready → playing ----------------------------------------------
    await page.waitForSelector('[data-testid="cherry-ready"]', { timeout: 8000 });
    check(true, 'launch → cherry picker ready overlay');
    await tap(page, '[data-testid="cherry-start"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="cherry-ready"]'),
      { timeout: 8000 },
    );
    check(true, 'start tap dismisses ready overlay');

    // Hold a touch at x=60 — the basket must lerp over and stay pinned.
    await sleep(500);
    await page.touchscreen.touchStart(60, 600);
    await sleep(1100);

    // Engine renders: the canvas backdrop + sprites give many distinct colors.
    const distinct = await page.$eval('[data-testid="cherry-canvas"]', (c) => {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 397) {
        seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      }
      return seen.size;
    });
    check(distinct >= 12, `canvas is painting the scene (${distinct} distinct sampled colors)`);

    // Basket-follows-drag: a strip at the held x must show woven-basket browns.
    const strip = await page.$eval('[data-testid="cherry-canvas"]', (c) => {
      const ctx = c.getContext('2d');
      const dpr = c.width / c.clientWidth;
      const top = c.clientHeight - Math.max(c.clientHeight * 0.13, 92);
      const y = Math.round((top + 16) * dpr);
      return [48, 54, 60, 66, 72].map((cssX) => {
        const d = ctx.getImageData(Math.round(cssX * dpr), y, 1, 1).data;
        return [d[0], d[1], d[2]];
      });
    });
    const brownHits = strip.filter(
      ([r, g, b]) => r >= 120 && g >= 60 && b <= 115 && r > g && g > b,
    ).length;
    check(brownHits >= 2, `basket followed the held touch (${brownHits}/5 brown samples at x=60)`);

    // Auto-player: keep the touch held and steer it under the lowest good
    // cherry (read from the ?eadebug sim handle) until the run ends.
    const chaseUntilOver = async () => {
      const chaseDeadline = Date.now() + 14000;
      while (Date.now() < chaseDeadline) {
        if (await page.$('[data-testid="cherry-over"]')) break;
        const targetX = await page.$eval('[data-testid="cherry-canvas"]', (c) => {
          const sim = c.__eaSim;
          if (!sim) return null;
          const good = sim.cherries.filter(
            (ch) => ch.kind !== 'rotten' && ch.y < c.clientHeight * 0.78,
          );
          if (!good.length) return null;
          good.sort((a, b) => b.y - a.y); // lowest = lands soonest
          return good[0].x;
        });
        if (targetX != null) await page.touchscreen.touchMove(targetX, 600);
        await sleep(120);
      }
      try {
        await page.touchscreen.touchEnd();
      } catch {
        /* touch may already be gone */
      }
      await page.waitForSelector('[data-testid="cherry-over"]', { timeout: 12000 });
      return page.$eval('[data-testid="cherry-canvas"]', (c) =>
        c.__eaSim ? c.__eaSim.caught : -1,
      );
    };

    // --- Game over → collect -------------------------------------------------
    let caught = await chaseUntilOver();
    check(true, '8s run ends → TIME! overlay');
    if (caught === 0) {
      // Spawn RNG can starve one short run of catchable cherries; a second
      // 0-catch run means the mechanic is genuinely broken.
      console.log('      (0 catches on run 1 — replaying once to rule out spawn RNG)');
      await tap(page, '[data-testid="cherry-replay"]');
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="cherry-over"]'),
        { timeout: 8000 },
      );
      await sleep(400);
      await page.touchscreen.touchStart(195, 600);
      caught = await chaseUntilOver();
    }
    check(caught >= 1, `auto-player caught cherries — catch mechanic works (caught=${caught})`);
    const finalScore = Number(
      (await page.$eval('[data-testid="cherry-final-score"]', (n) => n.textContent)).trim(),
    );
    check(Number.isInteger(finalScore) && finalScore >= 0, `final score is a number (${finalScore})`);
    const chipsText = await page.$eval('[data-testid="cherry-chips"]', (n) => n.textContent);
    check(/chips earned/i.test(chipsText), `chips payout shown ("${chipsText.trim()}")`);

    await tap(page, '[data-testid="cherry-collect"]');
    await page.waitForSelector('[data-testid="arcade-hub"]', { timeout: 8000 });
    check(true, 'collect → back to hub');
    const tickets1 = await page.$eval('[data-testid="arcade-ticket-count"]', (n) => n.textContent);
    check(tickets1.trim() === '2/3', `ticket spent (tracker reads "${tickets1.trim()}")`);
    const bank = await page.$eval('[data-testid="chip-bank"]', (n) => n.textContent);
    check(bank.trim() === `bank:${finalScore}`, `chips banked by host ("${bank.trim()}")`);

    // --- Runtime hygiene -----------------------------------------------------
    check(pageErrors.length === 0, `zero page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
    check(consoleErrors.length === 0, `zero console errors${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
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
