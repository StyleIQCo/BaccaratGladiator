#!/usr/bin/env node
//
// ═══════════════════════════════════════════════════════════════════
//   TOP-OFF / BUST-RELIEF SMOKE TEST  (touch-emulated)
//
//   Exercises the table-minimum → chip-out (Top-Off) flow added to
//   baccarat-game.html. Uses real puppeteer touchscreen.tap() taps so
//   z-index / overlay regressions surface (programmatic .click() would
//   miss them — see project memory).
//
//   Serves the repo over a throwaway local http server (so inline
//   scripts run without the prod CSP 'self' header) and drives the
//   real game functions/state.
//
//   CHECKS
//     1. Stake bar shows the table minimum (Vegas $1 → Macau $100).
//     2. Tapping a chip while below the table min opens the Top-Off
//        modal, and the modal is the topmost element (overlay/z-index).
//     3. Modal header is context-aware ("BELOW THE $100 MINIMUM").
//     4. Tapping CLAIM optimistically raises balance instantly.
//     5. DEAL is blocked when the stake is under the table minimum.
//     6. On cooldown, the claim button shows a countdown, not CLAIM.
//
//   USAGE   node test-topoff-smoke.js [--headful]
//   EXIT    0 all passed · 1 a check failed · 2 crashed
// ═══════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

const HEADFUL = process.argv.includes('--headful');
const ROOT    = __dirname;

// ── tiny static file server ─────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/baccarat-game.html';
      const file = path.join(ROOT, urlPath);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ── assertion bookkeeping ───────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else    { failed++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

// Tap the center of a selector with the touchscreen (not .click()).
async function tap(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, selector);
  if (!box || box.w === 0 || box.h === 0) throw new Error('not tappable: ' + selector);
  await page.touchscreen.tap(box.x, box.y);
}

