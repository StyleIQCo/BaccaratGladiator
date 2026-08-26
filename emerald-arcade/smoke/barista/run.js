// Barista Rush headless smoke: mounts the real canvas component and
// drives two full drink loops with pointer input — the ruined-overflow
// path, then a complete tamp → pull → art trace — waiting on REAL stage
// transitions instead of guessed sleeps.
const path = require('path');
const puppeteer = require(path.join(__dirname, '../../../node_modules/puppeteer'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--mute-audio'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 390, height: 700 });
  await page.goto('file://' + path.join(__dirname, 'smoke.html'));
  await page.waitForSelector('canvas');

  // Wait for a station, then clear its input-gate intro (0.55 s worst case).
  const waitStage = async (stage) => {
    await page.waitForFunction((s) => window.__smoke.stage === s, { timeout: 15000 }, stage);
    await sleep(750);
  };

  // ── Drink 1: tamp tap, then hold the valve until it overflows.
  // The ruined path exercises tamp → pull → serve → next-drink alone.
  await waitStage('tamp');
  await page.mouse.click(195, 280);
  await waitStage('pull');
  await page.mouse.move(195, 300);
  await page.mouse.down();
  await sleep(3400);                 // fill rate 0.42/s → guaranteed overflow
  await page.mouse.up();

  // ── Drink 2: tamp, a ~1.6 s pull, then trace a circle on the foam.
  await waitStage('tamp');
  await page.mouse.click(195, 280);
  await waitStage('pull');
  await page.mouse.down();
  await sleep(1600);
  await page.mouse.up();
  await waitStage('art');
  await page.mouse.move(265, 291);   // cup centre (195, 291), trace radius 70
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    await page.mouse.move(195 + Math.cos(a) * 70, 291 + Math.sin(a) * 70);
    await sleep(25);
  }
  await page.mouse.up();

  // Let the 25 s shift clock run out.
  await page.waitForFunction(() => window.__smoke.over !== null, { timeout: 30000 });

  const smoke = await page.evaluate(() => window.__smoke);
  const pixels = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let min = 765, max = 0;
    for (let i = 0; i < d.length; i += 4 * 997) {
      const s = d[i] + d[i + 1] + d[i + 2];
      if (s < min) min = s;
      if (s > max) max = s;
    }
    return { min, max };
  });
  await browser.close();

  const fails = [];
  if (errors.length) fails.push('page errors: ' + errors.join(' | '));
  if (!smoke.over) fails.push('onGameOver never fired');
  if (smoke.hudTicks < 20) fails.push(`hud ticks too low: ${smoke.hudTicks}`);
  if (smoke.over && smoke.over.drinks < 2) fails.push(`expected 2 drinks, got ${smoke.over ? smoke.over.drinks : 0}`);
  if (smoke.over && smoke.over.log[0] && smoke.over.log[0].grade !== 'ruined') {
    fails.push(`drink 1 should be ruined (overflow), got ${smoke.over.log[0].grade}`);
  }
  if (smoke.over && smoke.over.log[1] && smoke.over.log[1].grade === 'ruined') {
    fails.push('drink 2 unexpectedly ruined');
  }
  for (const s of ['tamp', 'pull', 'art', 'serve']) {
    if (!smoke.stagesSeen.includes(s)) fails.push(`stage never reached: ${s}`);
  }
  if (pixels.max - pixels.min < 60) fails.push(`canvas looks blank (px range ${pixels.min}-${pixels.max})`);

  console.log('hudTicks:', smoke.hudTicks, 'lastHud:', JSON.stringify(smoke.lastHud));
  console.log('stages:', smoke.stagesSeen.join(' → '));
  console.log('over:', JSON.stringify(smoke.over));
  console.log('pixel range:', JSON.stringify(pixels));
  if (fails.length) {
    console.error('SMOKE FAIL:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('SMOKE PASS');
})();
