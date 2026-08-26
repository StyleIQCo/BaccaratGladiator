/* Emerald City Claw headless smoke.
 *
 * Builds the harness (Vite from arena/node_modules, Tailwind wired),
 * serves dist, then drives the REAL game touch-emulated:
 *   intro → INSERT TOKEN → canvas + ?eadebug sim handle → paint check →
 *   [◀]/[▶] hold-buttons actually move the trolley → an auto-player
 *   drags the glass to park the claw over the easiest exposed prize,
 *   taps DROP CLAW, and rides the full state machine (dropping →
 *   grabbing → retracting → transporting → releasing) for all 4
 *   tokens → prize cards stashed → haul screen → CLAIM → onClaim.
 *
 * The machine is seeded (seed=7 in main.tsx) so the pile is
 * deterministic; grip RNG can still miss, so a 0-chip run triggers ONE
 * full replay (reload) before failing — same policy as the cherry smoke.
 *
 * Usage: node emerald-arcade/smoke/claw/run.js
 */
const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(__dirname, '../../../node_modules/puppeteer'));

const HERE = __dirname;
const DIST = path.join(HERE, 'dist');
const VITE = path.join(HERE, '../../../arena/node_modules/.bin/vite');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIM = `document.querySelector('[data-testid="claw-canvas"]').__clawSim`;

async function sim(page) {
  return page.evaluate(`(() => {
    const s = ${SIM};
    return s
      ? { phase: s.phase, trolleyX: s.trolleyX, tokensLeft: s.tokensLeft, chips: s.chips,
          items: s.items, prizes: s.prizes, heldType: s.heldType }
      : null;
  })()`);
}

