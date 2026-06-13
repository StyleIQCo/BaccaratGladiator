// Generates the YouTube Shorts thumbnail for the Dragon 7 ad.
//
// Output:
//   thumb-dragon7-9x16.jpg  — 1080×1920 (Shorts feed, search, channel)
//   thumb-dragon7-16x9.jpg  — 1280×720  (in case you ever cross-post horizontal)
//
// Composition:
//   • Background: peak Dragon 7 celebration frame from the source clip,
//     gently blurred + crimson tint so the foreground reads.
//   • Center lockup: massive gold "40:1" + "DRAGON 7 HIT" + a tinted
//     glassmorphic backdrop so it pops at YouTube's small render size.
//   • Top: "BACCARAT GLADIATOR" arcade brand mark in gold gradient.
//   • Bottom: "PLAY FREE — BACCARATGLADIATOR.COM" + dragon emoji.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT  = __dirname;
const SRC   = path.join(ROOT, 'baccarat-gladiator-macau-dragon7-short.mp4');
const TMP   = '/tmp/d7-thumb';
const OUT_V = path.join(ROOT, 'thumb-dragon7-9x16.jpg');
const OUT_H = path.join(ROOT, 'thumb-dragon7-16x9.jpg');

function sh(cmd) {
  console.log('  $', cmd.replace(/\s+/g, ' ').slice(0, 220));
  return execSync(cmd, { stdio: 'inherit' });
}
function dataUrl(p, mime) {
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  console.log('\n[1/3] Extracting peak celebration frame from source…');
  // The Dragon 7 reveal + dragon flyby peaks ~4.7-5.0s into the source clip
  // (third-card flip + golden glow). Grab a frame just past the flip so
  // the celebration is in full bloom.
  const bg = path.join(TMP, 'bg.jpg');
  sh(`ffmpeg -y -hide_banner -loglevel error -ss 4.85 -i "${SRC}" \
      -frames:v 1 -q:v 2 "${bg}"`);

  const bgUrl = dataUrl(bg, 'image/jpeg');

  console.log('\n[2/3] Rendering thumbnails via puppeteer…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  async function render({ W, H, outPath, layout }) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@900&family=Press+Start+2P&display=swap">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; background:#000; overflow:hidden; font-family:'Cinzel', serif; }

  /* Hero background — celebration frame, lightly blurred + crimson-tinted */
  .bg {
    position:absolute; inset:0;
    background:url('${bgUrl}') center/cover no-repeat;
    filter: blur(${layout.bgBlur}px) saturate(1.1) brightness(0.65);
    transform:scale(1.06);
  }
  .tint {
    position:absolute; inset:0;
    background:
      radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.30) 0%, transparent 55%),
      radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45) 0%, rgba(20,4,8,0.65) 75%),
      linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.55) 100%);
    pointer-events:none;
  }
  .scanline {
    position:absolute; inset:0;
    background:repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.10) 3px);
    mix-blend-mode:multiply; opacity:0.30;
  }

  /* Top brand mark */
  .brand {
    position:absolute; top:${layout.brandTop}px; left:0; right:0;
    text-align:center;
  }
  .brand .pre {
    font-family:'Press Start 2P', monospace;
    font-size:${layout.brandPre}px; letter-spacing:0.42em;
    color:#ff6cfa;
    text-shadow:0 0 14px rgba(255,108,250,0.65), 0 1px 3px rgba(0,0,0,0.85);
    margin-bottom:14px;
  }
  .brand .title {
    font-family:'Cinzel', serif; font-weight:900;
    font-size:${layout.brandTitle}px; letter-spacing:0.06em;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text; background-clip:text;
    -webkit-text-fill-color:transparent; color:transparent;
    filter:drop-shadow(0 4px 14px rgba(0,0,0,0.85)) drop-shadow(0 0 22px rgba(255,180,40,0.45));
  }

  /* Center lockup — the headline that does ALL the work at thumb size */
  .hero {
    position:absolute; left:50%; top:50%; transform:translate(-50%, -52%);
    text-align:center;
    width:${layout.heroW}px;
    padding:${layout.heroPad}px;
    background:linear-gradient(180deg, rgba(255,247,214,0.10), rgba(184,0,31,0.06));
    border:3px solid rgba(255,215,110,0.65);
    border-radius:28px;
    box-shadow:
      0 12px 40px rgba(0,0,0,0.55),
      0 0 70px rgba(255,180,40,0.30),
      inset 0 0 28px rgba(255,215,110,0.10);
    backdrop-filter: blur(14px) saturate(1.15);
    -webkit-backdrop-filter: blur(14px) saturate(1.15);
  }
  .hero .multiplier {
    font-family:'Cinzel Decorative', 'Cinzel', serif; font-weight:900;
    font-size:${layout.multSize}px; line-height:0.95; letter-spacing:-0.02em;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 30%, #ff8a1a 70%, #b8001f 100%);
    -webkit-background-clip:text; background-clip:text;
    -webkit-text-fill-color:transparent; color:transparent;
    filter:drop-shadow(0 8px 22px rgba(0,0,0,0.85)) drop-shadow(0 0 36px rgba(255,180,40,0.55));
    text-shadow: 0 2px 0 rgba(0,0,0,0.5);
  }
  .hero .label {
    margin-top:18px;
    font-family:'Cinzel', serif; font-weight:900;
    font-size:${layout.labelSize}px; letter-spacing:0.18em;
    color:#fff7d6;
    text-shadow:0 0 18px rgba(255,180,40,0.6), 0 3px 6px rgba(0,0,0,0.85);
  }
  .hero .label .dragon { color:#ffd76e; }

  /* Big dragon emoji floating to the side */
  .dragon-emoji {
    position:absolute;
    top:${layout.dragonTop}px; left:50%;
    transform: translateX(${layout.dragonShift}px) rotate(${layout.dragonRot}deg);
    font-size:${layout.dragonSize}px;
    line-height:1;
    filter:
      drop-shadow(0 0 32px #ffaa1a)
      drop-shadow(0 0 16px #ff5e00)
      drop-shadow(0 8px 14px rgba(0,0,0,0.85));
  }

  /* Bottom CTA bar */
  .cta {
    position:absolute; left:0; right:0; bottom:${layout.ctaBottom}px;
    text-align:center;
  }
  .cta .play {
    display:inline-block;
    padding:${layout.ctaPad};
    background:linear-gradient(180deg, #ffd76e 0%, #ff8a1a 70%, #b8001f 100%);
    color:#1a0408;
    font-family:'Cinzel', serif; font-weight:900;
    font-size:${layout.ctaSize}px; letter-spacing:0.22em;
    border-radius:${layout.ctaRadius}px;
    border:3px solid rgba(255,247,214,0.85);
    box-shadow:0 8px 22px rgba(0,0,0,0.55), 0 0 28px rgba(255,180,40,0.4);
    text-shadow:0 1px 0 rgba(255,255,255,0.45);
  }
  .cta .url {
    display:block; margin-top:${layout.urlMargin}px;
    font-family:'Press Start 2P', monospace;
    font-size:${layout.urlSize}px; letter-spacing:0.32em;
    color:#ffd76e;
    text-shadow:0 0 14px rgba(255,180,40,0.65), 0 2px 4px rgba(0,0,0,0.85);
    text-transform:uppercase;
  }

  /* Vignette + corner brackets */
  .vignette {
    position:absolute; inset:0;
    background:radial-gradient(ellipse 80% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%);
    pointer-events:none;
  }
  .corner {
    position:absolute; width:${layout.cornerSize}px; height:${layout.cornerSize}px;
    border:3px solid rgba(255,215,110,0.55);
  }
  .corner.tl { top:48px;  left:48px;  border-right:none;  border-bottom:none; }
  .corner.tr { top:48px;  right:48px; border-left:none;   border-bottom:none; }
  .corner.bl { bottom:48px; left:48px;  border-right:none; border-top:none; }
  .corner.br { bottom:48px; right:48px; border-left:none;  border-top:none; }
</style></head>
<body>
  <div class="bg"></div>
  <div class="tint"></div>
  <div class="scanline"></div>

  <div class="corner tl"></div>
  <div class="corner tr"></div>
  <div class="corner bl"></div>
  <div class="corner br"></div>

  <div class="brand">
    <div class="pre">★ INSERT COIN ★</div>
    <div class="title">BACCARAT GLADIATOR</div>
  </div>

  <div class="hero">
    <div class="multiplier">40:1</div>
    <div class="label"><span class="dragon">🐉</span> &nbsp; DRAGON 7 HIT &nbsp; <span class="dragon">🐉</span></div>
  </div>

  <div class="cta">
    <span class="play">PLAY FREE</span>
    <span class="url">BaccaratGladiator.com</span>
  </div>

  <div class="vignette"></div>
</body></html>`;

    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle2' });
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 250));
    await page.screenshot({
      path: outPath, type: 'jpeg', quality: 92,
      clip: { x: 0, y: 0, width: W, height: H },
    });
    await page.close();
    console.log(`  ${path.basename(outPath)} (${W}×${H})`);
  }

  // 9:16 portrait — Shorts thumbnail
  await render({
    W: 1080, H: 1920, outPath: OUT_V,
    layout: {
      bgBlur: 6,
      brandTop: 110, brandPre: 24, brandTitle: 78,
      heroW: 880, heroPad: 56,
      multSize: 380, labelSize: 56,
      dragonTop: 1180, dragonShift: 0, dragonRot: 0, dragonSize: 0, // not used in 9:16
      ctaBottom: 180, ctaPad: '26px 56px', ctaSize: 50, ctaRadius: 70,
      urlMargin: 28, urlSize: 28,
      cornerSize: 130,
    },
  });

  // 16:9 landscape — for cross-posting / channel banner future use
  await render({
    W: 1280, H: 720, outPath: OUT_H,
    layout: {
      bgBlur: 4,
      brandTop: 60, brandPre: 16, brandTitle: 48,
      heroW: 760, heroPad: 36,
      multSize: 240, labelSize: 38,
      dragonTop: 0, dragonShift: 0, dragonRot: 0, dragonSize: 0,
      ctaBottom: 50, ctaPad: '16px 38px', ctaSize: 32, ctaRadius: 50,
      urlMargin: 16, urlSize: 18,
      cornerSize: 90,
    },
  });

  await browser.close();

  console.log('\n[3/3] Done.');
  console.log('──────────────────────────────────────────────');
  for (const p of [OUT_V, OUT_H]) {
    const stat = fs.statSync(p);
    console.log(`  ${path.basename(p)}  ${(stat.size/1024).toFixed(1)} KB`);
  }
  console.log('──────────────────────────────────────────────');
})().catch(e => { console.error(e); process.exit(1); });
