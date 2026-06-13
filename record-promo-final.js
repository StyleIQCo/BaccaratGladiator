// Render promo-sequencer.html (with the 5 clip*.mp4 files alongside it)
// to a finished YouTube-Shorts-ready MP4. Captures one full 25-second
// loop at 1080×1920, 30fps, encodes H.264 yuv420p with faststart.
//
// Output: /tmp/baccarat-gladiator-final-short.mp4

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const W = 1080, H = 1920, FPS = 30;
const DURATION_S = 26;            // 25s loop + 1s tail buffer for the last fade
const TOTAL_FRAMES = DURATION_S * FPS;
const FRAMES_DIR = '/tmp/promo-final-frames';
const OUTPUT_MP4 = '/tmp/baccarat-gladiator-final-short.mp4';
const PROJECT = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator';

(async () => {
  // Confirm clip1-5 exist next to promo-sequencer.html
  for (let i = 1; i <= 5; i++) {
    const p = path.join(PROJECT, `clip${i}.mp4`);
    if (!fs.existsSync(p)) {
      console.error(`❌ missing: ${p}`);
      process.exit(1);
    }
  }

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-features=IsolateOrigins,site-per-process',
      '--hide-scrollbars',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      // Allow autoplay of muted videos without user-interaction restrictions
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console',  e => {
    if (e.type() === 'error') console.log('CON-ERR:', e.text().slice(0, 200));
  });

  const fileUrl = 'file://' + path.resolve(PROJECT, 'promo-sequencer.html')
                + '?auto=1';
  await page.goto(fileUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for fonts + first video frame to be ready before capture starts.
  // The promo-sequencer auto-starts ~600ms after load.
  await new Promise(r => setTimeout(r, 1500));

  console.log(`Capturing ${DURATION_S}s @ ${FPS}fps (${TOTAL_FRAMES} frames)...`);
  const start = Date.now();
  const interval = 1000 / FPS;
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const target = i * interval;
    const elapsed = Date.now() - start;
    if (elapsed < target) await new Promise(r => setTimeout(r, target - elapsed));
    await page.screenshot({
      path: path.join(FRAMES_DIR, `f${String(i).padStart(5, '0')}.jpg`),
      type: 'jpeg', quality: 92,
      omitBackground: false,
    });
    if (i % 30 === 0) {
      const pct = ((i / TOTAL_FRAMES) * 100).toFixed(0);
      process.stdout.write(`\r  ${pct}% (${i}/${TOTAL_FRAMES})`);
    }
  }
  console.log(`\n  done`);

  await browser.close();

  console.log('Encoding...');
  const ff = spawnSync('ffmpeg', [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(FRAMES_DIR, 'f%05d.jpg'),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-vf', `scale=${W}:${H}:flags=lanczos`,
    OUTPUT_MP4,
  ], { stdio: 'inherit' });

  if (ff.status !== 0) {
    console.log('ffmpeg failed with exit code', ff.status);
    process.exit(1);
  }

  const stat = fs.statSync(OUTPUT_MP4);
  console.log(`\n✅ ${OUTPUT_MP4}`);
  console.log(`   ${(stat.size / 1024 / 1024).toFixed(2)} MB · ${W}×${H} · ${DURATION_S}s · ${FPS}fps · H.264 silent`);

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
})();