async function tap(page, selector) {
  const el = await page.waitForSelector(selector, { timeout: 8000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`no boundingBox for ${selector}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Hold a touch on a selector for ms, then release. */
async function hold(page, selector, ms) {
  const el = await page.waitForSelector(selector, { timeout: 8000 });
  const box = await el.boundingBox();
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(ms);
  await page.touchscreen.touchEnd();
}

/** If a prize card is up, stash it. Returns true if one was collected.
 *  A card mid-exit-animation still matches the selector for ~0.5s, so
 *  re-check after the entrance sleep and tolerate a vanishing button. */
async function collectPrizeCard(page) {
  if (!(await page.$('[data-testid="claw-prize-collect"]'))) return false;
  await sleep(700); // card entrance spring
  try {
    const btn = await page.$('[data-testid="claw-prize-collect"]');
    if (!btn) return false;
    const box = await btn.boundingBox();
    if (!box) return false;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } catch {
    return false; // the card finished exiting under us — nothing to stash
  }
  await sleep(400);
  return true;
}

/** One full seeded game. Returns { chips, prizes, phasesSeen, aligned }. */
async function playRun(page, port, errors) {
  await page.goto(`http://127.0.0.1:${port}/?eadebug=1`, { waitUntil: 'networkidle0' });

  // Intro → INSERT TOKEN.
  await page.waitForSelector('[data-testid="claw-intro"]', { timeout: 8000 });
  await sleep(900); // entrance spring
  await tap(page, '[data-testid="claw-start"]');

  // Canvas + debug sim handle.
  await page.waitForSelector('[data-testid="claw-canvas"]', { timeout: 8000 });
  await page.waitForFunction(`!!${SIM}`, { timeout: 8000 });
  const s0 = await sim(page);
  check(s0.items.length === 11, `pile seeded (${s0.items.length}/11 items)`);
  check(s0.phase === 'idle' && s0.tokensLeft === 4, `machine idle with 4 tokens (${s0.phase}, ${s0.tokensLeft})`);

  // The engine is painting the scene.
  await sleep(600);
  const distinct = await page.$eval('[data-testid="claw-canvas"]', (c) => {
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 397) {
      seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    }
    return seen.size;
  });
  check(distinct >= 12, `canvas is painting the cabinet (${distinct} distinct sampled colors)`);

  // Direction buttons drive the trolley motor. Let the carriage coast to
  // a stop after each release — momentum drift would poison the readings.
  const xBefore = (await sim(page)).trolleyX;
  await hold(page, '[data-testid="claw-right"]', 550);
  await sleep(400);
  const xRight = (await sim(page)).trolleyX;
  check(xRight > xBefore + 10, `[▶] hold moves the claw right (${xBefore.toFixed(0)} → ${xRight.toFixed(0)})`);
  await hold(page, '[data-testid="claw-left"]', 600);
  await sleep(400);
  const xLeft = (await sim(page)).trolleyX;
  check(xLeft < xRight - 10, `[◀] hold moves the claw left (${xRight.toFixed(0)} → ${xLeft.toFixed(0)})`);

  // Auto-player: for each token, drag the glass to park over the easiest
  // exposed prize, then DROP. Poll the phase fast enough to log every
  // state-machine stop along the way.
  const phasesSeen = new Set();
  let aligned = false;
  const deadline = Date.now() + 110000;

  const pollPhases = setInterval(async () => {
    try {
      const s = await sim(page);
      if (s) phasesSeen.add(s.phase);
    } catch {
      /* page navigating */
    }
  }, 60);

  while (Date.now() < deadline) {
    if (await collectPrizeCard(page)) continue;
    const s = await sim(page);
    if (!s) break;
    if (s.phase === 'over') break;
    if (s.phase !== 'idle') {
      await sleep(250);
      continue;
    }
    if (s.tokensLeft === 0) {
      await sleep(250);
      continue;
    }

    // Pick a target: easiest grips first, prefer exposed (nothing on top).
    const target = await page.evaluate(`(() => {
      const c = document.querySelector('[data-testid="claw-canvas"]');
      const s = c.__clawSim;
      const pri = { 'rainier-can': 0, 'kraken-plush': 1, 'fremont-troll': 2,
                    'space-needle': 3, 'flying-salmon': 4, 'chihuly-orb': 5 };
      const items = s.items.filter((it) => it.x > s.chuteWallX + 14);
      const exposed = items.filter(
        (it) => !items.some((o) => o !== it && Math.abs(o.x - it.x) < it.r && o.y < it.y - 4),
      );
      const pool = (exposed.length ? exposed : items)
        .slice()
        .sort((a, b) => pri[a.type] - pri[b.type] || a.y - b.y);
      if (!pool.length) return null;
      const t = pool[0];
      const v = s.view;
      const rect = c.getBoundingClientRect();
      return {
        worldX: t.x,
        type: t.type,
        px: rect.left + v.ox + t.x * v.s,
        py: rect.top + v.oy + 200 * v.s,
      };
    })()`);
    if (!target) break;

    // Drag the glass: hold a touch at the target X until the trolley eases under it.
    await page.touchscreen.touchStart(target.px, target.py);
    const dragEnd = Date.now() + 3000;
    let converged = false;
    while (Date.now() < dragEnd) {
      const cur = await sim(page);
      if (Math.abs(cur.trolleyX - target.worldX) < 3) {
        converged = true;
        break;
      }
      await sleep(90);
    }
    await page.touchscreen.touchEnd();
    if (converged) aligned = true;
    await sleep(200);

    const before = await sim(page);
    await tap(page, '[data-testid="claw-drop"]');
    await sleep(300);
    const after = await sim(page);
    if (after.phase === 'idle' && after.tokensLeft === before.tokensLeft) {
      // Drop refused (shouldn't happen over the pit) — try again.
      continue;
    }

    // Ride the cycle out (prize cards handled at loop top).
    await page
      .waitForFunction(
        `(() => { const s = ${SIM}; return s && (s.phase === 'idle' || s.phase === 'over'); })()`,
        { timeout: 25000 },
      )
      .catch(() => {});
  }
  clearInterval(pollPhases);

  check(aligned, 'glass-drag steering parked the claw over a target (±3 units)');
  for (const p of ['dropping', 'grabbing', 'retracting', 'transporting', 'releasing']) {
    check(phasesSeen.has(p), `state machine reached ${p.toUpperCase()}`);
  }

  // Wait out the final cycle → haul screen (stash any straggler cards).
  const resultsDeadline = Date.now() + 20000;
  while (Date.now() < resultsDeadline) {
    if (await collectPrizeCard(page)) continue;
    if (await page.$('[data-testid="claw-results"]')) break;
    await sleep(300);
  }
  const results = await page.$('[data-testid="claw-results"]');
  check(!!results, 'out of tokens → haul screen');
  if (!results) return { chips: 0, prizes: [] };

  const final = await sim(page);
  const shown = await page.$eval('[data-testid="claw-final-chips"]', (n) =>
    Number(n.textContent.replace(/[^0-9]/g, '')),
  );
  check(shown === final.chips, `haul total matches the sim (${shown} vs ${final.chips})`);
  return { chips: final.chips, prizes: final.prizes };
}

(async () => {
  // ---- build --------------------------------------------------------------
  if (!fs.existsSync(VITE)) {
    console.log(`FAIL  vite not found at ${VITE} — run npm install in arena/`);
    process.exit(1);
  }
  const build = spawnSync(VITE, ['build'], { cwd: HERE, encoding: 'utf8' });
  if (build.status !== 0) {
    console.log('FAIL  harness build failed:\n' + (build.stderr || build.stdout));
    process.exit(1);
  }
  check(true, 'harness builds (vite + tailwind, arena-hoisted toolchain)');

  // ---- serve --------------------------------------------------------------
  const server = http
    .createServer((req, res) => {
      const pathname = req.url.split('?')[0];
      const file = path.join(DIST, pathname === '/' ? '/index.html' : pathname);
      if (!file.startsWith(DIST) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    })
    .listen(0);
  const port = server.address().port;

  const browser = await puppeteer.launch({ headless: 'new', args: ['--mute-audio'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

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
    let run = await playRun(page, port, pageErrors);
    if (run.chips === 0) {
      // Grip RNG can zero a run even with good aim; a second seeded run
      // coming up empty means the grab mechanic is genuinely broken.
      console.log('      (0 chips on run 1 — replaying once to rule out grip RNG)');
      run = await playRun(page, port, pageErrors);
    }
    check(run.chips > 0, `auto-player won prizes — grab mechanic works (chips=${run.chips}, prizes=${run.prizes.length})`);

    // Claim → chips reach the host.
    await sleep(400);
    await tap(page, '[data-testid="claw-claim"]');
    await page.waitForFunction(() => window.__smoke.claimed !== null, { timeout: 8000 });
    const smoke = await page.evaluate(() => window.__smoke);
    check(smoke.claimed === run.chips, `onClaim delivered the haul (${smoke.claimed} vs ${run.chips})`);
    check(smoke.closed === true, 'claim closes the modal (onClose fired)');

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
