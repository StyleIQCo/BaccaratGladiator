// Record trailer-mode.html to a 1080x1920 vertical MP4 at 30fps.
//
// Strategy: Puppeteer at 1080x1920 viewport, page emulates a 60fps
// repaint via Page.startScreencast (CDP). We collect frames to /tmp,
// then ffmpeg encodes them into a YouTube-Shorts-ready MP4.
//
// Output: /tmp/baccarat-gladiator-octagon-short.mp4 (~5–8 MB)
//
// Usage: node record-trailer.js

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const W = 1080, H = 1920;
const FPS = 30;
const DURATION_S = 31;        // 30s trailer + 1s tail-in
const FRAMES_DIR = '/tmp/bg-trailer-frames';
const OUTPUT_MP4 = '/tmp/baccarat-gladiator-colosseum-short.mp4';

(async () => {
  // Clean frame buffer
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
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console', e => {
    if (e.type() === 'error') console.log('CON-ERR:', e.text().slice(0, 200));
  });

  // Use file:// + auto-start query param
  const fileUrl = 'file://' + path.resolve(__dirname, 'trailer-mode.html')
                + '?auto=1';
  await page.goto(fileUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for Google Fonts to load — 800ms is enough at this network size
  await new Promise(r => setTimeout(r, 1000));

  console.log(`Capturing ${DURATION_S}s @ ${FPS}fps...`);
  const totalFrames = DURATION_S * FPS;
  const frameInterval = 1000 / FPS;
  const start = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const targetMs = i * frameInterval;
    const elapsed = Date.now() - start;
    if (elapsed < targetMs) {
      await new Promise(r => setTimeout(r, targetMs - elapsed));
    }
    await page.screenshot({
      path: path.join(FRAMES_DIR, `f${String(i).padStart(5, '0')}.jpg`),
      type: 'jpeg', quality: 92,
      omitBackground: false,
    });
    if (i % 30 === 0) {
      const pct = ((i / totalFrames) * 100).toFixed(0);
      process.stdout.write(`\r  ${pct}% (${i}/${totalFrames})`);
    }
  }
  console.log(`\n  done ${totalFrames}/${totalFrames}`);

  await browser.close();

  console.log('Encoding to MP4...');
  // H.264, mobile-friendly profile, yuv420p for broad codec support
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
  console.log(`\n✅ ${OUTPUT_MP4} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`   ${W}x${H} · ${DURATION_S}s · ${FPS}fps · H.264 · silent`);

  // Cleanup frame buffer
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
})();