(async () => {
  // BASE_URL=https://baccaratgladiator.com → verify the deployed site.
  // Unset → serve the local working tree on a throwaway port.
  const EXTERNAL = (process.env.BASE_URL || '').replace(/\/$/, '');
  const server = EXTERNAL ? null : await startServer();
  const BASE = EXTERNAL || ('http://127.0.0.1:' + server.address().port);
  console.log('Target: ' + BASE);
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 414, height: 896, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  });

  try {
    const page = await browser.newPage();
    let pageErrors = 0;
    page.on('pageerror', (e) => { pageErrors++; console.log('  [pageerror] ' + e.message); });

    // Pre-satisfy the age gate + skip the splash before any page script runs,
    // and suppress the book-promo modal (it overlays the table on a post-load
    // trigger and would intercept chip taps). The promo is gated by canShow(),
    // which honors this far-future "dismissed until" timestamp.
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('bg_age_gate_18_v1', 'ok');
        sessionStorage.setItem('bg_skip_splash_once', '1');
        localStorage.setItem('bg_book_promo_dismissed_until',
          new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString());
        sessionStorage.setItem('bg_book_modal_shown', '1');
      } catch (e) {}
    });

    await page.goto(BASE + '/baccarat-game.html', { waitUntil: 'domcontentloaded' });

    // Wait for the game runtime, then make sure no splash is covering the table.
    await page.waitForFunction(
      () => typeof refreshUI === 'function' && typeof tableMin === 'function'
            && document.getElementById('sticky-action-bar'),
      { timeout: 15000 }
    );
    // The audio path is now exercised for real (no stub) — any uncaught page
    // error, e.g. the _ambPadNodes TDZ regression we fixed, fails the run.
    await page.evaluate(() => { if (typeof forceDismissSplash === 'function') forceDismissSplash(); });
    await new Promise(r => setTimeout(r, 400));

    // Dismiss the book-promo modal if it's up (it overlays the table on live
    // and would intercept chip taps) — same as a user clicking its close (×).
    await page.evaluate(() => {
      document.querySelectorAll('.bg-book-modal').forEach((m) => {
        const close = m.querySelector('[data-action="dismiss"]');
        if (close) close.click(); else m.remove();
      });
    });
    await new Promise(r => setTimeout(r, 300));

    // ── 1 · Vegas (entry table) is unchanged: min $1 ───────────────────
    console.log('\nScenario 1 — Vegas entry table (min unchanged)');
    await page.evaluate(() => { currentVenue = 'vegas'; balance = 1000; refreshUI(); });
    const vegasMin = await page.$eval('#min-display', el => el.textContent.trim());
    check('Vegas stake bar shows Min $1', vegasMin === '$1', 'got ' + vegasMin);

    // ── 2 · Below the Macau minimum → tapping a chip opens Top-Off ──────
    console.log('\nScenario 2 — below $100 Macau minimum opens Top-Off modal');
    await page.evaluate(() => {
      playerTitle = 'Emperor'; playerLevel = 99; // unlock high-min venues for the test
      currentVenue = 'macau';      // minBet 100
      balance = 50;                // short of the table minimum
      lastFreeTopup = 0;           // free top-up available (not on cooldown)
      phase = 'betting';
      refreshUI();
      const m = document.getElementById('chip-out-modal');
      if (m) m.classList.remove('on'); // ensure a clean start
    });
    const macauMin = await page.$eval('#min-display', el => el.textContent.trim());
    check('Macau stake bar shows Min $100', macauMin === '$100', 'got ' + macauMin);

    await tap(page, '.chip.c100');   // real touch on the $100 chip while short
    await page.waitForFunction(
      () => document.getElementById('chip-out-modal').classList.contains('on'),
      { timeout: 4000 }
    ).catch(() => {});
    const modalOn = await page.$eval('#chip-out-modal', el => el.classList.contains('on'));
    check('Top-Off modal opens after under-min chip tap', modalOn);

    // Overlay/z-index: the element at the modal frame's center must be the
    // modal (or a descendant), not something painted over it.
    const topmostIsModal = await page.evaluate(() => {
      const frame = document.querySelector('#chip-out-modal .cm-frame');
      const r = frame.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
      return !!(hit && hit.closest('#chip-out-modal'));
    });
    check('Modal is topmost at its center (no overlay covering it)', topmostIsModal);

    // ── 3 · Context-aware header copy ─────────────────────────────────
    console.log('\nScenario 3 — context-aware header copy');
    const title = await page.$eval('#cm-title-text', el => el.textContent.trim());
    check('Header reads "BELOW THE $100 MINIMUM"', /BELOW THE \$100 MINIMUM/i.test(title), 'got "' + title + '"');

    // ── 4 · Claim optimistically raises balance instantly ─────────────
    console.log('\nScenario 4 — claim refill optimistically updates balance');
    const before = await page.evaluate(() => balance);
    await tap(page, '#chip-out-modal .cm-card.topup .cm-btn');   // real touch on CLAIM
    await new Promise(r => setTimeout(r, 250));
    const after = await page.evaluate(() => balance);
    check('Balance increased after CLAIM', after > before, before + ' → ' + after);
    check('Balance now covers the table minimum', after >= 100, 'balance ' + after);

    // ── 5 · DEAL blocked when stake is under the table minimum ─────────
    console.log('\nScenario 5 — DEAL enforces the table minimum');
    await page.evaluate(() => {
      document.getElementById('chip-out-modal').classList.remove('on');
      playerTitle = 'Emperor'; playerLevel = 99;
      currentVenue = 'macau'; balance = 1000; phase = 'betting';
      bets = { banker:0,player:0,tie:0,dragon7:0,panda8:0,bigTiger:0,smallTiger:0,tigerTie:0,playerPair:0,bankerPair:0 };
      refreshUI();
    });
    await tap(page, '.chip.c25');                 // place a $25 stake (< $100 min)
    const phaseBefore = await page.evaluate(() => phase);
    await tap(page, '#btn-deal');                 // try to deal
    await new Promise(r => setTimeout(r, 250));
    const dealState = await page.evaluate(() => ({ phase, msg: (document.getElementById('msg-bar') || {}).textContent || '' }));
    check('DEAL did not start the hand (phase stayed betting)', phaseBefore === 'betting' && dealState.phase === 'betting', 'phase ' + dealState.phase);
    check('Message explains the table minimum', /table minimum/i.test(dealState.msg), 'msg "' + dealState.msg + '"');

    // ── 6 · Cooldown shows a countdown instead of CLAIM ───────────────
    console.log('\nScenario 6 — cooldown shows countdown, not CLAIM');
    await page.evaluate(() => {
      playerTitle = 'Emperor'; playerLevel = 99;
      currentVenue = 'macau'; balance = 50; phase = 'betting';
      lastFreeTopup = Date.now();   // just claimed → on cooldown
      if (typeof showChipOutModal === 'function') showChipOutModal();
    });
    await new Promise(r => setTimeout(r, 250));
    const topup = await page.evaluate(() => {
      const card = document.querySelector('#chip-out-modal .cm-card.topup');
      return { cd: card.querySelector('.cm-cd').textContent.trim(), disabled: card.querySelector('.cm-btn').disabled };
    });
    check('Free top-up button disabled while on cooldown', topup.disabled === true);
    check('Countdown timer is shown (not "AVAILABLE NOW")', topup.cd && !/AVAILABLE NOW/i.test(topup.cd), 'countdown "' + topup.cd + '"');

    // ── 6b · Real bust: lose a hand down to 0 → Top-Off appears on its own ──
    // (No NEW ROUND click. This is the user-reported flow.) Force losses by
    // betting Tie at the table minimum; instant-resolve via director cut.
    console.log('\nScenario 6b — lose to 0 → Top-Off auto-appears (no NEW ROUND)');
    await page.evaluate(() => {
      window.__directorCut = true;          // instant reveal, no long animations
      currentVenue = 'vegas';               // table min $1
      authLocked = true;                    // keep guest-trial gate out of the way
      document.getElementById('chip-out-modal').classList.remove('on');
    });
    let busted = false;
    for (let i = 0; i < 12 && !busted; i++) {
      await page.evaluate(() => {
        balance = 1; phase = 'betting';
        bets = { banker:0,player:0,tie:0,dragon7:0,panda8:0,bigTiger:0,smallTiger:0,tigerTie:0,playerPair:0,bankerPair:0 };
        refreshUI(); selectSlot('tie'); addChip(1); // stake the last $1 on Tie
        document.getElementById('chip-out-modal').classList.remove('on'); // ignore the pre-deal trigger
        deal();
      });
      await page.waitForFunction(() => phase === 'dealt', { timeout: 8000 }).catch(() => {});
      const bal = await page.evaluate(() => balance);
      if (bal === 0) busted = true;
    }
    check('Reached a real $0 bust via gameplay', busted);
    // The bust trigger fires on a 900ms delay — wait it out, do NOT click NEW ROUND.
    await new Promise(r => setTimeout(r, 1300));
    const bust = await page.evaluate(() => ({
      phase, balance,
      chipOutOn: document.getElementById('chip-out-modal').classList.contains('on'),
      msg: (document.getElementById('msg-bar') || {}).textContent || '',
    }));
    check('Top-Off modal auto-appeared at $0 without NEW ROUND', bust.chipOutOn === true, 'phase ' + bust.phase + ' bal ' + bust.balance);
    check('Message bar acknowledges the $0 bust in words', /out of credits/i.test(bust.msg), 'msg "' + bust.msg + '"');

    // ── 6c · Guest trial boundary: last credit AND last trial deal on the same
    // hand. The Top-Off modal is intentionally suppressed (guest trial expired),
    // and the sign-in overlay that replaces it never mentions credits — so the
    // message-bar line is the ONLY thing telling the guest they busted. Verify it.
    console.log('\nScenario 6c — guest busts on the deal that ends the trial');
    await page.evaluate(() => {
      window.__directorCut = true;
      currentVenue = 'vegas';               // table min $1
      authLocked = false;                   // GUEST
      guestDealsUsed = 9;                   // next deal is #10 → trial expires this hand
      document.getElementById('chip-out-modal').classList.remove('on');
      balance = 1; phase = 'betting';
      bets = { banker:0,player:0,tie:0,dragon7:0,panda8:0,bigTiger:0,smallTiger:0,tigerTie:0,playerPair:0,bankerPair:0 };
      refreshUI(); selectSlot('tie'); addChip(1); // stake the last $1 on Tie (loses unless tie)
      document.getElementById('chip-out-modal').classList.remove('on');
    });
    // Deal until this guest hand actually busts to $0 (Tie can push); reset stake each retry.
    let gBusted = false;
    for (let i = 0; i < 12 && !gBusted; i++) {
      await page.evaluate(() => {
        balance = 1; phase = 'betting'; guestDealsUsed = 9;
        bets = { banker:0,player:0,tie:0,dragon7:0,panda8:0,bigTiger:0,smallTiger:0,tigerTie:0,playerPair:0,bankerPair:0 };
        refreshUI(); selectSlot('tie'); addChip(1);
        document.getElementById('chip-out-modal').classList.remove('on');
        deal();
      });
      await page.waitForFunction(() => phase === 'dealt', { timeout: 8000 }).catch(() => {});
      if (await page.evaluate(() => balance) === 0) gBusted = true;
    }
    await new Promise(r => setTimeout(r, 1300));
    const gBust = await page.evaluate(() => ({
      balance, trialExpired: guestTrialExpired(),
      chipOutOn: document.getElementById('chip-out-modal').classList.contains('on'),
      msg: (document.getElementById('msg-bar') || {}).textContent || '',
    }));
    check('Guest reached $0 with trial expired (the suppressed-modal path)', gBusted && gBust.trialExpired === true, 'bal ' + gBust.balance + ' expired ' + gBust.trialExpired);
    check('Guest still gets the $0 message even though Top-Off modal is suppressed', /out of credits/i.test(gBust.msg) && gBust.chipOutOn === false, 'modalOn ' + gBust.chipOutOn + ' msg "' + gBust.msg + '"');

    // ── 7 · No uncaught page errors across the whole run ──────────────
    console.log('\nScenario 7 — no uncaught page errors (audio path included)');
    check('Zero uncaught page errors during the run', pageErrors === 0, pageErrors + ' error(s)');

    console.log('\n──────────────────────────────────────────');
    console.log(`  ${passed} passed · ${failed} failed`);
    console.log('──────────────────────────────────────────');
  } catch (err) {
    console.error('\nCRASHED: ' + (err && err.stack || err));
    await browser.close(); if (server) server.close();
    process.exit(2);
  }

  await browser.close();
  if (server) server.close();
  process.exit(failed === 0 ? 0 : 1);
})();
