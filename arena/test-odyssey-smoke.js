#!/usr/bin/env node
// Odyssey stage smoke — touch-emulated walkthrough of the referral-only
// Aegean stage in the Demo Hub. Complements test-arena-e2e.js (which
// covers provably-fair + gateway): this drives the BUILT web bundle in
// a real browser with touchscreen taps, so z-index/overlay regressions
// surface the way they would on a phone.
//
// Flow: locked gate renders → gate absorbs taps aimed at the blurred
// table → CTA opens the Hongbao referral modal → demo rig unlocks →
// zones arm → forced Trojan win shows the 50:1 burst and self-resets →
// unlock persists across reload → rig re-locks.
//
// Prereq: `npm run build` in web/ (this serves web/dist directly, plus
// config/flags.json at the /arena/config path KillSwitchGate fetches).
//
// Usage:
//   node test-odyssey-smoke.js              # PORT=4936 by default
//   SHOTS_DIR=/tmp/shots node test-odyssey-smoke.js   # also save PNGs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
// DIST_DIR lets you point at a snapshot build — deploys sync from a
// snapshot of dist/, never live dist/ (parallel builds in this shared
// worktree have caused HTML↔asset hash mismatches), so test the same
// snapshot you're about to ship.
const DIST = process.env.DIST_DIR || join(HERE, 'web', 'dist');
const FLAGS = join(HERE, 'config', 'flags.json');
const PORT = Number(process.env.PORT) || 4936;
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

