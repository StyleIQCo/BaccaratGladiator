// Assembles the 15s "Dragon 7 → Master The Arena" YouTube Short.
// Pipeline:
//   1. Download QR code (links to baccaratgladiator.com)
//   2. Render hook + CTA HTML pages via puppeteer, capture 30fps frame sequences
//   3. Slice climax from the source Dragon 7 capture
//   4. Synthesize the audio bed (drone → BRAMM hit → roar + crowd → outro pad)
//      and overlay the dealer's "nicely played" voice line
//   5. Encode hook + climax + cta video segments and concat
//   6. Mux video + audio → baccarat-gladiator-dragon7-15s.mp4

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT     = __dirname;
const SRC      = path.join(ROOT, 'baccarat-gladiator-macau-dragon7-short.mp4');
const OUT      = path.join(ROOT, 'baccarat-gladiator-dragon7-15s.mp4');
const TMP      = '/tmp/d7-15s';
const QR_URL   = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=https%3A%2F%2Fbaccaratgladiator.com&format=png&color=000000&bgcolor=FFFFFF&margin=10';
const QR_PATH  = path.join(TMP, 'qr.png');
const W = 1080, H = 1920, FPS = 30;

// Final timeline
const HOOK_DUR   = 3;  // 0–3s
const CLIMAX_DUR = 7;  // 3–10s
const CTA_DUR    = 5;  // 10–15s
// Source slicing — source[CLIMAX_SRC_START : CLIMAX_SRC_START + 7] is the climax.
// 0–10s source: betting → deal → reveal → win @ ~4.5s → celebration → dealer voice
// Picking [2:9] keeps the deal+reveal+celebration peak inside the 7s window,
// putting the win moment at climax t≈2.5s = final t≈5.5s.
const CLIMAX_SRC_START = 2;

function sh(cmd, opts = {}) {
  console.log('  $', cmd.replace(/\s+/g, ' ').slice(0, 200));
  return execSync(cmd, { stdio: 'inherit', ...opts });
}
function shQuiet(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function ensureTmp() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(path.join(TMP, 'hook-frames'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'cta-frames'),  { recursive: true });
}

// ─── 1. QR ─────────────────────────────────────────────────────────
function downloadQR() {
  console.log('\n[1/6] Downloading QR code…');
  sh(`curl -fsSL -o "${QR_PATH}" "${QR_URL}"`);
}

// ─── 2a. Hook card (3s) ────────────────────────────────────────────
// Uses a pre-extracted frame from the source ("table at the deal") as
// a bg, slow zoom-in via CSS transform, and the headline overlay.
function imgDataUrl(p, mime) {
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}

