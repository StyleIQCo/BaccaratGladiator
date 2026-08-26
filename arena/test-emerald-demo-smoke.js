#!/usr/bin/env node
// Emerald City Arcade smoke — touch-emulated walkthrough of the
// 🕹️ ARCADE Demo Hub tab: deep-link lands in the SeattleArcadeHub
// overlay, exactly the three host-wired cabinets are unlocked (claw /
// cherry / barista — the host force-locks unrouted ids, so this count
// is invariant no matter how the module's data file grows), the claw
// cabinet launches through INSERT COIN, Tailwind styling actually
// reached the module's wrapper (computed-style probe — an unstyled
// control deck means the content glob broke), one full seeded claw
// cycle runs on the real physics, the daily ticket is spent, and the
// exit path lands back on the demo card. Same serving + tap
// conventions as the other arena smokes; a pageerror counter guards
// the canvas loop.
//
// The deep claw coverage (all 4 tokens, prize cards, haul, claim)
// lives in the module gate: node emerald-arcade/smoke/claw/run.js.
// This smoke proves the ARENA INTEGRATION seams.
//
// Prereq: a built bundle. Point DIST_DIR at a snapshot build — deploys
// sync from a snapshot of dist/, never live dist/.
//
// Usage:
//   node test-emerald-demo-smoke.js                        # PORT=4953
//   DIST_DIR=/path/to/dist node test-emerald-demo-smoke.js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST_DIR || join(HERE, 'web', 'dist');
const FLAGS = join(HERE, 'config', 'flags.json');
const PORT = Number(process.env.PORT) || 4953;

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

const SIM = `document.querySelector('[data-testid="claw-canvas"]').__clawSim`;

