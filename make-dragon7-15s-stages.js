// Builds a "stages" variant of the 15s Dragon 7 Short.
//
// Layout
//   0:00–0:03  Hook        (re-uses the existing hook segment)
//   0:03–0:10  Climax      (re-uses the existing climax segment)
//   0:10–0:12  Stage reel  (vertical scroll through 60 stage tiles +
//                           "60+ STAGES TO CLEAR" header)
//   0:12–0:15  CTA card    (last 3s of the existing CTA card)
//
// Output: baccarat-gladiator-dragon7-15s-stages.mp4 (does NOT touch
// baccarat-gladiator-dragon7-15s.mp4 — that file stays as-is).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT       = __dirname;
const SRC_15S    = path.join(ROOT, 'baccarat-gladiator-dragon7-15s.mp4');
const OUT        = path.join(ROOT, 'baccarat-gladiator-dragon7-15s-stages.mp4');
const TMP        = '/tmp/d7-15s-stages';
const QR_PATH    = '/tmp/d7-15s/qr.png';     // re-use prior render
const W = 1080, H = 1920, FPS = 30;
const REEL_DUR   = 17;    // 0:10–0:27 — leisurely auto-advance, 7 stages visible
const CTA_KEEP   = 3;     // 0:27–0:30 — settled CTA card (final 3s of the 15s base)
// Final timeline: 3s hook + 7s climax + 17s reel + 3s CTA = 30 s total.

function sh(cmd){
  console.log('  $', cmd.replace(/\s+/g, ' ').slice(0, 220));
  return execSync(cmd, { stdio: 'inherit' });
}
function imgDataUrl(p, mime){
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}

// ── 1. Capture the LIVE stage selector at baccaratgladiator.com ──
// Drives a real Chromium session against the production homepage, lets
// the carousel auto-advance, and saves 2s @ 30fps of frames.
async function renderStageReelFrames(){
  console.log('\n[1/4] Capturing live stage selector from https://baccaratgladiator.com/ …');
  fs.mkdirSync(path.join(TMP, 'reel-frames'), { recursive: true });

  // Capture at a phone-sized viewport (true 9:16, ~iPhone 14 Pro) then
  // upscale with LANCZOS to 1080x1920 in the encode step. This makes
  // the carousel fill the frame instead of floating in empty headroom.
  const VW = 540, VH = 960;
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--font-render-hinting=none',
      `--window-size=${VW},${VH}`,
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

  // Force absolutely fresh content: disable Chromium HTTP cache and
  // bypass any registered Service Worker so we never read a stale
  // STAGES array out of /sw.js's runtime cache.
  await page.setCacheEnabled(false);
  if (typeof page.setBypassServiceWorker === 'function') {
    await page.setBypassServiceWorker(true);
  } else {
    // Older puppeteer: drop all caches via CDP after first load.
    const client = await page.target().createCDPSession();
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    await client.send('Network.clearBrowserCache');
  }

  // Bust SW cache by appending a query string so we get the freshest deploy.
  const url = 'https://baccaratgladiator.com/?bust=' + Date.now();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);

  // Give the carousel + any entry animations time to settle so the
  // capture starts on the first visible "polished" beat, not on
  // half-rendered content.
  await new Promise(r => setTimeout(r, 1500));

  // Force the page into a clean state for the capture: dismiss any
  // overlay/banner, scroll to top, and start the carousel auto-advance
  // if it's user-driven. Specific selectors below are best-effort —
  // failures are silently ignored so the script still works if any
  // class names change on the live site.
  await page.evaluate(() => {
    try {
      window.scrollTo(0, 0);
      document.querySelectorAll('[class*="update"], [class*="banner"], [id*="update"]')
        .forEach(el => { try { el.remove(); } catch (_) {} });

      // The live page's #deck-frame is centered on viewport (top:50%) and
      // capped at max-height:640px, leaving lots of empty starfield above
      // and below in 9:16. Scale it up + pull slightly higher so the
      // carousel commands the frame; keep #marquee + #dock visible.
      // Also slow down the card slide transition so each stage lingers
      // visibly instead of blurring past.
      const css = document.createElement('style');
      css.textContent = `
        #deck-frame {
          transform: translate(-50%, -54%) scale(1.45) !important;
          max-width: 560px !important;
          height: 64vh !important;
          max-height: 640px !important;
        }
        #marquee { top: max(8px,env(safe-area-inset-top)) !important; }
        #coin-hint { display: none !important; }
        /* Slow each carousel slide so the viewer can read each stage. */
        #deck, #deck *, .card, .card * {
          transition-duration: 2400ms !important;
          animation-duration: 2400ms !important;
        }
      `;
      document.head.appendChild(css);
    } catch (_) {}
  });

  // Brief settle so the transform applies before we start capturing.
  await new Promise(r => setTimeout(r, 250));

  // 17 s window with 2400 ms slide transitions + 3000 ms between advances.
  // 5 advances ⇒ 6 distinct stages, each ~3 s on screen (settle + very
  // slow slide).  1 s lead-in + ~1 s tail-out.  Deliberate, contemplative
  // pace — viewer can read each venue's name and tag.
  const advanceEvery = 3000;
  const maxAdvances  = 5;
  const total = REEL_DUR * FPS;
  const startedAt = Date.now();
  let nextAdvance = Date.now() + 1000; // generous lead-in
  let advances    = 0;

  // Record exact click moments (seconds from reel start) so the audio
  // pipeline can re-synthesize the page's nav-blip sound at those times.
  const blipTimes = [];
  for (let i = 0; i < total; i++){
    if (advances < maxAdvances && Date.now() >= nextAdvance) {
      // Fire a synthetic next-stage gesture. The live homepage uses
      // #btn-next as the right arrow; fall back to ArrowRight key.
      await page.evaluate(() => {
        const btn = document.getElementById('btn-next');
        if (btn) { btn.click(); return; }
        const evt = new KeyboardEvent('keydown', { key: 'ArrowRight' });
        window.dispatchEvent(evt);
      });
      blipTimes.push((Date.now() - startedAt) / 1000);
      nextAdvance = Date.now() + advanceEvery;
      advances += 1;
    }
    await page.screenshot({
      path: path.join(TMP, 'reel-frames', `f${String(i).padStart(4,'0')}.jpg`),
      type: 'jpeg', quality: 92, clip: { x:0, y:0, width:VW, height:VH },
    });
    // Pace the loop so we capture roughly 30fps wall-clock too.
    const targetT = startedAt + (i + 1) * (1000 / FPS);
    const remaining = targetT - Date.now();
    if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
  }
  await browser.close();
  console.log(`  Captured ${total} frames from live homepage.`);
  console.log(`  Logged ${blipTimes.length} nav-blip moments (s from reel start): ${blipTimes.map(t => t.toFixed(2)).join(', ')}`);
  fs.writeFileSync(`${TMP}/blips.json`, JSON.stringify(blipTimes));
}

