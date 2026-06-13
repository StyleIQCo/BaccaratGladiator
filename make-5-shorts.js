// Batch-builds 5 Baccarat Gladiator Shorts:
//   1. Side Bet Showdown   — Dragon 7 + Panda 8 + Korean BBQ trio (30s)
//   2. Korean BBQ Rule     — niche curiosity explainer (20s)
//   3. EZ Baccarat How-To  — 30-second rules explainer (30s)
//   4. Tier 10 Reveal      — Colosseum boss tier tease (15s)
//   5. Devlog 6 Weeks      — solo-dev timelapse for indie crowd (30s)
//
// Output dir: ./shorts/
// All 1080×1920 · 30fps · libx264 CRF 18 preset slow · AAC 192k

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const OUT  = path.join(ROOT, 'shorts');
const TMP  = '/tmp/shorts-batch';
const W = 1080, H = 1920, FPS = 30;

const SRC_D7   = path.join(ROOT, 'baccarat-gladiator-macau-dragon7-short.mp4');
const SRC_P8   = path.join(ROOT, 'baccarat-gladiator-macau-panda8-short.mp4');
const SRC_KBQ  = path.join(ROOT, 'baccarat-gladiator-macau-koreanbbq-short.mp4');
const QR_PATH  = '/tmp/d7-15s/qr.png';

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function sh(cmd) {
  console.log('  $', cmd.replace(/\s+/g,' ').slice(0, 220));
  return execSync(cmd, { stdio: 'inherit' });
}
function dataUrl(p, mime) {
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}

// ──────────────────────────────────────────────────────────────
// Common: render an HTML card to a PNG (transparent if needed) or MP4
// ──────────────────────────────────────────────────────────────
async function renderCardPng(browser, html, outPath, transparent = false) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 250));
  await page.screenshot({
    path: outPath, type: 'png', omitBackground: transparent,
    clip: { x:0, y:0, width:W, height:H },
  });
  await page.close();
}

