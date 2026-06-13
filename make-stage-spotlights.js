// Batch-renders 12 "Stage Spotlight" Shorts for the Baccarat Gladiator
// content-marketing series. Each Short is ~15 s with the same template:
//
//   0:00–0:02  Brand intro card    ("INSERT COIN · STAGE NN")
//   0:02–0:11  Live carousel capture from https://baccaratgladiator.com/
//              with the carousel paused on the target stage.  Slow Ken
//              Burns + scanline.
//   0:11–0:13  Stage tag-line panel
//   0:13–0:15  CTA card
//
// Output: shorts/06–17 (12 mp4s)
//
// Common audio bed: silence — these post fine on every platform without
// audio-classifier triggers.  YouTube auto-supplies music or you can
// add it in Studio post-upload.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const OUT  = path.join(ROOT, 'shorts');
const TMP  = '/tmp/stage-spotlights';
const QR   = '/tmp/d7-15s/qr.png';
const W = 1080, H = 1920, FPS = 30;
const CAROUSEL_VW = 540, CAROUSEL_VH = 960;

// 12 stages chosen for variety across tiers + region + appeal.
// `idx` = 0-based position of the stage in the homepage carousel.
// We advance by N right-arrow clicks from the default starting stage.
// `n` is the public Short number written into the intro card.
const STAGES = [
  { n: '06', slug: 'macau',        name: 'Macau',           tag: 'Cotai Strip · Imperial Dragon',     tier: 1,  region: '🇲🇴', advances: 0  },
  { n: '07', slug: 'huff-puff',    name: 'Big Bad Wolfie',  tag: 'Howl at the moon',                  tier: 1,  region: '🐺', advances: 4  },
  { n: '08', slug: 'toy-story',    name: 'Toy Cosmos',      tag: 'Bedroom rocket · to the moon',      tier: 1,  region: '🚀', advances: 5  },
  { n: '09', slug: 'cat-cafe',     name: 'Cat Cafe',        tag: 'Tokyo paw bets',                    tier: 1,  region: '🐱', advances: 1  },
  { n: '10', slug: 'marrakech',    name: 'Marrakech',       tag: 'Souk · spice & velvet',             tier: 2,  region: '🇲🇦', advances: 12 },
  { n: '11', slug: 'kenya',        name: 'Kenya',           tag: 'Savanna · sunrise pit',             tier: 3,  region: '🇰🇪', advances: 13 },
  { n: '12', slug: 'coachella',    name: 'Coachella',       tag: 'Festival ferris · neon sand',       tier: 4,  region: '🎡', advances: 22 },
  { n: '13', slug: 'spain',        name: 'Spain',           tag: 'Madrid · matador red',              tier: 5,  region: '🇪🇸', advances: 28 },
  { n: '14', slug: 'miami',        name: 'Miami',           tag: 'South Beach · pastel deco',         tier: 7,  region: '🌴', advances: 41 },
  { n: '15', slug: 'hawaii',       name: 'Hawaii',          tag: 'Big Island · volcano table',        tier: 7,  region: '🌺', advances: 42 },
  { n: '16', slug: 'imperial-vip', name: 'Imperial Suite',  tag: 'Forbidden City · jade table',       tier: 9,  region: '🐉', advances: 53 },
  { n: '17', slug: 'gladiator',    name: 'The Colosseum',   tag: 'Imperial Rome · Tyrian purple',     tier: 10, region: '🛡', advances: 58 },
];

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@900&family=Press+Start+2P&display=swap">`;

function sh(cmd) {
  console.log('  $', cmd.replace(/\s+/g, ' ').slice(0, 220));
  return execSync(cmd, { stdio: 'inherit' });
}
function dataUrl(p, mime) {
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}