// ── 3. Slice existing 15s into segments + encode reel ──
function buildSplice(){
  console.log('\n[2/4] Slicing existing 15s short into A (0–10s) + C (12–15s)…');
  // A: hook + climax (0–10.000s).
  // Important: re-encode (NOT -c copy) so the cut lands exactly on the
  // climax's last frame. With -c copy the cut snaps to the nearest
  // keyframe past 10s, which leaks a frame of the CTA card (QR flash)
  // at the splice boundary.
  sh(`ffmpeg -y -hide_banner -loglevel error -ss 0 -t 10 -i "${SRC_15S}" \
      -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
      -an "${TMP}/seg-a.mp4"`);
  // C: last 3s of CTA (12–15s) — also re-encoded for clean splice.
  sh(`ffmpeg -y -hide_banner -loglevel error -ss 12 -t ${CTA_KEEP} -i "${SRC_15S}" \
      -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
      -an "${TMP}/seg-c.mp4"`);

  console.log('\n[3/4] Encoding stage-reel segment (LANCZOS upscale → 1080x1920)…');
  sh(`ffmpeg -y -hide_banner -loglevel error \
      -framerate ${FPS} -i "${TMP}/reel-frames/f%04d.jpg" \
      -vf "scale=${W}:${H}:flags=lanczos" \
      -t ${REEL_DUR} -r ${FPS} \
      -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
      -an "${TMP}/seg-b.mp4"`);
}