async function tap(page, selector) {
  const el = await page.waitForSelector(selector, { timeout: 8000 });
  await el.evaluate(n => n.scrollIntoView({ inline: 'center', block: 'nearest' }));
  await sleep(350);
  const box = await el.boundingBox();
  if (!box) throw new Error(`no boundingBox for ${selector}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log(`\nEmerald Arcade demo smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--mute-audio'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (url.includes('favicon.ico')) return;
    consoleErrors.push(`${m.text()} @ ${url}`);
  });

  try {
    // Deep link straight into the hub; seeded claw; debug sim handle on.
    await page.goto(
      `http://127.0.0.1:${PORT}/arena/?game=arcade&arcadeSeed=7&eadebug=1`,
      { waitUntil: 'networkidle0' },
    );

    // ── Hub overlay via deep link ────────────────────────────────────
    await page.waitForSelector('[data-testid="arcade-hub"]', { timeout: 10000 });
    ok(true, 'deep link ?game=arcade lands in the arcade hub overlay');
    await sleep(1300); // card entrance stagger

    const unlockedIds = await page.$$eval(
      '[data-testid^="arcade-card-"][data-locked="false"]',
      ns => ns.map(n => n.getAttribute('data-testid').replace('arcade-card-', '')).sort(),
    );
    ok(
      unlockedIds.join(',') === 'emerald-city-claw,pike-st-barista-rush,rainier-cherry-picker',
      `exactly the 3 host-wired cabinets are unlocked (${unlockedIds.join(', ')})`,
    );
    const lockedCount = await page.$$eval(
      '[data-testid^="arcade-card-"][data-locked="true"]',
      ns => ns.length,
    );
    ok(lockedCount >= 9, `unrouted data entries render locked (${lockedCount} locked cards)`);

    const tickets0 = await page.$eval('[data-testid="arcade-ticket-count"]', n => n.textContent.trim());
    ok(tickets0 === '3/3', `daily tickets read 3/3 ("${tickets0}")`);

    // ── Launch the claw cabinet ──────────────────────────────────────
    await tap(page, '[data-testid="arcade-card-emerald-city-claw"]');
    await page.waitForSelector('[data-testid="arcade-expanded"]', { timeout: 8000 });
    await sleep(500);
    await tap(page, '[data-testid="arcade-play-btn"]');
    await page.waitForSelector('[data-testid="claw-intro"]', { timeout: 8000 });
    ok(true, 'INSERT COIN → claw cabinet intro');
    await sleep(900);
    await tap(page, '[data-testid="claw-start"]');
    await page.waitForSelector('[data-testid="claw-canvas"]', { timeout: 8000 });
    await page.waitForFunction(`!!${SIM}`, { timeout: 8000 });
    ok(true, 'INSERT TOKEN → canvas + physics sim mounted');

    // Tailwind reached the module wrapper: rounded-2xl on the DROP
    // button must compute to a real radius, not 0px.
    const radius = await page.$eval(
      '[data-testid="claw-drop"]',
      n => getComputedStyle(n).borderRadius,
    );
    ok(radius !== '' && radius !== '0px', `content glob styles the module wrapper (drop radius ${radius})`);

    const s0 = await page.evaluate(`(() => { const s = ${SIM}; return { items: s.items.length, phase: s.phase, tokens: s.tokensLeft }; })()`);
    ok(s0.items === 11 && s0.phase === 'idle', `seeded pile idle under the claw (${s0.items} items, ${s0.phase})`);

    // ── One real cycle: drag the glass over the easiest can, DROP ────
    const target = await page.evaluate(`(() => {
      const c = document.querySelector('[data-testid="claw-canvas"]');
      const s = c.__clawSim;
      const pri = { 'rainier-can': 0, 'kraken-plush': 1 };
      const items = s.items.filter(it => it.x > s.chuteWallX + 14);
      const exposed = items.filter(it => !items.some(o => o !== it && Math.abs(o.x - it.x) < it.r && o.y < it.y - 4));
      const pool = (exposed.length ? exposed : items).slice()
        .sort((a, b) => ((pri[a.type] ?? 9) - (pri[b.type] ?? 9)) || a.y - b.y);
      const t = pool[0];
      const v = s.view;
      const rect = c.getBoundingClientRect();
      return { worldX: t.x, px: rect.left + v.ox + t.x * v.s, py: rect.top + v.oy + 200 * v.s };
    })()`);
    await page.touchscreen.touchStart(target.px, target.py);
    const dragEnd = Date.now() + 3000;
    while (Date.now() < dragEnd) {
      const x = await page.evaluate(`${SIM}.trolleyX`);
      if (Math.abs(x - target.worldX) < 3) break;
      await sleep(90);
    }
    await page.touchscreen.touchEnd();
    await sleep(300);
    await tap(page, '[data-testid="claw-drop"]');
    await page.waitForFunction(
      `(() => { const s = ${SIM}; return s && s.tokensLeft === 3 && s.phase !== 'idle'; })()`,
      { timeout: 5000 },
    );
    ok(true, 'DROP CLAW spends a machine token and starts the cycle');
    await page.waitForFunction(
      `(() => { const s = ${SIM}; return s && (s.phase === 'idle' || s.phase === 'over'); })()`,
      { timeout: 25000 },
    );
    ok(true, 'full claw cycle completed on the arena bundle');

    // Stash a prize card if the grab landed (not required for the gate).
    if (await page.$('[data-testid="claw-prize-collect"]')) {
      await sleep(700);
      await tap(page, '[data-testid="claw-prize-collect"]').catch(() => {});
      await sleep(400);
    }

    // ── Forfeit out, verify the ticket ledger + exit seam ────────────
    await tap(page, '[data-testid="claw-close"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="claw-canvas"]'),
      { timeout: 8000 },
    );
    const tickets1 = await page.$eval('[data-testid="arcade-ticket-count"]', n => n.textContent.trim());
    ok(tickets1 === '2/3', `ticket spent on launch (hub reads "${tickets1}")`);

    await tap(page, '[aria-label="Back to the tables"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="arcade-hub"]'),
      { timeout: 8000 },
    );
    const cardVisible = await page.$('[data-testid="arcade-demo-card"]');
    ok(!!cardVisible, 'hub exit lands back on the demo card');
    const cardTickets = await page.$eval('[data-testid="arcade-demo-tickets"]', n => n.textContent);
    ok(/2\/3/.test(cardTickets), `demo card ledger agrees ("${cardTickets.replace(/\s+/g, ' ').trim()}")`);

    ok(pageErrors.length === 0, `zero page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
    ok(consoleErrors.length === 0, `zero console errors${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);
  } catch (err) {
    failures++;
    console.log('  ✗ smoke aborted:', err.message);
    if (pageErrors.length) console.log('    page errors:', pageErrors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})();