async function renderHookFrames(browser) {
  console.log('\n[2a/6] Rendering hook frames (3s × 30fps = 90 frames)…');
  const hookBgPath = path.join(TMP, 'hook-bg.jpg');
  // Pull a single frame ~0.5s into the source (table fully populated, bets visible)
  sh(`ffmpeg -y -hide_banner -loglevel error -ss 0.5 -i "${SRC}" -frames:v 1 -q:v 2 "${hookBgPath}"`);
  const hookBgUrl = imgDataUrl(hookBgPath, 'image/jpeg');

  const hookHtml = /* html */ `
<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@900&family=Cinzel+Decorative:wght@900&display=swap">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; background:#000; overflow:hidden; font-family:'Cinzel', serif; }
  .stage { position:absolute; inset:0; overflow:hidden; }
  .bg {
    position:absolute; inset:0;
    background:url('${hookBgUrl}') center/cover no-repeat;
    transform-origin:50% 60%;
    animation: hook-zoom ${HOOK_DUR}s cubic-bezier(0.22,0.61,0.36,1) forwards;
    filter:contrast(1.08) saturate(1.05);
  }
  @keyframes hook-zoom { 0% { transform:scale(1.00); } 100% { transform:scale(1.22); } }
  .vignette {
    position:absolute; inset:0;
    background:
      radial-gradient(ellipse 90% 70% at 50% 50%, transparent 50%, rgba(0,0,0,0.65) 100%),
      linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 25%, transparent 70%, rgba(0,0,0,0.55) 100%);
    pointer-events:none;
  }
  .scanline {
    position:absolute; inset:0;
    background:repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.10) 3px);
    mix-blend-mode:multiply; opacity:0.35; pointer-events:none;
  }
  /* Weathered-stone headline. Two-stack drop shadow + outer stroke + inner shading. */
  .headline {
    position:absolute; left:0; right:0; bottom:14%;
    text-align:center;
    font-family:'Cinzel Decorative','Cinzel', serif;
    font-weight:900;
    font-size:108px; letter-spacing:0.06em; line-height:1.0;
    color:#f4d97a;
    text-shadow:
      0 0 18px rgba(255,180,40,0.55),
      0 4px 0 #5a2008,
      0 6px 12px rgba(0,0,0,0.85);
    -webkit-text-stroke:2.5px #1a0608;
    opacity:0; transform:translateY(30px) scale(0.92);
    animation: headline-in 1.0s cubic-bezier(0.22,0.61,0.36,1) 0.3s forwards;
  }
  @keyframes headline-in {
    0%   { opacity:0; transform:translateY(30px) scale(0.92); }
    65%  { opacity:1; transform:translateY(-4px) scale(1.02); }
    100% { opacity:1; transform:translateY(0)  scale(1.00); }
  }
  .sub {
    position:absolute; left:0; right:0; bottom:11%;
    text-align:center;
    font-family:'Cinzel', serif; font-weight:900;
    font-size:30px; letter-spacing:0.5em;
    color:#ffd76e; text-transform:uppercase;
    opacity:0;
    animation: sub-in 0.7s ease 1.0s forwards;
    text-shadow:0 0 12px rgba(255,180,40,0.6);
  }
  @keyframes sub-in { from { opacity:0; letter-spacing:0.7em; } to { opacity:1; letter-spacing:0.5em; } }
  /* Top corner brand mark */
  .brand {
    position:absolute; top:60px; left:0; right:0;
    text-align:center;
    font-family:'Cinzel', serif; font-weight:900;
    font-size:34px; letter-spacing:0.42em;
    color:#fff7d6; text-transform:uppercase;
    text-shadow:0 0 12px rgba(0,0,0,0.85);
    opacity:0.92;
  }
  .brand .gold { color:#ffd76e; }
</style></head>
<body>
  <div class="stage">
    <div class="bg"></div>
    <div class="vignette"></div>
    <div class="scanline"></div>
    <div class="brand"><span class="gold">♛</span> &nbsp; BACCARAT GLADIATOR &nbsp; <span class="gold">♛</span></div>
    <div class="headline">THE DRAGON<br>HAS AWAKENED</div>
    <div class="sub">EZ Baccarat · Macau VIP</div>
  </div>
</body></html>`;

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(hookHtml, { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 200));

  // Disable real time, drive animations frame-by-frame via CSS animation pause + delay
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      el.style.animationPlayState = 'paused';
    });
  });

  const total = HOOK_DUR * FPS;
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate((tt) => {
      document.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.animationName && cs.animationName !== 'none') {
          el.style.animationDelay = `-${tt}s`;
        }
      });
    }, t);
    await page.screenshot({
      path: path.join(TMP, 'hook-frames', `f${String(i).padStart(4,'0')}.jpg`),
      type: 'jpeg', quality: 92, clip: { x:0, y:0, width:W, height:H },
    });
  }
  await page.close();
}

