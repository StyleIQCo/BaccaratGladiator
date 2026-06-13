// Drive a single variant for 40+ hands, capture on the first banker-side win
// after hand 40. Banker bet is $100 per hand (the cross-variant min main bet).
//
// Usage: node auto-play.js <slug> [<outpath>]
//        node auto-play.js nine
//        node auto-play.js gladiator /tmp/preview-gladiator.jpg
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const MIN_HANDS = 40;
const MAX_HANDS = 65;
const PER_HAND_TIMEOUT = 14000;
const OUT_DIR = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator/previews';

async function playOne(slug, outPath) {
  const out = outPath || path.join(OUT_DIR, `preview-${slug}.jpg`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-features=IsolateOrigins'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });

  // Pre-seed localStorage so squeeze theatre auto-flips and welcome stays hidden.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('rtn_seen', '1');
    localStorage.setItem('rtn_squeeze', '0');
    localStorage.setItem('rtn_sfx', '0');
  });

  try {
    await page.goto(`https://baccaratgladiator.com/road-to-${slug}.html?v=${Date.now()}`,
      { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    console.log(`FAIL ${slug.padEnd(20)} navigation: ${e.message}`);
    await browser.close();
    return false;
  }
  await new Promise(r => setTimeout(r, 1500));

  // Hide any welcome / first-tip overlay just in case
  await page.evaluate(() => {
    document.querySelectorAll('.welcome-overlay,.intro-overlay,#first-tip,.welcome-modal,.welcome,.modal-overlay')
      .forEach(el => el.style.display = 'none');
  });

  let hands = 0;
  let captured = false;
  const t0 = Date.now();

  while (hands < MAX_HANDS && !captured) {
    // Place $100 banker bet (minimum main bet across variants)
    const placed = await page.evaluate(() => {
      const c = document.querySelector('.chip[data-val="100"]');
      const b = document.querySelector('[data-side="banker"]');
      if (!c || !b) return false;
      c.click(); b.click();
      return true;
    });
    if (!placed) break;
    await new Promise(r => setTimeout(r, 200));

    // Force-enable DEAL and click. The variant code disables DEAL via an
    // internal updater that doesn't always re-run on synthetic clicks.
    await page.evaluate(() => {
      const d = document.getElementById('btn-deal');
      if (!d) return;
      d.disabled = false;
      d.click();
    });

    // Wait for resolution: either .total.win class OR history advances.
    const initialHistory = await page.evaluate(
      () => (window.__rtn && window.__rtn.history) ? window.__rtn.history.length : 0);
    const winStart = Date.now();
    let winSide = null;
    while (Date.now() - winStart < PER_HAND_TIMEOUT) {
      const r = await page.evaluate((initLen) => {
        const tp = document.querySelector('.total.t-player');
        const tb = document.querySelector('.total.t-banker');
        const win = (tp && tp.classList.contains('win')) ? 'P'
                  : (tb && tb.classList.contains('win')) ? 'B' : null;
        const hLen = window.__rtn && window.__rtn.history ? window.__rtn.history.length : 0;
        const last = window.__rtn && window.__rtn.history && window.__rtn.history[hLen-1];
        return { win, advanced: hLen > initLen, lastWinner: last ? last.winner : null };
      }, initialHistory);
      if (r.win)         { winSide = r.win; break; }
      if (r.advanced)    { winSide = r.lastWinner; break; }
      await new Promise(r2 => setTimeout(r2, 80));
    }
    hands++;

    // Capture on the first banker-side win at hand ≥ MIN_HANDS — that's the
    // visual "I bet on banker, banker won, +$100" moment. Falls back to any
    // win at the very end so we don't ship blank previews.
    if (hands >= MIN_HANDS && winSide === 'B') {
      await new Promise(r => setTimeout(r, 700));
      await page.screenshot({ path: out, type: 'jpeg', quality: 86 });
      captured = true;
      const ms = Date.now() - t0;
      const size = fs.statSync(out).size;
      console.log(`OK   ${slug.padEnd(22)} hand ${hands} · ${(ms/1000).toFixed(1)}s · ${(size/1024).toFixed(0)}KB`);
      break;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  if (!captured) {
    // Last-ditch: capture whatever's on screen at the end with any visible win.
    try { await page.screenshot({ path: out, type: 'jpeg', quality: 86 }); } catch (e) {}
    console.log(`WARN ${slug.padEnd(22)} no banker-win after ${hands} hands; saved final frame`);
  }

  await browser.close();
  return captured;
}

if (require.main === module) {
  const slug = process.argv[2];
  const outArg = process.argv[3];
  if (!slug) { console.log('usage: node auto-play.js <slug> [outpath]'); process.exit(1); }
  playOne(slug, outArg);
}

module.exports = { playOne };
