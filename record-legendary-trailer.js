// Render legendary-trailer.html (Stage Select badges + Dragon 7 / Panda 8 /
// Tiger 6 legendary wins + outro CTA) to a YouTube-Shorts-ready 1080x1920 MP4.
//
// Strategy: take page.screenshot at the page's real paint rate (~13fps
// achievable in headless without GPU). Track per-frame wall-clock timestamps
// and feed them to ffmpeg's concat demuxer so each saved frame is held for
// exactly its real-world duration. Result: 22s of show plays as 22s of video
// regardless of the per-screenshot latency. ffmpeg's -fps_mode cfr resamples
// to a fixed 30fps for YouTube-Shorts compatibility.
//
// Output: /tmp/baccarat-gladiator-legendary-short.mp4

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const W = 1080, H = 1920, FPS = 30;
const DURATION_S = 22;
const FRAMES_DIR = '/tmp/legendary-trailer-frames';
const OUTPUT_MP4 = '/tmp/baccarat-gladiator-legendary-short.mp4';
const PROJECT = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator';

(async () => {
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
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console', e => {
    if (e.type() === 'error') console.log('CON-ERR:', e.text().slice(0, 200));
  });

  const fileUrl = 'file://' + path.resolve(PROJECT, 'legendary-trailer.html')
                + '?record=1';

  await page.goto(fileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForFunction(() => window.__started === true, { timeout: 10000 });

  console.log(`Capturing real-time alongside ${DURATION_S}s show...`);
  const startWall = Date.now();
  const stamps = [];      // wall-clock ms at the start of each captured frame
  let i = 0;
  while (true) {
    const t = Date.now() - startWall;
    if (t >= DURATION_S * 1000) break;
    await page.screenshot({
      path: path.join(FRAMES_DIR, `f${String(i).padStart(5, '0')}.jpg`),
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
  console.log(`\n  ${savedFrames} frames in ${totalWall.toFixed(1)}s = ${(savedFrames/totalWall).toFixed(1)}fps native`);

  await browser.close();

  // Build ffmpeg concat list — each frame is held for its actual elapsed
  // interval (next-stamp - this-stamp), so the encoded video plays in
  // real time even though native capture rate was ~13fps.
  const concatPath = path.join(FRAMES_DIR, 'frames.txt');
  let concat = '';
  for (let f = 0; f < savedFrames; f++) {
    const dur = (f < savedFrames - 1)
      ? Math.max(0.001, (stamps[f + 1] - stamps[f]) / 1000)
      : Math.max(0.001, DURATION_S - stamps[f] / 1000);
    concat += `file '${path.join(FRAMES_DIR, `f${String(f).padStart(5,'0')}.jpg`)}'\n`;
    concat += `duration ${dur.toFixed(4)}\n`;
  }
  // Concat demuxer requires the last file repeated without a duration line.
  concat += `file '${path.join(FRAMES_DIR, `f${String(savedFrames-1).padStart(5,'0')}.jpg`)}'\n`;
  fs.writeFileSync(concatPath, concat);

  console.log('Encoding (variable durations → fixed 30fps)...');
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
  console.log(`   ${(stat.size / 1024 / 1024).toFixed(2)} MB · ${W}×${H} · ${DURATION_S}s · ${FPS}fps · H.264 silent`);

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
})();
