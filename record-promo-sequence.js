// Record baccarat-game.html's Promo Sequencer — actual gameplay
// (3 venues × 3 legendary wins) into a YouTube-Shorts MP4.
//
// Strategy: real-time per-frame screenshots (Puppeteer caps at ~13fps
// for 1080×1920 in headless without GPU). We track wall-clock timestamps
// per frame and feed them to ffmpeg's concat demuxer so each saved frame
// is held for its actual duration. Result: a 30fps fixed-rate MP4 in
// which the show plays at exactly its real-world timing.
//
// Output: /tmp/baccarat-gladiator-promo-short.mp4

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const W = 1080, H = 1920, FPS = 30;
const CAPTURE_S = 48;            // 38s promo + ~5s outro hold + buffer
const FRAMES_DIR = '/tmp/promo-sequence-frames';
const OUTPUT_MP4 = '/tmp/baccarat-gladiator-promo-short.mp4';
const PROJECT = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator';

(async () => {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 540, height: 960, deviceScaleFactor: 2,
                       isMobile: true, hasTouch: true },
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-features=IsolateOrigins,site-per-process',
      '--hide-scrollbars',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  // Mobile viewport (540×960) → final 1080×1920 via 2x deviceScaleFactor.
  // The game's CSS triggers its mobile layout at width:600, so this is
  // the correct viewport to get a vertical-friendly frame.
  await page.setViewport({ width: 540, height: 960, deviceScaleFactor: 2,
                           isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0,150)));

  const fileUrl = 'file://' + path.resolve(PROJECT, 'baccarat-game.html')
                + '?promo=1';
  await page.goto(fileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // Dismiss splash + auth modal so the table is visible.
  await page.evaluate(() => { if (window.enterArena) window.enterArena(); });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => {
    if (typeof startGuestTrial === 'function') startGuestTrial();
  });
  await new Promise(r => setTimeout(r, 1300));

  // Hide the Director's Cut panel during recording — the Promo Sequence
  // we're capturing should look like a polished player experience, not
  // a debug session.
  await page.addStyleTag({
    content: '#dc-panel { display:none !important; }',
  });

  // Kick off the promo sequence (fire-and-forget — page handles timing)
  await page.evaluate(() => { window.__startPromo(); });

  console.log(`Recording ${CAPTURE_S}s of Promo Sequence...`);
  const startWall = Date.now();
  const stamps = [];
  let i = 0;
  while (true) {
    const t = Date.now() - startWall;
    if (t >= CAPTURE_S * 1000) break;
    // Stop early if outro has been on screen for ≥3 seconds
    // (no need to capture endless outro hold).
    if (await page.evaluate(() => window.__promoComplete === true)) {
      // Continue for an additional 4 seconds after outro lands so the
      // CTA + QR codes are visible long enough on the final video.
      const outroStart = await page.evaluate(() => window.__promoCompleteTime
        || (window.__promoCompleteTime = Date.now()));
      if (Date.now() - outroStart > 4500) break;
    }
    await page.screenshot({
      path: path.join(FRAMES_DIR, `f${String(i).padStart(5,'0')}.jpg`),
      type: 'jpeg', quality: 90,
      optimizeForSpeed: true,
    });
    stamps.push(t);
    i++;
    if (i % 30 === 0) {
      const elapsed = ((Date.now() - startWall) / 1000).toFixed(1);
      process.stdout.write(`\r  ${elapsed}s · ${i} frames`);
    }
  }
  const savedFrames = i;
  const totalWall = (Date.now() - startWall) / 1000;
  const totalShowMs = stamps[stamps.length - 1] || (CAPTURE_S * 1000);
  console.log(`\n  ${savedFrames} frames in ${totalWall.toFixed(1)}s `
            + `= ${(savedFrames/totalWall).toFixed(1)}fps native`);

  await browser.close();

  // Build ffmpeg concat list — each frame held for actual capture interval
  const concatPath = path.join(FRAMES_DIR, 'frames.txt');
  let concat = '';
  for (let f = 0; f < savedFrames; f++) {
    const dur = (f < savedFrames - 1)
      ? Math.max(0.001, (stamps[f + 1] - stamps[f]) / 1000)
      : Math.max(0.001, (totalShowMs - stamps[f]) / 1000 || 0.05);
    concat += `file '${path.join(FRAMES_DIR, `f${String(f).padStart(5,'0')}.jpg`)}'\n`;
    concat += `duration ${dur.toFixed(4)}\n`;
  }
  concat += `file '${path.join(FRAMES_DIR, `f${String(savedFrames-1).padStart(5,'0')}.jpg`)}'\n`;
  fs.writeFileSync(concatPath, concat);

  console.log('Encoding to fixed 30fps...');
  const ff = spawnSync('ffmpeg', [
    '-y',
    '-f', 'concat', '-safe', '0',
    '-i', concatPath,
    '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos`,
    '-fps_mode', 'cfr',
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUTPUT_MP4,
  ], { stdio: 'inherit' });

  if (ff.status !== 0) {
    console.log('ffmpeg failed with exit code', ff.status);
    process.exit(1);
  }

  const stat = fs.statSync(OUTPUT_MP4);
  console.log(`\n✅ ${OUTPUT_MP4}`);
  console.log(`   ${(stat.size / 1024 / 1024).toFixed(2)} MB · ${W}×${H} `
            + `· ~${(totalShowMs/1000).toFixed(1)}s · ${FPS}fps · H.264 silent`);

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
})();