// ─── 2b. CTA card (5s) ─────────────────────────────────────────────
// Glassmorphic blur over the celebration final-frame, gold gradient
// "MASTER THE ARENA" headline, QR code, and BaccaratGladiator.com URL.
async function renderCtaFrames(browser) {
  console.log('\n[2b/6] Rendering CTA frames (5s × 30fps = 150 frames)…');
  const ctaBgPath = path.join(TMP, 'cta-bg.jpg');
  // Last meaningful frame of the source (peak celebration)
  sh(`ffmpeg -y -hide_banner -loglevel error -sseof -0.4 -i "${SRC}" -frames:v 1 -q:v 2 "${ctaBgPath}"`);
  const ctaBgUrl = imgDataUrl(ctaBgPath, 'image/jpeg');
  const qrUrl    = imgDataUrl(QR_PATH,   'image/png');

  const ctaHtml = /* html */ `
<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@900&family=Press+Start+2P&display=swap">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; background:#000; overflow:hidden; font-family:'Cinzel', serif; }
  .bg {
    position:absolute; inset:0;
    background:url('${ctaBgUrl}') center/cover no-repeat;
    filter:blur(28px) brightness(0.4) saturate(0.55);
    transform:scale(1.08);
  }
  /* Imperial overlay tint */
  .tint {
    position:absolute; inset:0;
    background:
      radial-gradient(ellipse 70% 50% at 50% 35%, rgba(255,180,40,0.18) 0%, transparent 60%),
      radial-gradient(ellipse 80% 80% at 50% 60%, rgba(184,0,31,0.32) 0%, rgba(20,4,8,0.65) 75%),
      linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.55) 100%);
  }
  .scanline {
    position:absolute; inset:0;
    background:repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.10) 3px);
    mix-blend-mode:multiply; opacity:0.35; pointer-events:none;
  }
  .lockup {
    position:absolute; inset:0;
    display:flex; flex-direction:column; align-items:center; justify-content:flex-start;
    padding-top:18%;
  }
  .badge {
    font-family:'Press Start 2P', monospace;
    font-size:20px; letter-spacing:0.42em; color:#ffd76e;
    text-transform:uppercase;
    text-shadow:0 0 14px rgba(255,180,40,0.65);
    margin-bottom:24px;
    opacity:0; animation: in-up 0.55s ease 0.1s forwards;
  }
  .headline {
    font-family:'Cinzel Decorative','Cinzel', serif; font-weight:900;
    font-size:130px; line-height:1.02; letter-spacing:-0.01em;
    text-align:center;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text; background-clip:text;
    -webkit-text-fill-color:transparent; color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85)) drop-shadow(0 0 32px rgba(255,180,40,0.5));
    margin-bottom:34px;
    opacity:0; animation: in-up 0.7s ease 0.25s forwards;
  }
  @keyframes in-up { from { opacity:0; transform:translateY(28px); } to { opacity:1; transform:translateY(0); } }
  /* Glassmorphic QR holder. Fixed inner dimensions so the QR always
     reserves its layout box even if image decode is slow. */
  .qrcard {
    width:560px; height:560px; padding:30px;
    background:linear-gradient(180deg, rgba(255,247,214,0.18), rgba(255,180,40,0.06));
    border:3px solid rgba(255,215,110,0.7);
    border-radius:22px;
    backdrop-filter: blur(12px) saturate(1.2);
    -webkit-backdrop-filter: blur(12px) saturate(1.2);
    box-shadow:
      0 12px 40px rgba(0,0,0,0.6),
      0 0 60px rgba(255,180,40,0.25),
      inset 0 0 24px rgba(255,215,110,0.08);
    opacity:0; transform:translateY(34px) scale(0.96);
    animation: qr-pop 0.8s cubic-bezier(0.22,0.61,0.36,1) 0.45s forwards;
  }
  @keyframes qr-pop { to { opacity:1; transform:translateY(0) scale(1); } }
  .qrcard img {
    width:500px; height:500px;
    display:block; border-radius:8px; background:#fff;
    image-rendering:pixelated;
  }
  .url {
    margin-top:34px;
    font-family:'Cinzel', serif; font-weight:900;
    font-size:62px; letter-spacing:0.06em;
    color:#fff7d6;
    text-shadow:0 0 18px rgba(255,180,40,0.6), 0 3px 6px rgba(0,0,0,0.85);
    opacity:0; animation: in-up 0.6s ease 0.7s forwards;
  }
  .url .dot { color:#ffd76e; }
  .pulse {
    margin-top:18px;
    font-family:'Press Start 2P', monospace;
    font-size:18px; letter-spacing:0.32em; color:#ff8a1a;
    text-transform:uppercase; text-shadow:0 0 10px rgba(255,138,26,0.7);
    opacity:0; animation: pulse-in 0.6s ease 1.0s forwards, pulse-blink 1.2s ease 1.6s infinite;
  }
  @keyframes pulse-in { from { opacity:0; } to { opacity:1; } }
  @keyframes pulse-blink { 0%,100% { opacity:1; } 50% { opacity:0.55; } }

  /* Corner ornaments — subtle gold flourishes */
  .corner {
    position:absolute; width:130px; height:130px;
    border:3px solid rgba(255,215,110,0.35);
    border-radius:6px;
  }
  .corner.tl { top:60px;  left:60px;  border-right:none;  border-bottom:none; }
  .corner.tr { top:60px;  right:60px; border-left:none;   border-bottom:none; }
  .corner.bl { bottom:60px; left:60px;  border-right:none; border-top:none; }
  .corner.br { bottom:60px; right:60px; border-left:none;  border-top:none; }
</style></head>
<body>
  <div class="bg"></div>
  <div class="tint"></div>
  <div class="scanline"></div>
  <div class="corner tl"></div>
  <div class="corner tr"></div>
  <div class="corner bl"></div>
  <div class="corner br"></div>
  <div class="lockup">
    <div class="badge">★ Free Play · 60+ Stages ★</div>
    <div class="headline">MASTER<br>THE ARENA</div>
    <div class="qrcard"><img src="${qrUrl}" alt="QR"></div>
    <div class="url">BaccaratGladiator<span class="dot">.</span>com</div>
    <div class="pulse">▶ Scan to Play</div>
  </div>
</body></html>`;

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(ctaHtml, { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => { el.style.animationPlayState = 'paused'; });
  });

  const total = CTA_DUR * FPS;
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate((tt) => {
      document.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.animationName && cs.animationName !== 'none') {
          el.style.animationDelay = `-${tt}s`;
        }
      });
    }, t);
    await page.screenshot({
      path: path.join(TMP, 'cta-frames', `f${String(i).padStart(4,'0')}.jpg`),
      type: 'jpeg', quality: 92, clip: { x:0, y:0, width:W, height:H },
    });
  }
  await page.close();
}