// ── Touch helpers ───────────────────────────────────────────────────
/** Center of the innermost visible element containing `text`. */
async function rectOf(page, text, onlyButtons = true) {
  return page.evaluate(({ text, onlyButtons }) => {
    const els = [...document.querySelectorAll(onlyButtons ? 'button' : 'body *')]
      .filter(el => el.textContent?.includes(text))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .sort((a, b) => a.textContent.length - b.textContent.length);
    const el = els[0];
    if (!el) return null;
    // The Demo Hub page scrolls — a target below the fold has viewport
    // coords the touchscreen can't reach. Center it first (instant).
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { text, onlyButtons });
}

async function tap(page, text, onlyButtons = true) {
  const r = await rectOf(page, text, onlyButtons);
  if (!r) throw new Error(`tap target not found: "${text}"`);
  await page.touchscreen.tap(r.x, r.y);
}

/** Tap a data-testid'd element (campaign map ports, cutscene card). */
async function tapSel(page, selector, yOffset = null) {
  const el = await page.$(selector);
  if (!el) throw new Error(`tapSel target not found: ${selector}`);
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await new Promise(r => setTimeout(r, 150));
  const b = await el.boundingBox();
  await page.touchscreen.tap(
    b.x + b.width / 2,
    yOffset === null ? b.y + b.height / 2 : b.y + yOffset,
  );
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
  console.log(`\nOdyssey smoke — serving ${DIST} on http://127.0.0.1:${PORT}/arena/`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await page.goto(`http://127.0.0.1:${PORT}/arena/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });

    // Fresh voyage: wipe any previous VIP profile + campaign save.
    await page.evaluate(() => {
      localStorage.removeItem('bg.odyssey.vip');
      localStorage.removeItem('bg_odyssey_progress_v1');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(seeing('GRAND ARENA'), { timeout: 10_000 });

    console.log('\nCampaign voyage (default sub-view)');
    await tap(page, 'ODYSSEY');
    await page.waitForSelector('[data-testid="odyssey-campaign-map"]', { timeout: 5_000 });
    const nodeCount = await page.$$eval('[data-testid^="map-node-"]', els => els.length);
    ok(nodeCount === 10, `campaign map renders 10 ports (got ${nodeCount})`);
    await shot(page, '0-campaign-map');

    // Locked port: clank + camera shake, but no cutscene.
    await tapSel(page, '[data-testid="map-node-3"]');
    await new Promise(r => setTimeout(r, 500));
    ok(!(await page.$('[data-testid="narrative-cutscene"]')), 'locked port rejects the tap');

    // Frontier port → cutscene → SET SAIL → trial table.
    await tapSel(page, '[data-testid="map-node-1"]');
    await page.waitForSelector('[data-testid="narrative-cutscene"]', { timeout: 5_000 });
    await new Promise(r => setTimeout(r, 700)); // card entrance spring settles
    let sail = false;
    for (let i = 0; i < 14 && !sail; i++) {
      sail = !!(await page.$('[data-testid="cutscene-cta"]'));
      if (sail) break;
      await tapSel(page, '[data-testid="cutscene-advance"]', 40);
      await new Promise(r => setTimeout(r, 500));
    }
    ok(sail, 'cutscene pages through to the CTA');
    const ctaText = sail
      ? await page.$eval('[data-testid="cutscene-cta"]', el => el.innerText.trim())
      : '(absent)';
    ok(ctaText === 'SET SAIL', `CTA reads SET SAIL (got "${ctaText}")`);
    await shot(page, '0b-cutscene');
    await new Promise(r => setTimeout(r, 400)); // CTA reveal spring settles
    await tap(page, 'SET SAIL');
    await page.waitForFunction(seeing('WIN TRIAL'), { timeout: 5_000 });
    ok(true, 'SET SAIL lands on the Aegean trial table');
    await shot(page, '0c-trial-table');

    // Demo-rig win → back on the map with the port cleared.
    await tap(page, 'WIN TRIAL');
    // The remounted map hydrates from the save in a post-commit effect —
    // wait for the status to land rather than racing the first paint.
    await page.waitForFunction(
      `document.querySelector('[data-testid="map-node-1"]')?.dataset.status === 'cleared'`,
      { timeout: 5_000 },
    );
    ok(true, 'port 1 cleared after the trial');
    await page.waitForFunction(seeing('⚔️ 1 / 10'), { timeout: 5_000 });
    ok(true, 'voyage chip shows ⚔️ 1 / 10');

    // Campaign progress survives reload (namespaced odyssey save).
    await page.reload({ waitUntil: 'networkidle0' });
    await tap(page, 'ODYSSEY');
    await page.waitForSelector('[data-testid="odyssey-campaign-map"]', { timeout: 5_000 });
    await page.waitForFunction(seeing('⚔️ 1 / 10'), { timeout: 5_000 });
    ok(true, 'voyage progress survives reload');

    await tap(page, 'RESET VOYAGE');
    await page.waitForFunction(seeing('⚔️ 0 / 10'), { timeout: 5_000 });
    ok(true, 'RESET VOYAGE wipes the campaign save');

    console.log('\nGate (locked)');
    await tap(page, 'AEGEAN VIP TABLE');
    await page.waitForFunction(seeing('THE ODYSSEY AWAITS'), { timeout: 5_000 });
    ok(true, 'locked gate renders over the stage');
    await shot(page, '1-locked-gate');

    // The blurred table is beneath the overlay — a tap aimed at PLAYER
    // must be absorbed by the gate, never arm a zone.
    const player = await rectOf(page, 'PLAYER');
    if (player) await page.touchscreen.tap(player.x, player.y);
    await new Promise(r => setTimeout(r, 400));
    const armedWhileLocked = await page.$('[aria-pressed="true"]');
    ok(player !== null && !armedWhileLocked, 'gate absorbs taps aimed at the blurred table');

    await tap(page, 'REFER A FRIEND TO BOARD THE SHIP');
    await page.waitForFunction(seeing('SEND LUCK TO A FRIEND'), { timeout: 5_000 });
    ok(true, 'CTA opens the Hongbao referral modal');
    await shot(page, '2-referral-modal');
    // The modal enters on a spring (y 90→0, scale 0.8→1). Tapping the
    // coordinates of a mid-flight boundingBox misses the moving button,
    // so aim only once the rect holds still between two samples.
    const close = await page.$('button[aria-label="Close"]');
    let cb = await close.boundingBox();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 100));
      const next = await close.boundingBox();
      if (next && cb && Math.abs(next.x - cb.x) < 0.5 && Math.abs(next.y - cb.y) < 0.5) { cb = next; break; }
      cb = next;
    }
    await page.touchscreen.tap(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.waitForFunction(`!${seeing('SEND LUCK TO A FRIEND')}`, { timeout: 5_000 });

    console.log('\nUnlock (demo rig)');
    await tap(page, '+1 SUCCESSFUL REFERRAL');
    await page.waitForFunction(seeing('BOARDED · CREW CAPTAIN'), { timeout: 5_000 });
    ok(await page.evaluate(`!${seeing('THE ODYSSEY AWAITS')}`), 'gate opens on successfulReferrals >= 1');
    await shot(page, '3-unlocked-table');

    await tap(page, 'PLAYER');
    await page.waitForSelector('[aria-pressed="true"]', { timeout: 5_000 });
    ok(true, 'PLAYER zone arms (chip drops)');

    await tap(page, 'TROJAN HORSE');
    await page.waitForFunction(seeing('ARMED ⚔'), { timeout: 5_000 });
    ok(true, 'Trojan Horse side bet arms');

    console.log('\nTrojan win');
    await tap(page, 'FORCE TROJAN WIN');
    await page.waitForFunction(seeing('HIDDEN MULTIPLIER'), { timeout: 4_000 });
    ok(true, 'rumble → burst: 50:1 HIDDEN MULTIPLIER overlay shows');
    // The overlay mounts at scale 0 — let the spring overshoot land so
    // the screenshot catches the celebration at its peak.
    await new Promise(r => setTimeout(r, 650));
    await shot(page, '4-trojan-burst');
    await page.waitForFunction(`!${seeing('HIDDEN MULTIPLIER')}`, { timeout: 8_000 });
    ok(true, 'celebration ends and resets on its own');

    console.log('\nPersistence');
    await page.reload({ waitUntil: 'networkidle0' });
    await tap(page, 'ODYSSEY');
    await page.waitForSelector('[data-testid="odyssey-campaign-map"]', { timeout: 5_000 });
    await tap(page, 'AEGEAN VIP TABLE');
    await page.waitForFunction(seeing('BOARDED · CREW CAPTAIN'), { timeout: 5_000 });
    ok(true, 'unlock survives reload (profile persisted)');

    await tap(page, 'RESET · LOCK');
    await page.waitForFunction(seeing('THE ODYSSEY AWAITS'), { timeout: 5_000 });
    ok(true, 'rig reset locks the gate again');
  } catch (e) {
    ok(false, `walkthrough aborted: ${e.message}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