async function renderCardMp4(browser, html, durSec, outPath) {
  // Frame-by-frame capture, then ffmpeg encode.
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
  for (let i = 0; i < total; i++){
    const t = i / FPS;
    await page.evaluate((tt) => {
      document.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.animationName && cs.animationName !== 'none'){
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

// ──────────────────────────────────────────────────────────────
// HTML templates
// ──────────────────────────────────────────────────────────────
function commonStyles() {
  return `
    *{margin:0;padding:0;box-sizing:border-box;}
    html,body{width:${W}px;height:${H}px;background:#000;overflow:hidden;font-family:'Cinzel',serif;}
    .scanline{position:absolute;inset:0;
      background:repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.10) 3px);
      mix-blend-mode:multiply;opacity:0.30;pointer-events:none;}
    .vignette{position:absolute;inset:0;
      background:radial-gradient(ellipse 80% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%);
      pointer-events:none;}
    .corner{position:absolute;width:130px;height:130px;border:3px solid rgba(255,215,110,0.55);}
    .corner.tl{top:48px;left:48px;border-right:none;border-bottom:none;}
    .corner.tr{top:48px;right:48px;border-left:none;border-bottom:none;}
    .corner.bl{bottom:48px;left:48px;border-right:none;border-top:none;}
    .corner.br{bottom:48px;right:48px;border-left:none;border-top:none;}
  `;
}

const FONTS = `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@900&family=Press+Start+2P&family=JetBrains+Mono:wght@400;700&display=swap">
`;

// Title overlay PNG used during clips
async function renderOverlayPng(browser, title, subtitle, multiplier, outPath) {
  const html = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  body { background:transparent; }
  .panel{
    position:absolute;left:60px;right:60px;top:90px;
    padding:36px 40px;
    background:linear-gradient(180deg, rgba(28,8,12,0.78), rgba(56,20,28,0.72));
    border:3px solid rgba(255,215,110,0.85);
    border-radius:22px;
    box-shadow:0 12px 40px rgba(0,0,0,0.55), 0 0 60px rgba(255,180,40,0.25);
    text-align:center;
  }
  .panel .title{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;
    font-size:96px;line-height:1.0;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;
    -webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 4px 14px rgba(0,0,0,0.85));}
  .panel .sub{margin-top:14px;font-family:'Cinzel',serif;font-weight:900;
    font-size:34px;letter-spacing:0.12em;color:#fff7d6;
    text-shadow:0 0 14px rgba(255,180,40,0.6),0 2px 5px rgba(0,0,0,0.85);
    text-transform:uppercase;}
  .panel .mult{margin-top:18px;font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;
    font-size:128px;line-height:1.0;letter-spacing:-0.01em;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;
    -webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85)) drop-shadow(0 0 28px rgba(255,180,40,0.5));}
  </style></head><body>
    <div class="panel">
      <div class="title">${title}</div>
      <div class="sub">${subtitle}</div>
      ${multiplier ? `<div class="mult">${multiplier}</div>` : ''}
    </div>
  </body></html>`;
  await renderCardPng(browser, html, outPath, /* transparent */ true);
}

function ctaCardHtml() {
  const qrUrl = fs.existsSync(QR_PATH) ? dataUrl(QR_PATH, 'image/png') : '';
  return `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.30), transparent 55%),
      radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45), rgba(20,4,8,0.85) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:24px;letter-spacing:0.42em;color:#ff6cfa;
    text-shadow:0 0 14px rgba(255,108,250,0.65);margin-bottom:18px;}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:140px;line-height:0.95;letter-spacing:-0.01em;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85)) drop-shadow(0 0 32px rgba(255,180,40,0.55));margin-bottom:32px;}
  .qr{width:480px;height:480px;background:#fff;padding:18px;border:3px solid #ffd76e;border-radius:18px;}
  .qr img{width:100%;height:100%;display:block;image-rendering:pixelated;}
  .url{margin-top:30px;font-family:'Cinzel',serif;font-weight:900;font-size:64px;letter-spacing:0.06em;color:#fff7d6;
    text-shadow:0 0 18px rgba(255,180,40,0.6),0 3px 6px rgba(0,0,0,0.85);}
  .url .dot{color:#ffd76e;}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="lockup">
      <div class="pre">★ FREE PLAY · NO REAL MONEY ★</div>
      <div class="head">PLAY<br>FREE</div>
      ${qrUrl ? `<div class="qr"><img src="${qrUrl}" alt="QR"></div>` : ''}
      <div class="url">BaccaratGladiator<span class="dot">.</span>com</div>
    </div>
    <div class="vignette"></div>
  </body></html>`;
}

// ──────────────────────────────────────────────────────────────
// 1. Side Bet Showdown (30s)
// ──────────────────────────────────────────────────────────────
async function buildSideBetShowdown(browser) {
  console.log('\n[1/5] Side Bet Showdown (30s)…');
  const out = path.join(OUT, '01-side-bet-showdown.mp4');
  const tmp = path.join(TMP, 'showdown'); fs.mkdirSync(tmp, { recursive: true });

  // Intro card (3s)
  const introHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.25), transparent 55%),
      radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45), rgba(20,4,8,0.85) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:28px;letter-spacing:0.42em;color:#ff6cfa;text-shadow:0 0 14px rgba(255,108,250,0.65);margin-bottom:30px;}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:138px;line-height:1.0;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));margin-bottom:34px;}
  .sub{font-family:'Cinzel',serif;font-weight:900;font-size:46px;letter-spacing:0.18em;color:#fff7d6;text-transform:uppercase;
    text-shadow:0 0 14px rgba(255,180,40,0.6);}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="lockup">
      <div class="pre">★ EZ BACCARAT ★</div>
      <div class="head">3 SIDE BETS<br>RANKED</div>
      <div class="sub">DRAGON 7 · PANDA 8 · KOREAN BBQ</div>
    </div>
    <div class="vignette"></div>
  </body></html>`;
  await renderCardMp4(browser, introHtml, 3, path.join(tmp, 'intro.mp4'));

  // Title overlay PNGs (will be alpha-overlayed onto each clip)
  await renderOverlayPng(browser, 'DRAGON 7', 'Banker · 3-card 7', '40:1', path.join(tmp, 'd7-overlay.png'));
  await renderOverlayPng(browser, 'PANDA 8',  'Player · 3-card 8', '25:1', path.join(tmp, 'p8-overlay.png'));
  await renderOverlayPng(browser, 'KOREAN BBQ', '2-card 7 vs 6 · push', null,  path.join(tmp, 'kb-overlay.png'));

  // Compose each clip with its overlay (re-encoded, 8s slice each)
  async function composeClip(src, overlay, dur, outFile) {
    sh(`ffmpeg -y -hide_banner -loglevel error \
        -ss 1.5 -t ${dur} -i "${src}" \
        -loop 1 -t ${dur} -i "${overlay}" \
        -filter_complex "
          [0:v]scale=${W}:${H}:flags=lanczos,setpts=PTS-STARTPTS[v];
          [1:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${dur-0.4}:d=0.4:alpha=1[ovl];
          [v][ovl]overlay=0:0:format=auto
        " \
        -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -an "${outFile}"`);
  }
  await composeClip(SRC_D7,  path.join(tmp, 'd7-overlay.png'), 9, path.join(tmp, 'seg-d7.mp4'));
  await composeClip(SRC_P8,  path.join(tmp, 'p8-overlay.png'), 9, path.join(tmp, 'seg-p8.mp4'));
  await composeClip(SRC_KBQ, path.join(tmp, 'kb-overlay.png'), 6, path.join(tmp, 'seg-kb.mp4'));

  // Outro CTA (3s)
  await renderCardMp4(browser, ctaCardHtml(), 3, path.join(tmp, 'cta.mp4'));

  // Concat
  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/intro.mp4'\nfile '${tmp}/seg-d7.mp4'\nfile '${tmp}/seg-p8.mp4'\nfile '${tmp}/seg-kb.mp4'\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);

  // Audio: silence (no overlapping dealer voices)
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 30 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ──────────────────────────────────────────────────────────────
// 2. Korean BBQ Rule (20s)
// ──────────────────────────────────────────────────────────────
async function buildKoreanBBQRule(browser) {
  console.log('\n[2/5] Korean BBQ Rule (20s)…');
  const out = path.join(OUT, '02-korean-bbq-rule.mp4');
  const tmp = path.join(TMP, 'kbq'); fs.mkdirSync(tmp, { recursive: true });

  // Intro card (3s)
  const introHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  body{background:#000;}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:22px;letter-spacing:0.42em;color:#ff6cfa;margin-bottom:40px;text-shadow:0 0 12px rgba(255,108,250,0.7);}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:88px;line-height:1.05;color:#fff7d6;
    text-shadow:0 0 22px rgba(255,180,40,0.45),0 6px 12px rgba(0,0,0,0.85);
    -webkit-text-stroke:3px #1a0408;}
  </style></head><body>
    <div class="lockup">
      <div class="pre">★ HIDDEN RULE ★</div>
      <div class="head">There's a baccarat rule<br>almost no one knows about.</div>
    </div>
  </body></html>`;
  await renderCardMp4(browser, introHtml, 3, path.join(tmp, 'intro.mp4'));

  // KBQ clip (12s, scaled)
  sh(`ffmpeg -y -hide_banner -loglevel error -ss 1.5 -t 12 -i "${SRC_KBQ}" \
      -vf "scale=${W}:${H}:flags=lanczos" \
      -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -an "${tmp}/clip.mp4"`);

  // Reveal card (3s) — "It's the Korean BBQ"
  const revealHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.30), transparent 55%),
      radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45), rgba(20,4,8,0.85) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:130px;line-height:0.96;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));margin-bottom:40px;}
  .sub{font-family:'Cinzel',serif;font-weight:900;font-size:38px;letter-spacing:0.06em;color:#fff7d6;line-height:1.4;max-width:880px;
    text-shadow:0 0 14px rgba(0,0,0,0.85);}
  .emoji{font-size:128px;margin-top:20px;filter:drop-shadow(0 0 22px rgba(255,180,40,0.55));}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="lockup">
      <div class="head">THE KOREAN<br>BBQ RULE</div>
      <div class="sub">2-card 7 vs 2-card 6 = push.<br>Both sides stand. Nobody wins.</div>
      <div class="emoji">🥩 🥢</div>
    </div>
    <div class="vignette"></div>
  </body></html>`;
  await renderCardMp4(browser, revealHtml, 3, path.join(tmp, 'reveal.mp4'));

  // Outro CTA (2s)
  await renderCardMp4(browser, ctaCardHtml(), 2, path.join(tmp, 'cta.mp4'));

  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/intro.mp4'\nfile '${tmp}/clip.mp4'\nfile '${tmp}/reveal.mp4'\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 20 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ──────────────────────────────────────────────────────────────
// 3. EZ Baccarat How-To (30s)
// ──────────────────────────────────────────────────────────────
async function buildEZBaccaratHowTo(browser) {
  console.log('\n[3/5] EZ Baccarat How-To (30s)…');
  const out = path.join(OUT, '03-ez-baccarat-howto.mp4');
  const tmp = path.join(TMP, 'howto'); fs.mkdirSync(tmp, { recursive: true });

  // 5 rule cards × 5s each = 25s + 3s intro + 2s outro = 30s
  const rules = [
    { num: '1', title: 'BET',         body: 'Banker · Player · Tie',        bg: 'rgba(184,0,31,0.45)' },
    { num: '2', title: 'CLOSER TO 9', body: 'Face cards count zero',        bg: 'rgba(255,138,26,0.40)' },
    { num: '3', title: 'DRAGON 7',    body: 'Banker 3-card 7 → 40:1',      bg: 'rgba(255,180,40,0.45)' },
    { num: '4', title: 'PANDA 8',     body: 'Player 3-card 8 → 25:1',      bg: 'rgba(82,217,154,0.40)' },
    { num: '5', title: 'NO COMMISSION', body: 'EZ replaces the 5% rake',    bg: 'rgba(108,108,250,0.40)' },
  ];

  // Intro
  const introHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.25), transparent 55%),
      radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45), rgba(20,4,8,0.85) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:26px;letter-spacing:0.42em;color:#ff6cfa;margin-bottom:24px;text-shadow:0 0 14px rgba(255,108,250,0.65);}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:130px;line-height:0.95;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));margin-bottom:30px;}
  .sub{font-family:'Cinzel',serif;font-weight:900;font-size:42px;letter-spacing:0.18em;color:#fff7d6;text-transform:uppercase;}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="lockup">
      <div class="pre">★ HOW TO PLAY ★</div>
      <div class="head">EZ BACCARAT</div>
      <div class="sub">In 30 seconds</div>
    </div>
    <div class="vignette"></div>
  </body></html>`;
  await renderCardMp4(browser, introHtml, 3, path.join(tmp, 'intro.mp4'));

  // Each rule card (5s)
  for (let i = 0; i < rules.length; i++){
    const r = rules[i];
    const html = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
    .bg{position:absolute;inset:0;background:linear-gradient(180deg, rgba(20,4,8,0.95) 0%, ${r.bg} 50%, rgba(20,4,8,0.95) 100%);}
    .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
    .num{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:380px;line-height:0.85;
      background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
      -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
      filter:drop-shadow(0 8px 22px rgba(0,0,0,0.85));margin-bottom:30px;}
    .title{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:96px;line-height:1.0;
      color:#fff7d6;text-shadow:0 0 22px rgba(255,180,40,0.5),0 4px 8px rgba(0,0,0,0.85);
      -webkit-text-stroke:3px #1a0408;margin-bottom:30px;letter-spacing:0.02em;}
    .body{font-family:'Cinzel',serif;font-weight:900;font-size:50px;letter-spacing:0.06em;color:#ffd76e;
      text-shadow:0 0 14px rgba(0,0,0,0.85);max-width:920px;line-height:1.3;}
    </style></head><body>
      <div class="bg"></div><div class="scanline"></div>
      <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
      <div class="lockup">
        <div class="num">${r.num}</div>
        <div class="title">${r.title}</div>
        <div class="body">${r.body}</div>
      </div>
      <div class="vignette"></div>
    </body></html>`;
    await renderCardMp4(browser, html, 5, path.join(tmp, `rule-${i}.mp4`));
  }

  // Outro CTA (2s)
  await renderCardMp4(browser, ctaCardHtml(), 2, path.join(tmp, 'cta.mp4'));

  // Concat
  const lines = [`file '${tmp}/intro.mp4'`,
    ...rules.map((_,i) => `file '${tmp}/rule-${i}.mp4'`),
    `file '${tmp}/cta.mp4'`].join('\n');
  fs.writeFileSync(`${tmp}/concat.txt`, lines + '\n');
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 30 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ──────────────────────────────────────────────────────────────
// 4. Tier 10 Reveal — The Colosseum (15s)
// ──────────────────────────────────────────────────────────────
async function buildTier10Reveal(browser) {
  console.log('\n[4/5] Tier 10 Reveal (15s)…');
  const out = path.join(OUT, '04-tier-10-colosseum.mp4');
  const tmp = path.join(TMP, 'tier10'); fs.mkdirSync(tmp, { recursive: true });

  const TIERS = [
    { id:1,  name:'WELCOME PIT' },     { id:2,  name:'INDIE BLOCK' },
    { id:3,  name:'FAR HORIZONS' },    { id:4,  name:'UNDERGROUND' },
    { id:5,  name:'POSTCARD CITIES' }, { id:6,  name:'CHAMPIONSHIP' },
    { id:7,  name:'NEON STREETS' },    { id:8,  name:'VIP ESCAPE' },
    { id:9,  name:'IMPERIAL DRAGON' }, { id:10, name:'THE COLOSSEUM' },
  ];

  // 0–3s: dark intro "To unlock the final tier..."
  const introHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px;}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:90px;line-height:1.05;color:#fff7d6;
    text-shadow:0 0 22px rgba(255,180,40,0.45),0 6px 12px rgba(0,0,0,0.85);
    -webkit-text-stroke:3px #1a0408;}
  .head .gold{color:#ffd76e;}
  </style></head><body>
    <div class="lockup">
      <div class="head">To unlock the<br><span class="gold">final tier</span>,<br>clear all 9 below.</div>
    </div>
  </body></html>`;
  await renderCardMp4(browser, introHtml, 3, path.join(tmp, 'intro.mp4'));

  // 3–11s: tier cards 1-9 flash quickly (~0.85s each), tier 10 holds
  // Build a single HTML page with sequential reveals via animation-delay frames.
  // Simpler: build 9 quick cards + 1 hero card.
  for (let i = 0; i < 9; i++){
    const t = TIERS[i];
    const html = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
    .bg{position:absolute;inset:0;background:linear-gradient(180deg, rgba(20,4,8,0.92) 0%, rgba(20,4,8,0.55) 50%, rgba(20,4,8,0.92) 100%);}
    .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}
    .num{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:340px;line-height:0.85;color:#5a5060;
      text-shadow:0 0 14px rgba(0,0,0,0.85);margin-bottom:20px;}
    .name{font-family:'Cinzel',serif;font-weight:900;font-size:64px;letter-spacing:0.12em;color:#aaa;text-transform:uppercase;
      text-shadow:0 0 12px rgba(0,0,0,0.85);}
    .check{position:absolute;top:30%;font-size:280px;color:#4ad15c;text-shadow:0 0 30px rgba(74,209,92,0.65);}
    </style></head><body>
      <div class="bg"></div><div class="scanline"></div>
      <div class="lockup">
        <div class="num">T0${t.id}</div>
        <div class="name">${t.name}</div>
        <div class="check">✓</div>
      </div>
    </body></html>`;
    await renderCardMp4(browser, html, 0.7, path.join(tmp, `t${i}.mp4`));
  }

  // 10s tier 10 hero reveal (5s — hold)
  const heroHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;
    background:radial-gradient(ellipse 80% 60% at 50% 35%, rgba(184,0,31,0.55), transparent 60%),
               radial-gradient(ellipse 90% 90% at 50% 60%, rgba(255,138,26,0.30), rgba(20,4,8,0.92) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;
    animation:hero-pulse 5s ease infinite;}
  @keyframes hero-pulse{0%,100%{filter:drop-shadow(0 0 36px rgba(255,180,40,0.55));}50%{filter:drop-shadow(0 0 60px rgba(255,180,40,0.85));}}
  .num{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:420px;line-height:0.85;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 8px 22px rgba(0,0,0,0.85));margin-bottom:20px;}
  .shield{font-size:200px;line-height:1;margin-bottom:30px;
    filter:drop-shadow(0 0 32px #ffaa1a) drop-shadow(0 0 16px #ff5e00) drop-shadow(0 6px 10px rgba(0,0,0,0.85));}
  .title{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:104px;line-height:1.0;color:#fff7d6;
    -webkit-text-stroke:3px #1a0408;text-shadow:0 0 22px rgba(255,180,40,0.6);}
  .sub{margin-top:24px;font-family:'Cinzel',serif;font-weight:900;font-size:42px;letter-spacing:0.18em;color:#ffd76e;text-transform:uppercase;
    text-shadow:0 0 14px rgba(255,180,40,0.6);}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="lockup">
      <div class="num">T10</div>
      <div class="shield">🛡</div>
      <div class="title">THE COLOSSEUM</div>
      <div class="sub">Imperial Rome · Tyrian Purple</div>
    </div>
    <div class="vignette"></div>
  </body></html>`;
  await renderCardMp4(browser, heroHtml, 5, path.join(tmp, 'hero.mp4'));

  // CTA 2s
  await renderCardMp4(browser, ctaCardHtml(), 2, path.join(tmp, 'cta.mp4'));

  const tierFiles = Array.from({length:9}, (_,i) => `file '${tmp}/t${i}.mp4'`).join('\n');
  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/intro.mp4'\n${tierFiles}\nfile '${tmp}/hero.mp4'\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 16.3 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ──────────────────────────────────────────────────────────────
// 5. Devlog 6 Weeks (30s)
// ──────────────────────────────────────────────────────────────
async function buildDevlog6Weeks(browser) {
  console.log('\n[5/5] Devlog 6 Weeks (30s)…');
  const out = path.join(OUT, '05-devlog-6-weeks.mp4');
  const tmp = path.join(TMP, 'devlog'); fs.mkdirSync(tmp, { recursive: true });

  // Use existing dragon7 frames as the "Day 42" payoff. Synthesize earlier days as
  // text-on-code-bg cards (Pillow-rendered code-editor look via HTML/CSS).
  const days = [
    { day: '01', subtitle: 'first commit', code:
`// road-to-macau.html
const STAGES = [];
const TIERS = [];
// TODO: build everything` },
    { day: '07', subtitle: 'first card flips', code:
`function flipCard(card) {
  card.classList.add('flipped');
  await wait(300);
}` },
    { day: '14', subtitle: 'first stage shipped', code:
`STAGES.push({
  slug: 'macau',
  name: 'Macau',
  tier: 1,
});` },
    { day: '21', subtitle: 'EZ Baccarat side bets', code:
`const isDragon7 = winner==='B'
  && bankerCards.length===3
  && bT===7;
const dragon7Mult = isDragon7 ? 41 : 0;` },
    { day: '30', subtitle: '60+ stages live', code:
`STAGES.length === 62
TIERS.length === 10
✓ ALL VENUES THEMED
✓ MOBILE-FIRST
✓ 3D THREE.JS TABLE` },
  ];

  // 0–2s intro card
  const introHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .pre{font-family:'JetBrains Mono',monospace;font-size:36px;color:#52d99a;margin-bottom:30px;
    text-shadow:0 0 12px rgba(82,217,154,0.7);}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:108px;line-height:1.0;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));}
  .sub{margin-top:30px;font-family:'JetBrains Mono',monospace;font-size:38px;color:#aaa;}
  </style></head><body>
    <div class="lockup">
      <div class="pre">$ git log --since="6 weeks ago"</div>
      <div class="head">SOLO DEV<br>BUILDING IN PUBLIC</div>
      <div class="sub">62 baccarat stages · 6 weeks · 1 person</div>
    </div>
  </body></html>`;
  await renderCardMp4(browser, introHtml, 3, path.join(tmp, 'intro.mp4'));

  // 5 day cards × 4s each = 20s
  for (let i = 0; i < days.length; i++){
    const d = days[i];
    const html = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
    .bg{position:absolute;inset:0;background:#0a0a14;}
    .editor{
      position:absolute;left:60px;right:60px;top:160px;bottom:160px;
      background:#15151f;border:2px solid #2a2a40;border-radius:16px;
      box-shadow:0 12px 40px rgba(0,0,0,0.55);overflow:hidden;}
    .editor .topbar{height:56px;background:#1a1a28;border-bottom:1px solid #2a2a40;
      display:flex;align-items:center;padding:0 22px;gap:10px;}
    .editor .topbar .dot{width:14px;height:14px;border-radius:50%;}
    .editor .topbar .dot.r{background:#ff5f56;}
    .editor .topbar .dot.y{background:#ffbd2e;}
    .editor .topbar .dot.g{background:#27c93f;}
    .editor .topbar .file{margin-left:18px;font-family:'JetBrains Mono',monospace;font-size:24px;color:#aaa;}
    .editor pre{padding:34px;font-family:'JetBrains Mono',monospace;font-size:38px;line-height:1.45;color:#d8d8e8;white-space:pre-wrap;
      letter-spacing:0.005em;}
    .editor pre .k{color:#c678dd;}
    .editor pre .s{color:#98c379;}
    .editor pre .c{color:#5c6370;font-style:italic;}
    .editor pre .n{color:#d19a66;}
    .editor pre .v{color:#52d99a;}
    .day-badge{position:absolute;top:60px;left:60px;
      padding:18px 36px;
      background:linear-gradient(180deg, #ffd76e 0%, #ff8a1a 70%, #b8001f 100%);
      color:#1a0408;
      font-family:'Cinzel',serif;font-weight:900;font-size:42px;letter-spacing:0.10em;
      border-radius:14px;border:3px solid #fff7d6;
      text-shadow:0 1px 0 rgba(255,255,255,0.45);
      box-shadow:0 8px 22px rgba(0,0,0,0.55);}
    .day-sub{position:absolute;top:62px;right:60px;
      font-family:'JetBrains Mono',monospace;font-size:34px;color:#52d99a;
      text-shadow:0 0 12px rgba(82,217,154,0.55);}
    </style></head><body>
      <div class="bg"></div>
      <div class="day-badge">DAY ${d.day}</div>
      <div class="day-sub">${d.subtitle}</div>
      <div class="editor">
        <div class="topbar">
          <div class="dot r"></div><div class="dot y"></div><div class="dot g"></div>
          <div class="file">baccarat-gladiator/index.html</div>
        </div>
        <pre>${escapeHtml(d.code)}</pre>
      </div>
    </body></html>`;
    await renderCardMp4(browser, html, 4, path.join(tmp, `day-${i}.mp4`));
  }

  // 2s "Day 42" hand-off card
  const finalHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:#0a0a14;}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}
  .day{font-family:'JetBrains Mono',monospace;font-size:54px;color:#52d99a;margin-bottom:18px;
    text-shadow:0 0 14px rgba(82,217,154,0.65);}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:148px;line-height:0.95;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 8px 22px rgba(0,0,0,0.85));}
  </style></head><body>
    <div class="bg"></div>
    <div class="lockup">
      <div class="day">DAY 42</div>
      <div class="head">SHIPPED.</div>
    </div>
  </body></html>`;
  await renderCardMp4(browser, finalHtml, 2, path.join(tmp, 'final.mp4'));

  // 3s: actual gameplay payoff (D7 win, scaled, no audio)
  sh(`ffmpeg -y -hide_banner -loglevel error -ss 4 -t 3 -i "${SRC_D7}" \
      -vf "scale=${W}:${H}:flags=lanczos" \
      -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -an "${tmp}/payoff.mp4"`);

  // 2s CTA
  await renderCardMp4(browser, ctaCardHtml(), 2, path.join(tmp, 'cta.mp4'));

  // Concat
  const dayFiles = Array.from({length:days.length}, (_,i) => `file '${tmp}/day-${i}.mp4'`).join('\n');
  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/intro.mp4'\n${dayFiles}\nfile '${tmp}/final.mp4'\nfile '${tmp}/payoff.mp4'\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 30 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
(async () => {
  for (const f of [SRC_D7, SRC_P8, SRC_KBQ]) {
    if (!fs.existsSync(f)) { console.error('Missing source:', f); process.exit(1); }
  }
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none'],
  });
  try {
    await buildSideBetShowdown(browser);
    await buildKoreanBBQRule(browser);
    await buildEZBaccaratHowTo(browser);
    await buildTier10Reveal(browser);
    await buildDevlog6Weeks(browser);
  } finally {
    await browser.close();
  }
  console.log('\n──────────────────────────────────────────────');
  console.log('All 5 Shorts built in:', OUT);
  for (const f of fs.readdirSync(OUT).sort()) {
    const p = path.join(OUT, f);
    const stat = fs.statSync(p);
    console.log(`  ${f}  ${(stat.size/1024/1024).toFixed(2)} MB`);
  }
  console.log('──────────────────────────────────────────────');
})().catch(e => { console.error(e); process.exit(1); });