// ─── 3. Encode hook + cta frame sequences to mp4 ────────────────────
function encodeFramesToMp4(framesDir, outFile, durSec) {
  console.log(`  → ${path.basename(outFile)} (${durSec}s)`);
  sh(`ffmpeg -y -hide_banner -loglevel error \
    -framerate ${FPS} -i "${framesDir}/f%04d.jpg" \
    -t ${durSec} -r ${FPS} \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
    -an "${outFile}"`);
}

// ─── 4. Climax slice from source + AYNE overlay ─────────────────────
async function renderAyneOverlay(browser) {
  // Render "ARE YOU NOT ENTERTAINED?" as a transparent PNG using
  // Cinzel Decorative + thick stroke + drop shadow. Composited onto
  // the climax via ffmpeg overlay with a fade curve at the win moment.
  console.log('  Rendering AYNE overlay PNG…');
  const html = /* html */ `
<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@900&family=Cinzel+Decorative:wght@900&display=swap">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; background:transparent; }
  .wrap {
    position:absolute; left:0; right:0; top:50%; transform:translateY(-58%);
    text-align:center;
    font-family:'Cinzel Decorative','Cinzel', serif;
    font-weight:900;
    font-size:148px; line-height:1.02; letter-spacing:0.01em;
    color:#fff7d6;
    text-transform:uppercase;
    -webkit-text-stroke:4px #1a0408;
    text-shadow:
      0 0 22px rgba(255,180,40,0.55),
      0 6px 0 #5a0010,
      0 10px 22px rgba(0,0,0,0.85);
  }
  .q { color:#ffd76e; -webkit-text-stroke:4px #5a0010; }
</style></head>
<body><div class="wrap">ARE YOU NOT<br>ENTERTAINED<span class="q">?</span></div></body></html>`;
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto('data:text/html;base64,' + Buffer.from(html).toString('base64'),
                   { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 200));
  const out = path.join(TMP, 'ayne.png');
  await page.screenshot({ path: out, type: 'png', omitBackground: true,
                          clip: { x:0, y:0, width:W, height:H } });
  await page.close();
  return out;
}