// ── 4. Concat + remux dealer audio from current 15s short ──
function finalAssembly(){
  console.log('\n[4/4] Concat + remux dealer audio…');
  fs.writeFileSync(`${TMP}/concat.txt`,
    `file '${TMP}/seg-a.mp4'\nfile '${TMP}/seg-b.mp4'\nfile '${TMP}/seg-c.mp4'\n`);
  // Concat may need a re-encode if the codec params drift between A and the new B.
  // Use the concat demuxer with `-c copy`; if codec params differ ffmpeg will warn —
  // in that case fall back to filter_complex concat with re-encode.
  try {
    sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${TMP}/concat.txt" \
        -c copy "${TMP}/video-only.mp4"`);
  } catch (e) {
    console.log('  concat -c copy failed, falling back to filter_complex re-encode…');
    sh(`ffmpeg -y -hide_banner -loglevel error \
        -i "${TMP}/seg-a.mp4" -i "${TMP}/seg-b.mp4" -i "${TMP}/seg-c.mp4" \
        -filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]" -map "[v]" \
        -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
        "${TMP}/video-only.mp4"`);
  }
  // Build the 30 s audio bed: existing dealer voice (lands at ~5.5 s in
  // final timeline, untouched) + synthesized nav-blip per recorded
  // click during the stage reel.
  //
  // navBlip recipe from index.html line 614:
  //   blip(540 Hz, 40 ms, square, gain 0.04)
  // Approximated here with a sine + a fast exponential decay envelope.
  const TOTAL_DUR = 3 + 7 + REEL_DUR + CTA_KEEP; // 30
  const reelStart = 3 + 7;                       // 10 s
  const blipTimes = JSON.parse(fs.readFileSync(`${TMP}/blips.json`, 'utf8'));

  // Step 1 — extract the existing dealer audio padded to 30 s.
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${SRC_15S}" \
      -vn -af "apad,atrim=0:${TOTAL_DUR}" \
      -ar 48000 -ac 2 -c:a pcm_s16le "${TMP}/audio-dealer.wav"`);

  // Step 2 — generate one short blip wav (used for each click via -stream_loop).
  // ~80 ms 540 Hz sine with sharp attack + 60 ms decay; volume bumped so it
  // reads as a discrete arcade tick over silence.
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 0.10 \
      -i "sine=f=540:sample_rate=48000" \
      -af "volume=0.55,afade=t=in:st=0:d=0.005,afade=t=out:st=0.045:d=0.05" \
      -ac 2 -c:a pcm_s16le "${TMP}/blip.wav"`);

  // Step 3 — build the blip-only 30 s track. Anchor on a 30 s silent
  // base via anullsrc so amix's `duration=first` cleanly bounds the
  // output. (Earlier `apad,atrim` chain spun forever under ffmpeg 8.1.)
  if (blipTimes.length > 0) {
    const blipInputs = blipTimes.map(_ => `-i "${TMP}/blip.wav"`).join(' ');
    const filters = blipTimes.map((t, i) => {
      const ms = Math.round((reelStart + t) * 1000);
      // Input index is i+1 because input 0 is the silence anchor.
      return `[${i+1}]adelay=${ms}|${ms}[d${i}]`;
    }).join(';');
    const labels = blipTimes.map((_, i) => `[d${i}]`).join('');
    const fc = `${filters};[0]${labels}amix=inputs=${blipTimes.length+1}:duration=first:dropout_transition=0:normalize=0[bblips]`;
    sh(`ffmpeg -y -hide_banner -loglevel error \
        -f lavfi -t ${TOTAL_DUR} -i "anullsrc=cl=stereo:r=48000" \
        ${blipInputs} \
        -filter_complex "${fc}" -map "[bblips]" \
        -ar 48000 -ac 2 -c:a pcm_s16le "${TMP}/audio-blips.wav"`);

    // Step 4 — mix dealer + blips into final AAC (192 kbps, 48 kHz).
    sh(`ffmpeg -y -hide_banner -loglevel error \
        -i "${TMP}/audio-dealer.wav" -i "${TMP}/audio-blips.wav" \
        -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.97" \
        -ar 48000 -ac 2 -c:a aac -b:a 192k "${TMP}/audio.m4a"`);
  } else {
    // No blips logged — just use the dealer audio as-is.
    sh(`ffmpeg -y -hide_banner -loglevel error -i "${TMP}/audio-dealer.wav" \
        -ar 48000 -ac 2 -c:a aac -b:a 192k "${TMP}/audio.m4a"`);
  }

  sh(`ffmpeg -y -hide_banner -loglevel error \
      -i "${TMP}/video-only.mp4" -i "${TMP}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy \
      -movflags +faststart "${OUT}"`);
}

(async () => {
  if (!fs.existsSync(SRC_15S)) {
    console.error(`Missing source 15s short: ${SRC_15S}`);
    process.exit(1);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  await renderStageReelFrames();
  buildSplice();
  finalAssembly();

  const stat = fs.statSync(OUT);
  const probe = execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${OUT}"`).toString().trim();
  console.log('\n──────────────────────────────────────────────');
  console.log(`✓ ${OUT}`);
  console.log(`  ${(stat.size/1024/1024).toFixed(2)} MB · ${probe}s · ${W}×${H} · ${FPS}fps`);
  console.log('──────────────────────────────────────────────');
})().catch(e => { console.error(e); process.exit(1); });
