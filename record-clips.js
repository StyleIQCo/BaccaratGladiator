// Record all 5 clips for the promo sequencer.
//
//   clip1.mp4 — fresh recording: stage-select carousel rapid-scroll
//   clip2.mp4 — Ken Burns from previews/preview-ufc.jpg
//   clip3.mp4 — Ken Burns from previews/preview-gladiator.jpg
//   clip4.mp4 — Ken Burns from previews/preview-disco.jpg
//   clip5.mp4 — Ken Burns from previews/preview-mc.jpg
//
// Each clip: 1080x1920 vertical, 30fps, 5 seconds, H.264, faststart.
// Output goes next to promo-sequencer.html.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const W = 1080, H = 1920, FPS = 30, DUR = 5;
const TOTAL_FRAMES = DUR * FPS;
const PROJECT = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator';

async function captureFrames(page, framesDir) {
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const start = Date.now();
  const interval = 1000 / FPS;
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const target = i * interval;
    const elapsed = Date.now() - start;
    if (elapsed < target) await new Promise(r => setTimeout(r, target - elapsed));
    await page.screenshot({
      path: path.join(framesDir, `f${String(i).padStart(5, '0')}.jpg`),
      type: 'jpeg', quality: 92,
    });
    if (i % 30 === 0) process.stdout.write(`.`);
  }
}

function encodeMp4(framesDir, outPath) {
  const r = spawnSync('ffmpeg', [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(framesDir, 'f%05d.jpg'),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-vf', `scale=${W}:${H}:flags=lanczos`,
    outPath,
  ], { stdio: 'pipe' });
  return r.status === 0;
}

async function recordCarousel(outPath) {
  console.log('\n[clip1] stage-select carousel scroll');
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--hide-scrollbars',
           '--disable-renderer-backgrounding',
           '--disable-background-timer-throttling'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });

  // Pre-seed localStorage so all 10 tiers are unlocked — gives the
  // carousel scroll a fully-lit roster of vivid stages instead of a
  // greyed-out wall of locks.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bg_cleared_tiers',
      JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    localStorage.setItem('bg_visited_slugs', JSON.stringify([]));
  });

  await page.goto('https://baccaratgladiator.com/?v=' + Date.now(),
                  { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // The stage-select page was sized for desktop (max-width 600px deck,
  // max-height 640px). On a 1080×1920 capture that leaves huge dead
  // space top + bottom. Override sizing so the deck-frame fills more
  // vertical canvas, then trigger layout() so the carousel re-positions
  // its cards using the new container dimensions.
  await page.addStyleTag({
    content: `
      #deck-frame {
        max-width: none !important;
        max-height: none !important;
        width: 100% !important;
        height: 70vh !important;
        top: 52% !important;
      }
      .card { width: 88% !important; }
      /* Quiet the corner UI for a cleaner showcase frame */
      #btn-home  { opacity: 0 !important; }
      #coin-hint { display: none !important; }
    `,
  });
  await page.evaluate(() => {
    if (typeof layout === 'function') layout();
    window.dispatchEvent(new Event('resize'));
  });
  await new Promise(r => setTimeout(r, 200));

  // Kick off the rapid auto-scroll. ~440ms between taps × 12 taps ≈ 5.3s.
  // The bespoke cubic-bezier landing animation has 480ms duration, so
  // taps overlap their tails — keeps motion continuous, no dead frames.
  await page.evaluate(() => {
    let n = 0;
    const tap = () => {
      const btn = document.getElementById('btn-next');
      if (!btn) return;
      btn.click();
      n++;
      if (n < 12) setTimeout(tap, 440);
    };
    setTimeout(tap, 100);
  });

  const framesDir = '/tmp/clip1-frames';
  await captureFrames(page, framesDir);
  await browser.close();

  console.log('\n  encoding...');
  const ok = encodeMp4(framesDir, outPath);
  fs.rmSync(framesDir, { recursive: true, force: true });
  return ok;
}

async function recordKenBurns(jpgPath, outPath, label) {
  console.log(`\n[${label}] Ken Burns: ${path.basename(jpgPath)}`);
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });

  const fileUrl = 'file://' + path.resolve(PROJECT, 'kenburns.html')
                + '?img=' + encodeURIComponent('file://' + path.resolve(jpgPath));
  await page.goto(fileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  // Let fonts + image decode + initial layout settle so frame 0 isn't blank
  await new Promise(r => setTimeout(r, 600));

  const framesDir = '/tmp/' + label + '-frames';
  await captureFrames(page, framesDir);
  await browser.close();

  console.log('\n  encoding...');
  const ok = encodeMp4(framesDir, outPath);
  fs.rmSync(framesDir, { recursive: true, force: true });
  return ok;
}

(async () => {
  const t0 = Date.now();

  await recordCarousel(path.join(PROJECT, 'clip1.mp4'));

  const burns = [
    { jpg: 'previews/preview-ufc.jpg',       out: 'clip2.mp4', label: 'clip2' },
    { jpg: 'previews/preview-gladiator.jpg', out: 'clip3.mp4', label: 'clip3' },
    { jpg: 'previews/preview-disco.jpg',     out: 'clip4.mp4', label: 'clip4' },
    { jpg: 'previews/preview-mc.jpg',        out: 'clip5.mp4', label: 'clip5' },
  ];
  for (const b of burns) {
    await recordKenBurns(
      path.join(PROJECT, b.jpg),
      path.join(PROJECT, b.out),
      b.label,
    );
  }

  console.log(`\n\n✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('Files:');
  for (const f of ['clip1.mp4','clip2.mp4','clip3.mp4','clip4.mp4','clip5.mp4']) {
    const p = path.join(PROJECT, f);
    if (fs.existsSync(p)) {
      const size = fs.statSync(p).size;
      console.log(`  ${f}  ${(size / 1024 / 1024).toFixed(2)} MB`);
    } else {
      console.log(`  ${f}  ❌ missing`);
    }
  }
})();