function buildClimaxSegment(aynePng) {
  console.log('\n[4/6] Slicing climax + AYNE overlay…');
  const climaxOut = path.join(TMP, 'seg-climax.mp4');

  // Win moment lands at climax t≈2.5s (= 5.5s in final). Fade in 0.3s,
  // hold 1.7s, fade out 0.6s.
  const filter = `
    [0:v]setpts=PTS-STARTPTS[v];
    [1:v]format=rgba,
         fade=t=in:st=2.4:d=0.3:alpha=1,
         fade=t=out:st=4.4:d=0.6:alpha=1[ayne];
    [v][ayne]overlay=0:0:eof_action=pass:format=auto
  `.replace(/\s+/g, ' ').trim();

  sh(`ffmpeg -y -hide_banner -loglevel error \
      -ss ${CLIMAX_SRC_START} -t ${CLIMAX_DUR} -i "${SRC}" \
      -loop 1 -t ${CLIMAX_DUR} -i "${aynePng}" \
      -filter_complex "${filter}" \
      -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
      -an "${climaxOut}"`);

  return climaxOut;
}

// ─── 5. Audio bed + dealer voice ────────────────────────────────────
function buildAudioBed() {
  console.log('\n[5/6] Synthesizing audio bed…');
  const out = path.join(TMP, 'audio-bed.m4a');
  const dealer = path.join(ROOT, 'dealer', 'warm_congrats.mp4');

  // Strategy: each input is a single lavfi source (one sine tone or one
  // noise color). Filtergraph mixes/processes them. Layer index → label:
  //   [0..2]  drone  (3 sines @ 55/82/110Hz, 3s)
  //   [3]     bramm sub-bass (sine 50Hz, 1.2s)
  //   [4]     bramm crash    (white noise, 1.2s, hi-pass for shimmer)
  //   [5]     crowd          (pink noise, 6s, band-pass)
  //   [6]     roar           (brown noise, 2s, low-pass + bass boost)
  //   [7..10] outro pad      (4 sines as Em9 stack, 5s)
  //   [11]    dealer voice line
  const filter = `
    [0]volume=0.5[d0];[1]volume=0.4[d1];[2]volume=0.3[d2];
    [d0][d1][d2]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,
      afade=t=in:st=0:d=0.4,afade=t=out:st=2.7:d=0.3,
      adelay=0|0[drone];
    [3]volume=2.6[bb];[4]highpass=f=3500,volume=1.2[bc];
    [bb][bc]amix=inputs=2:duration=longest:weights='1 0.55':normalize=0,
      afade=t=in:st=0:d=0.005,afade=t=out:st=0.65:d=0.45,
      adelay=3000|3000[bramm];
    [5]bandpass=f=1500:width_type=h:width=1800,volume=0.55,
      afade=t=in:st=0:d=1.2,afade=t=out:st=4.5:d=1.2,
      adelay=4000|4000[crowd];
    [6]lowpass=f=400,bass=g=14,volume=1.5,
      afade=t=in:st=0:d=0.15,afade=t=out:st=1.6:d=0.5,
      adelay=5300|5300[roar];
    [7]volume=0.32[p0];[8]volume=0.28[p1];[9]volume=0.22[p2];[10]volume=0.18[p3];
    [p0][p1][p2][p3]amix=inputs=4:duration=longest:dropout_transition=0:normalize=0,
      afade=t=in:st=0:d=0.5,afade=t=out:st=4:d=1,
      adelay=10000|10000[pad];
    [11:a]volume=1.55,adelay=5500|5500[dealer];
    [drone][bramm][crowd][roar][pad][dealer]amix=inputs=6:duration=longest:dropout_transition=0:normalize=0,
      alimiter=limit=0.97,
      atrim=0:15,
      afade=t=out:st=14.6:d=0.4
  `.replace(/\s+/g, ' ').trim();

  sh(`ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -t 3   -i "sine=f=55"   -f lavfi -t 3   -i "sine=f=82"   -f lavfi -t 3   -i "sine=f=110" \
    -f lavfi -t 1.2 -i "sine=f=50"   -f lavfi -t 1.2 -i "anoisesrc=color=white:amplitude=0.6" \
    -f lavfi -t 6   -i "anoisesrc=color=pink:amplitude=0.45" \
    -f lavfi -t 2   -i "anoisesrc=color=brown:amplitude=0.7" \
    -f lavfi -t 5   -i "sine=f=164.81" -f lavfi -t 5   -i "sine=f=246.94" \
    -f lavfi -t 5   -i "sine=f=329.63" -f lavfi -t 5   -i "sine=f=415.30" \
    -i "${dealer}" \
    -filter_complex "${filter}" \
    -ac 2 -c:a aac -b:a 192k "${out}"`);
  return out;
}

