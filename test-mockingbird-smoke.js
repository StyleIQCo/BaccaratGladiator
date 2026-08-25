#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  MOCKINGBIRD STAGE SMOKE TEST (touch-emulated, per project memory:
//  real touchscreen.tap() so z-index/overlay regressions surface)
//
//  CHECKS
//   1. DemoHub renders, 🤠 MOCKINGBIRD tab opens the stage
//   2. Hidden bird button exists; chips baseline 12,500 shown
//   3. COLD: SIMULATE LOSS → scene filter gains sepia grade
//   4. HOT: 3× SIMULATE WIN → brightness grade + gold ember particles
//   5. SECRET: triple-tap bird within 2s → "SECRET STASH" overlay,
//      count-up reaches +5,000
//   6. Tap-to-collect closes overlay and credits chips (17,500)
//
//  USAGE  node test-mockingbird-smoke.js
//  EXIT   0 pass · 1 check failed · 2 crashed
// ═══════════════════════════════════════════════════════════════════
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 4199;
const URL = `http://localhost:${PORT}/arena/`;
const WEB_DIR = require('path').join(__dirname, 'arena', 'web');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function waitForServer(url, tries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      http.get(url, res => { res.resume(); resolve(); })
        .on('error', () => n > 0 ? setTimeout(() => attempt(n - 1), 250) : reject(new Error('preview never came up')));
    };
    attempt(tries);
  });
}

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}`);
  if (!ok) failures++;
};

async function tapText(page, text) {
  const handle = await page.evaluateHandle(t => {
    const els = [...document.querySelectorAll('button')];
    return els.find(el => el.textContent.includes(t)) || null;
  }, text);
  const el = handle.asElement();
  if (!el) throw new Error(`no button containing "${text}"`);
  const box = await el.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function main() {
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: WEB_DIR, stdio: 'ignore', detached: true,
  });
  process.on('exit', () => { try { process.kill(-preview.pid); } catch {} });
  await waitForServer(URL);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  // DemoHub is gated on the kill-switch flags file — serve it demoMode:true.
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('/arena/config/flags.json')) {
      req.respond({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ enabled: true, demoMode: true }),
      });
    } else req.continue();
  });

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('GRAND ARENA'), { timeout: 10000 });

  // 1. Open the stage tab
  await tapText(page, 'MOCKINGBIRD');
  await sleep(600);
  const bodyText = () => page.evaluate(() => document.body.innerText);
  check('stage tab renders sign', (await bodyText()).includes('ROAD TO'));

  // 2. Hidden bird + chips baseline
  const birdSel = 'button[aria-label="A quiet mockingbird on the wire"]';
  check('hidden bird button present', !!(await page.$(birdSel)));
  check('chips baseline 12,500 shown', (await bodyText()).includes('12,500'));

  // 3. COLD grade
  await tapText(page, 'SIMULATE LOSS');
  await sleep(1900);
  const coldFilter = await page.evaluate(() =>
    [...document.querySelectorAll('[style]')].some(el => (el.style.filter || '').includes('sepia(0.45)')));
  check('cold state applies sepia grade', coldFilter);
  check('cold badge shown', (await bodyText()).includes('RUNNING COLD'));

  // 4. HOT grade (loss → 3 wins: -1 → 1 → 2 → 3)
  for (let i = 0; i < 3; i++) { await tapText(page, 'SIMULATE WIN'); await sleep(700); }
  await sleep(1900);
  const hot = await page.evaluate(() => ({
    bright: [...document.querySelectorAll('[style]')].some(el => (el.style.filter || '').includes('brightness(1.14)')),
    embers: document.querySelectorAll('span.shadow-glow-gold').length,
  }));
  check('hot state applies brightness grade', hot.bright);
  check(`gold embers rendering (${hot.embers})`, hot.embers >= 10);
  check('hot badge shown', (await bodyText()).includes('RUNNING HOT'));

  // 5a. NEGATIVE: three slow taps (spanning ~2.4s > 2000ms window) must NOT unlock
  for (let i = 0; i < 3; i++) {
    const bird = await page.$(birdSel);
    const box = await bird.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(1200);
  }
  check('slow taps do NOT unlock', !(await bodyText()).includes('SECRET STASH'));
  await sleep(2100); // let the last slow tap age out of the 2s window

  // 5b. Triple-tap the bird within 2s
  for (let i = 0; i < 3; i++) {
    const bird = await page.$(birdSel);
    const box = await bird.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(180);
  }
  await page.waitForFunction(() => document.body.innerText.includes('SECRET STASH'), { timeout: 4000 });
  check('secret overlay appears', true);
  await sleep(2200); // let the count-up land
  check('count-up reaches +5,000', (await bodyText()).includes('+5,000'));

  // 6. Tap to collect
  const overlay = await page.evaluateHandle(() => document.querySelector('[role="dialog"]'));
  const obox = await overlay.asElement().boundingBox();
  await page.touchscreen.tap(obox.x + obox.width / 2, obox.y + obox.height / 2);
  await sleep(800);
  const after = await bodyText();
  check('overlay dismissed', !after.includes('SECRET STASH'));
  check('chips credited to 17,500', after.includes('17,500'));

  await browser.close();
  try { process.kill(-preview.pid); } catch {}
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('CRASH:', err); process.exit(2); });