// ────────────────────────────────────────────────────────────
// Render an HTML page to a frame sequence + encode to mp4
// ────────────────────────────────────────────────────────────
async function renderHtmlMp4(browser, html, durSec, outPath, opts = {}) {
  const dir = fs.mkdtempSync(path.join(TMP, 'frames-'));
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => { el.style.animationPlayState = 'paused'; });
  });
  const total = Math.round(durSec * FPS);
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
      path: path.join(dir, `f${String(i).padStart(4,'0')}.jpg`),
      type: 'jpeg', quality: 92, clip: { x:0, y:0, width:W, height:H },
    });
  }
  await page.close();
  sh(`ffmpeg -y -hide_banner -loglevel error -framerate ${FPS} -i "${dir}/f%04d.jpg" \
      -t ${durSec} -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
      -an "${outPath}"`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────
// Capture the live homepage carousel, paused on the target stage
// ────────────────────────────────────────────────────────────
async function captureCarouselFor(browser, stage, durSec, outPath) {
  const dir = fs.mkdtempSync(path.join(TMP, 'carousel-'));
  const page = await browser.newPage();
  await page.setViewport({
    width: CAROUSEL_VW, height: CAROUSEL_VH,
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  await page.setCacheEnabled(false);
  if (typeof page.setBypassServiceWorker === 'function') await page.setBypassServiceWorker(true);

  await page.goto('https://baccaratgladiator.com/?bust=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 1500));

  // Compress the layout so the carousel fills the frame nicely.
  await page.evaluate(() => {
    const css = document.createElement('style');
    css.textContent = `
      #deck-frame {
        transform: translate(-50%, -54%) scale(1.45) !important;
        max-width: 560px !important;
        height: 64vh !important;
        max-height: 640px !important;
      }
      #marquee { top: max(8px, env(safe-area-inset-top)) !important; }
      #coin-hint { display: none !important; }
      /* Pause card animations so we capture a steady hero shot */
      #deck, #deck *, .card, .card * {
        transition-duration: 0ms !important;
        animation: none !important;
      }
    `;
    document.head.appendChild(css);
  });

  // Advance the carousel to the target stage.
  for (let i = 0; i < stage.advances; i++) {
    await page.evaluate(() => {
      const btn = document.getElementById('btn-next');
      if (btn) btn.click();
      else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    await new Promise(r => setTimeout(r, 80));
  }
  await new Promise(r => setTimeout(r, 600));   // settle

  // Capture frames over `durSec` (Ken Burns is in CSS below)
  const total = Math.round(durSec * FPS);
  const start = Date.now();
  for (let i = 0; i < total; i++) {
    await page.screenshot({
      path: path.join(dir, `f${String(i).padStart(4,'0')}.jpg`),
      type: 'jpeg', quality: 92,
      clip: { x:0, y:0, width: CAROUSEL_VW, height: CAROUSEL_VH },
    });
    const target = start + (i + 1) * (1000 / FPS);
    const remaining = target - Date.now();
    if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
  }
  await page.close();

  // LANCZOS upscale 540×960 → 1080×1920 + Ken Burns zoom via ffmpeg zoompan.
  sh(`ffmpeg -y -hide_banner -loglevel error -framerate ${FPS} -i "${dir}/f%04d.jpg" \
      -vf "scale=${W*2}:${H*2}:flags=lanczos,zoompan=z='min(1.0+0.0006*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${total}:s=${W}x${H}:fps=${FPS}" \
      -t ${durSec} -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
      -an "${outPath}"`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────
// Card templates
// ────────────────────────────────────────────────────────────
function commonStyles() {
  return `
    *{margin:0;padding:0;box-sizing:border-box;}
    html,body{width:${W}px;height:${H}px;background:#000;overflow:hidden;font-family:'Cinzel',serif;}
    .scanline{position:absolute;inset:0;
      background:repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.10) 3px);
      mix-blend-mode:multiply;opacity:0.30;pointer-events:none;}
    .vignette{position:absolute;inset:0;background:radial-gradient(ellipse 80% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%);}
    .corner{position:absolute;width:120px;height:120px;border:3px solid rgba(255,215,110,0.55);}
    .corner.tl{top:48px;left:48px;border-right:none;border-bottom:none;}
    .corner.tr{top:48px;right:48px;border-left:none;border-bottom:none;}
    .corner.bl{bottom:48px;left:48px;border-right:none;border-top:none;}
    .corner.br{bottom:48px;right:48px;border-left:none;border-top:none;}
  `;
}

function introCardHtml(stage) {
  return `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;
    background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.30), transparent 55%),
               radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45), rgba(20,4,8,0.85) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:28px;letter-spacing:0.42em;color:#ff6cfa;text-shadow:0 0 14px rgba(255,108,250,0.65);margin-bottom:30px;}
  .stage-num{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:340px;line-height:0.85;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 8px 22px rgba(0,0,0,0.85));}
  .of-60{margin-top:14px;font-family:'Cinzel',serif;font-weight:900;font-size:46px;letter-spacing:0.20em;color:#fff7d6;text-transform:uppercase;
    text-shadow:0 0 14px rgba(255,180,40,0.6),0 2px 5px rgba(0,0,0,0.85);}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="lockup">
      <div class="pre">★ INSERT COIN ★</div>
      <div class="stage-num">${stage.n}</div>
      <div class="of-60">STAGE ${stage.n} OF 60</div>
    </div>
    <div class="vignette"></div>
  </body></html>`;
}

function tagLineHtml(stage) {
  return `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;
    background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.30), transparent 55%),
               radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45), rgba(20,4,8,0.85) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .region{font-size:200px;line-height:1;margin-bottom:30px;
    filter:drop-shadow(0 0 32px rgba(255,180,40,0.55)) drop-shadow(0 8px 14px rgba(0,0,0,0.85));}
  .name{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:120px;line-height:1.0;letter-spacing:-0.01em;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));margin-bottom:24px;}
  .tag{font-family:'Cinzel',serif;font-weight:900;font-size:46px;letter-spacing:0.10em;color:#fff7d6;
    text-shadow:0 0 14px rgba(0,0,0,0.85);max-width:920px;line-height:1.3;text-transform:uppercase;}
  .tier{margin-top:28px;font-family:'Press Start 2P',monospace;font-size:24px;letter-spacing:0.36em;color:#ffd76e;
    text-shadow:0 0 14px rgba(255,180,40,0.6);}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="lockup">
      <div class="region">${stage.region}</div>
      <div class="name">${stage.name}</div>
      <div class="tag">${stage.tag}</div>
      <div class="tier">★ TIER ${String(stage.tier).padStart(2,'0')} ★</div>
    </div>
    <div class="vignette"></div>
  </body></html>`;
}

function ctaCardHtml() {
  const qrUrl = fs.existsSync(QR) ? dataUrl(QR, 'image/png') : '';
  return `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.30), transparent 55%),
      radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45), rgba(20,4,8,0.85) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:22px;letter-spacing:0.42em;color:#ff6cfa;text-shadow:0 0 14px rgba(255,108,250,0.65);margin-bottom:20px;}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:130px;line-height:0.95;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));margin-bottom:30px;}
  .qr{width:420px;height:420px;background:#fff;padding:16px;border:3px solid #ffd76e;border-radius:16px;}
  .qr img{width:100%;height:100%;display:block;image-rendering:pixelated;}
  .url{margin-top:26px;font-family:'Cinzel',serif;font-weight:900;font-size:54px;letter-spacing:0.06em;color:#fff7d6;
    text-shadow:0 0 18px rgba(255,180,40,0.6),0 3px 6px rgba(0,0,0,0.85);}
  .url .dot{color:#ffd76e;}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="lockup">
      <div class="pre">★ FREE PLAY ★</div>
      <div class="head">PLAY<br>FREE</div>
      ${qrUrl ? `<div class="qr"><img src="${qrUrl}" alt="QR"></div>` : ''}
      <div class="url">BaccaratGladiator<span class="dot">.</span>com</div>
    </div>
    <div class="vignette"></div>
  </body></html>`;
}

// ────────────────────────────────────────────────────────────
// Per-stage builder
// ────────────────────────────────────────────────────────────
async function buildStageSpotlight(browser, stage) {
  console.log(`\n[${stage.n}/17] Stage Spotlight: ${stage.name}…`);
  const tmp = path.join(TMP, `stage-${stage.n}`);
  fs.mkdirSync(tmp, { recursive: true });
  const out = path.join(OUT, `${stage.n}-stage-${stage.slug}.mp4`);

  await renderHtmlMp4(browser, introCardHtml(stage),     2,  path.join(tmp, 'intro.mp4'));
  await captureCarouselFor(browser, stage,              9,  path.join(tmp, 'carousel.mp4'));
  await renderHtmlMp4(browser, tagLineHtml(stage),       2,  path.join(tmp, 'tagline.mp4'));
  await renderHtmlMp4(browser, ctaCardHtml(),            2,  path.join(tmp, 'cta.mp4'));

  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/intro.mp4'\nfile '${tmp}/carousel.mp4'\nfile '${tmp}/tagline.mp4'\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 15 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none'],
  });
  try {
    for (const stage of STAGES) {
      await buildStageSpotlight(browser, stage);
    }
  } finally {
    await browser.close();
  }
  console.log('\n──────────────────────────────────────────────');
  console.log('Stage spotlights built in:', OUT);
  for (const f of fs.readdirSync(OUT).sort().filter(n => n.match(/^(0[6-9]|1[0-7])-stage-/))) {
    const stat = fs.statSync(path.join(OUT, f));
    console.log(`  ${f}  ${(stat.size/1024/1024).toFixed(2)} MB`);
  }
  console.log('──────────────────────────────────────────────');
})().catch(e => { console.error(e); process.exit(1); });