// ─── 6. Concat segments + mux audio ─────────────────────────────────
function finalAssembly(hookMp4, climaxMp4, ctaMp4, audioFile) {
  console.log('\n[6/6] Concat + mux…');
  const concatList = path.join(TMP, 'concat.txt');
  fs.writeFileSync(concatList,
    `file '${hookMp4}'\nfile '${climaxMp4}'\nfile '${ctaMp4}'\n`);
  const videoOnly = path.join(TMP, 'video-only.mp4');
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${concatList}" -c copy "${videoOnly}"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${videoOnly}" -i "${audioFile}" \
      -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest \
      -movflags +faststart "${OUT}"`);
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`Missing source: ${SRC}`);
    process.exit(1);
  }
  ensureTmp();
  downloadQR();

  console.log('\n[2/6] Rendering hook + CTA via puppeteer…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  await renderHookFrames(browser);
  await renderCtaFrames(browser);
  const aynePng = await renderAyneOverlay(browser);
  await browser.close();

  console.log('\n[3/6] Encoding hook + CTA segments…');
  const hookMp4 = path.join(TMP, 'seg-hook.mp4');
  const ctaMp4  = path.join(TMP, 'seg-cta.mp4');
  encodeFramesToMp4(path.join(TMP, 'hook-frames'), hookMp4, HOOK_DUR);
  encodeFramesToMp4(path.join(TMP, 'cta-frames'),  ctaMp4,  CTA_DUR);

  const climaxMp4 = buildClimaxSegment(aynePng);
  const audioFile = buildAudioBed();

  finalAssembly(hookMp4, climaxMp4, ctaMp4, audioFile);

  const stat = fs.statSync(OUT);
  const probe = shQuiet(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${OUT}"`).trim();
  console.log('\n──────────────────────────────────────────────');
  console.log(`✓ ${OUT}`);
  console.log(`  ${(stat.size/1024/1024).toFixed(2)} MB · ${probe}s · ${W}×${H} · ${FPS}fps · H.264 + AAC`);
  console.log('──────────────────────────────────────────────');
})().catch(e => { console.error(e); process.exit(1); });
