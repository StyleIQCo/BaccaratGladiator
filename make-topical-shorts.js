// 6 topical Shorts to round out the 25-video content pack.
//
//   18. Banker vs Player Odds       (20s · math + viz)
//   19. Card Squeeze ASMR           (30s · slow-mo flip)
//   20. 60 Stages in 60 Seconds     (60s · rapid montage)
//   21. Free Forever Manifesto      (20s · brand statement)
//   22. The 3D Table Devlog         (30s · Three.js angle)
//   23. Worst Beat Ever             (20s · variance / loss)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const OUT  = path.join(ROOT, 'shorts');
const TMP  = '/tmp/topical-shorts';
const QR   = '/tmp/d7-15s/qr.png';
const W = 1080, H = 1920, FPS = 30;

const SRC_D7  = path.join(ROOT, 'baccarat-gladiator-macau-dragon7-short.mp4');
const SRC_P8  = path.join(ROOT, 'baccarat-gladiator-macau-panda8-short.mp4');
const SRC_KBQ = path.join(ROOT, 'baccarat-gladiator-macau-koreanbbq-short.mp4');

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@900&family=Press+Start+2P&family=JetBrains+Mono:wght@400;700&display=swap">`;

function sh(cmd) {
  console.log('  $', cmd.replace(/\s+/g,' ').slice(0, 220));
  return execSync(cmd, { stdio: 'inherit' });
}
function dataUrl(p, mime) { return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`; }

async function renderHtmlMp4(browser, html, durSec, outPath) {
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

function ctaCardHtml() {
  const qrUrl = fs.existsSync(QR) ? dataUrl(QR, 'image/png') : '';
  return `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.30), transparent 55%),
      radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45), rgba(20,4,8,0.85) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:22px;letter-spacing:0.42em;color:#ff6cfa;margin-bottom:18px;}
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
// 18. Banker vs Player Odds (20s)
// ────────────────────────────────────────────────────────────
async function buildBankerVsPlayer(browser) {
  console.log('\n[18/23] Banker vs Player Odds…');
  const tmp = path.join(TMP, 'banker-player'); fs.mkdirSync(tmp, { recursive: true });
  const out = path.join(OUT, '18-banker-vs-player.mp4');

  // Hook + question + reveal + math + CTA
  const hookHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:120px;line-height:1.0;color:#fff7d6;
    -webkit-text-stroke:3px #1a0408;text-shadow:0 6px 14px rgba(0,0,0,0.85);}
  .pre{font-family:'Press Start 2P',monospace;font-size:26px;letter-spacing:0.42em;color:#ff6cfa;margin-bottom:30px;text-shadow:0 0 14px rgba(255,108,250,0.65);}
  </style></head><body>
    <div class="lockup">
      <div class="pre">★ BACCARAT MATH ★</div>
      <div class="head">BANKER OR<br>PLAYER?</div>
    </div>
  </body></html>`;
  await renderHtmlMp4(browser, hookHtml, 3, path.join(tmp, 'hook.mp4'));

  const battleHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:linear-gradient(90deg, rgba(255,180,40,0.35) 0%, rgba(20,4,8,0.92) 50%, rgba(108,108,250,0.35) 100%);}
  .row{position:absolute;left:0;right:0;display:flex;justify-content:space-between;padding:0 80px;}
  .row.top{top:18%;}
  .row.bot{bottom:18%;}
  .col{flex:1;text-align:center;}
  .label{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:96px;line-height:1;
    text-shadow:0 0 22px rgba(0,0,0,0.85);}
  .label.b{color:#ffd76e;}
  .label.p{color:#a8c8ff;}
  .pct{font-family:'Cinzel',serif;font-weight:900;font-size:160px;line-height:1;margin-top:30px;
    text-shadow:0 6px 18px rgba(0,0,0,0.85);}
  .pct.b{color:#ffd76e;}
  .pct.p{color:#a8c8ff;}
  .vs{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    font-family:'Press Start 2P',monospace;font-size:80px;color:#ff6cfa;text-shadow:0 0 24px rgba(255,108,250,0.7);}
  .footer{position:absolute;left:0;right:0;bottom:5%;text-align:center;
    font-family:'Cinzel',serif;font-weight:900;font-size:38px;letter-spacing:0.10em;color:#fff7d6;
    text-shadow:0 0 12px rgba(0,0,0,0.85);text-transform:uppercase;}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="row top">
      <div class="col"><div class="label b">BANKER</div></div>
      <div class="col"><div class="label p">PLAYER</div></div>
    </div>
    <div class="vs">VS</div>
    <div class="row bot">
      <div class="col"><div class="pct b">50.7%</div></div>
      <div class="col"><div class="pct p">49.3%</div></div>
    </div>
    <div class="footer">House edge — Banker is mathematically the play</div>
  </body></html>`;
  await renderHtmlMp4(browser, battleHtml, 8, path.join(tmp, 'battle.mp4'));

  const explainHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.25), transparent 55%),
      radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.35), rgba(20,4,8,0.85) 75%);}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:108px;line-height:1.0;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));margin-bottom:30px;}
  .body{font-family:'Cinzel',serif;font-weight:900;font-size:42px;letter-spacing:0.06em;color:#fff7d6;line-height:1.4;max-width:900px;
    text-shadow:0 0 12px rgba(0,0,0,0.85);}
  .body .gold{color:#ffd76e;}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="lockup">
      <div class="head">EZ BACCARAT</div>
      <div class="body">No <span class="gold">5% commission</span><br>Banker still pays 1:1<br>Just push on a <span class="gold">3-card 7</span></div>
    </div>
    <div class="vignette"></div>
  </body></html>`;
  await renderHtmlMp4(browser, explainHtml, 6, path.join(tmp, 'explain.mp4'));

  await renderHtmlMp4(browser, ctaCardHtml(), 3, path.join(tmp, 'cta.mp4'));

  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/hook.mp4'\nfile '${tmp}/battle.mp4'\nfile '${tmp}/explain.mp4'\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 20 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ────────────────────────────────────────────────────────────
// 19. Card Squeeze ASMR (30s)
// ────────────────────────────────────────────────────────────
async function buildSqueezeASMR(browser) {
  console.log('\n[19/23] Card Squeeze ASMR…');
  const tmp = path.join(TMP, 'squeeze'); fs.mkdirSync(tmp, { recursive: true });
  const out = path.join(OUT, '19-squeeze-asmr.mp4');

  const introHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:24px;letter-spacing:0.42em;color:#52d99a;margin-bottom:30px;text-shadow:0 0 14px rgba(82,217,154,0.6);}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:120px;line-height:1.0;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));margin-bottom:24px;}
  .sub{font-family:'Cinzel',serif;font-weight:900;font-size:42px;letter-spacing:0.18em;color:#fff7d6;text-transform:uppercase;
    text-shadow:0 0 14px rgba(0,0,0,0.85);}
  </style></head><body>
    <div class="lockup">
      <div class="pre">★ SLOW · CALM · CARDS ★</div>
      <div class="head">THE SQUEEZE</div>
      <div class="sub">Watch the third card flip</div>
    </div>
  </body></html>`;
  await renderHtmlMp4(browser, introHtml, 3, path.join(tmp, 'intro.mp4'));

  // 3 slow-mo flips back-to-back from the 3 source clips, slightly slowed.
  // Use setpts=1.4*PTS to give a 40% slow-mo feel.
  for (const [i, src] of [SRC_D7, SRC_P8, SRC_KBQ].entries()) {
    sh(`ffmpeg -y -hide_banner -loglevel error -ss 3.5 -t 6 -i "${src}" \
        -filter:v "scale=${W}:${H}:flags=lanczos,setpts=1.4*PTS" -an \
        -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p "${tmp}/clip-${i}.mp4"`);
  }

  const outroHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .head{font-family:'Cinzel',serif;font-weight:900;font-size:60px;letter-spacing:0.18em;color:#fff7d6;line-height:1.4;
    text-transform:uppercase;text-shadow:0 0 12px rgba(0,0,0,0.85);}
  .head .gold{color:#ffd76e;}
  </style></head><body>
    <div class="lockup">
      <div class="head">Try it yourself —<br><span class="gold">slow it down</span> next time you play.</div>
    </div>
  </body></html>`;
  await renderHtmlMp4(browser, outroHtml, 3, path.join(tmp, 'outro.mp4'));
  await renderHtmlMp4(browser, ctaCardHtml(), 3, path.join(tmp, 'cta.mp4'));

  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/intro.mp4'\nfile '${tmp}/clip-0.mp4'\nfile '${tmp}/clip-1.mp4'\nfile '${tmp}/clip-2.mp4'\nfile '${tmp}/outro.mp4'\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  // Re-mux ensures 30s
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -t 30 -c copy "${tmp}/video-trim.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 30 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-trim.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ────────────────────────────────────────────────────────────
// 20. 60 Stages in 60 Seconds (60s)
// ────────────────────────────────────────────────────────────
async function build60In60(browser) {
  console.log('\n[20/23] 60 Stages in 60 Seconds…');
  const tmp = path.join(TMP, '60in60'); fs.mkdirSync(tmp, { recursive: true });
  const out = path.join(OUT, '20-60-stages-in-60-seconds.mp4');

  // Stage list (compact representative subset of 60 — pulled from the roster).
  const allStages = [
    ['🇲🇴','Macau'],['🐱','Cat Cafe'],['🐶','Canine Club'],['🧸','Plush Club'],
    ['🐺','Big Bad Wolfie'],['🚀','Toy Cosmos'],['🧱','Block City'],
    ['☕','Hipster'],['🦅','Portlandia'],['🌳','Sleepy South'],['💃','Breaking'],
    ['🏄','Cali Surfer'],['🇲🇦','Marrakech'],['🇰🇪','Kenya'],['🇬🇪','Batumi'],
    ['🇨🇾','Cyprus'],['🇹🇼','Jiufen'],['🇲🇽','Mexico'],['🇺🇾','Uruguay'],
    ['🇰🇷','K-Town'],['🪩','Disco'],['🎡','Coachella'],['🔊','Techno Rave'],
    ['🥊','Muay Thai'],['🥋','Wing Chun'],['🇮🇹','Italy'],['🇪🇸','Spain'],
    ['🇫🇷','Paris'],['🇯🇵','Neo Tokyo'],['🤠','Texas'],['🌊','Cancun'],
    ['🌴','Maui'],['🇲🇨','Monaco'],['🏎','F1'],['⛵','Yacht Club'],
    ['🇸🇬','Marina Bay'],['🇮🇳','Mumbai'],['🇦🇪','Dubai'],['🗽','New York'],
    ['🌴','Miami'],['🌺','Hawaii'],['🐯','Macau Tiger'],['🌃','Shanghai'],
    ['🍣','Sushi Bar'],['🐉','Imperial Suite'],['💎','Atlantis'],['🌌','Galaxy'],
    ['🛡','The Colosseum'],
  ];

  // Hook (3s)
  const hookHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:26px;letter-spacing:0.42em;color:#ff6cfa;margin-bottom:30px;text-shadow:0 0 14px rgba(255,108,250,0.65);}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:160px;line-height:0.95;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));}
  .sub{margin-top:16px;font-family:'Cinzel',serif;font-weight:900;font-size:46px;letter-spacing:0.18em;color:#fff7d6;text-transform:uppercase;}
  </style></head><body>
    <div class="lockup">
      <div class="pre">★ ALL VENUES ★</div>
      <div class="head">60 STAGES</div>
      <div class="sub">in 60 seconds</div>
    </div>
  </body></html>`;
  await renderHtmlMp4(browser, hookHtml, 3, path.join(tmp, 'hook.mp4'));

  // Each stage gets ~1s — render as a single HTML slideshow with CSS animation
  // sequencing.  We render the whole 50s as one continuous mp4.
  const TILE_DUR = 1.1;  // seconds per tile
  const tileCount = Math.min(allStages.length, 47); // ~52s
  let tilesHtml = '';
  for (let i = 0; i < tileCount; i++) {
    const [emoji, name] = allStages[i];
    tilesHtml += `<div class="tile" style="animation-delay:${i*TILE_DUR}s;">
      <div class="emoji">${emoji}</div>
      <div class="name">${name}</div>
      <div class="num">${String(i+1).padStart(2,'0')}/60</div>
    </div>`;
  }
  const reelDur = tileCount * TILE_DUR;

  const reelHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;
    background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.25), transparent 55%),
               radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.40), rgba(20,4,8,0.85) 75%);}
  .tile{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;padding:40px;
    opacity:0;animation:flash ${TILE_DUR}s linear forwards;}
  @keyframes flash {
    0%   { opacity:0; transform:translateY(-50%) scale(0.85); }
    20%  { opacity:1; transform:translateY(-50%) scale(1.0); }
    80%  { opacity:1; transform:translateY(-50%) scale(1.0); }
    100% { opacity:0; transform:translateY(-50%) scale(1.05); }
  }
  .tile .emoji{font-size:300px;line-height:1;
    filter:drop-shadow(0 0 36px rgba(255,180,40,0.5)) drop-shadow(0 8px 14px rgba(0,0,0,0.85));margin-bottom:30px;}
  .tile .name{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:120px;line-height:1;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));}
  .tile .num{margin-top:30px;font-family:'Press Start 2P',monospace;font-size:34px;letter-spacing:0.32em;color:#ffd76e;}
  </style></head><body>
    <div class="bg"></div><div class="scanline"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    ${tilesHtml}
    <div class="vignette"></div>
  </body></html>`;
  await renderHtmlMp4(browser, reelHtml, reelDur, path.join(tmp, 'reel.mp4'));

  // Outro 4s (the rest fills 60s)
  await renderHtmlMp4(browser, ctaCardHtml(), 4, path.join(tmp, 'cta.mp4'));

  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/hook.mp4'\nfile '${tmp}/reel.mp4'\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -t 60 -c copy "${tmp}/video-trim.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 60 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-trim.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ────────────────────────────────────────────────────────────
// 21. Free Forever Manifesto (20s)
// ────────────────────────────────────────────────────────────
async function buildManifesto(browser) {
  console.log('\n[21/23] Free Forever Manifesto…');
  const tmp = path.join(TMP, 'manifesto'); fs.mkdirSync(tmp, { recursive: true });
  const out = path.join(OUT, '21-free-forever.mp4');

  const lines = [
    { kind:'big',  text:'NO ADS.' },
    { kind:'big',  text:'NO PURCHASES.' },
    { kind:'big',  text:'NO SIGNUP.' },
    { kind:'big',  text:'NO REAL MONEY.' },
    { kind:'gold', text:'JUST<br>BACCARAT.' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const html = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
    .bg{position:absolute;inset:0;background:#000;}
    .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
    .text{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:170px;line-height:1.0;letter-spacing:-0.02em;}
    .text.big{color:#fff7d6;-webkit-text-stroke:4px #1a0408;text-shadow:0 0 22px rgba(255,180,40,0.45);}
    .text.gold{
      background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
      -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
      filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85)) drop-shadow(0 0 32px rgba(255,180,40,0.55));
      font-size:200px;}
    </style></head><body>
      <div class="bg"></div>
      <div class="lockup">
        <div class="text ${L.kind}">${L.text}</div>
      </div>
    </body></html>`;
    const dur = L.kind === 'gold' ? 4 : 3;
    await renderHtmlMp4(browser, html, dur, path.join(tmp, `line-${i}.mp4`));
  }

  await renderHtmlMp4(browser, ctaCardHtml(), 4, path.join(tmp, 'cta.mp4'));

  const lineFiles = lines.map((_, i) => `file '${tmp}/line-${i}.mp4'`).join('\n');
  fs.writeFileSync(`${tmp}/concat.txt`, `${lineFiles}\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -t 20 -c copy "${tmp}/video-trim.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 20 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-trim.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ────────────────────────────────────────────────────────────
// 22. The 3D Table Devlog (30s)
// ────────────────────────────────────────────────────────────
async function build3DTableDevlog(browser) {
  console.log('\n[22/23] 3D Table Devlog…');
  const tmp = path.join(TMP, '3d-table'); fs.mkdirSync(tmp, { recursive: true });
  const out = path.join(OUT, '22-3d-table-devlog.mp4');

  const cards = [
    { title:'ONE PERSON.\nONE GAME.\nTHREE.JS.',     dur: 4 },
    { title:'WIREFRAME → MESH', body:'three.PerspectiveCamera()\nthree.Scene()\nthree.MeshStandardMaterial()', dur: 5 },
    { title:'CARDS, CHIPS,\nSHADOWS', body:'cardMesh.castShadow = true;\nchipMesh.geometry = chipShape;', dur: 5 },
    { title:'EZ BACCARAT\nLOGIC',     body:'isDragon7 = winner==="B"\n  && bankerCards.length===3\n  && bT===7;', dur: 5 },
    { title:'60 STAGES.\nALL FROM ONE TEMPLATE.', dur: 4 },
  ];

  // Intro
  const introHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .bg{position:absolute;inset:0;background:#0a0a14;}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .pre{font-family:'JetBrains Mono',monospace;font-size:36px;color:#52d99a;margin-bottom:30px;
    text-shadow:0 0 14px rgba(82,217,154,0.7);}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:138px;line-height:1.0;
    background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85));}
  </style></head><body>
    <div class="lockup">
      <div class="pre">$ npm run dev</div>
      <div class="head">3D BACCARAT<br>TABLE DEVLOG</div>
    </div>
  </body></html>`;
  await renderHtmlMp4(browser, introHtml, 3, path.join(tmp, 'intro.mp4'));

  for (const [i, c] of cards.entries()) {
    const html = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
    .bg{position:absolute;inset:0;background:#0a0a14;}
    .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
    .title{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:88px;line-height:1.05;color:#fff7d6;
      -webkit-text-stroke:3px #1a0408;text-shadow:0 0 22px rgba(255,180,40,0.45);margin-bottom:36px;letter-spacing:0.02em;}
    .code{
      font-family:'JetBrains Mono',monospace;font-size:38px;line-height:1.45;color:#d8d8e8;
      background:#15151f;border:2px solid #2a2a40;border-radius:14px;padding:30px 36px;max-width:820px;text-align:left;white-space:pre-wrap;
      box-shadow:0 12px 40px rgba(0,0,0,0.55);}
    .code span.k{color:#c678dd;} .code span.s{color:#98c379;} .code span.v{color:#52d99a;}
    </style></head><body>
      <div class="bg"></div>
      <div class="lockup">
        <div class="title">${c.title.replace(/\n/g,'<br>')}</div>
        ${c.body ? `<div class="code">${escapeHtml(c.body)}</div>` : ''}
      </div>
    </body></html>`;
    await renderHtmlMp4(browser, html, c.dur, path.join(tmp, `card-${i}.mp4`));
  }
  await renderHtmlMp4(browser, ctaCardHtml(), 3, path.join(tmp, 'cta.mp4'));

  const cardFiles = cards.map((_,i) => `file '${tmp}/card-${i}.mp4'`).join('\n');
  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/intro.mp4'\n${cardFiles}\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -t 30 -c copy "${tmp}/video-trim.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 30 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-trim.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

// ────────────────────────────────────────────────────────────
// 23. Worst Beat Ever (20s)
// ────────────────────────────────────────────────────────────
async function buildWorstBeat(browser) {
  console.log('\n[23/23] Worst Beat Ever…');
  const tmp = path.join(TMP, 'worst-beat'); fs.mkdirSync(tmp, { recursive: true });
  const out = path.join(OUT, '23-worst-beat-ever.mp4');

  const hookHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .pre{font-family:'Press Start 2P',monospace;font-size:24px;letter-spacing:0.42em;color:#ff5e5e;margin-bottom:30px;text-shadow:0 0 14px rgba(255,94,94,0.6);}
  .head{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:170px;line-height:1.0;color:#fff7d6;
    -webkit-text-stroke:4px #1a0408;text-shadow:0 0 22px rgba(184,0,31,0.65);}
  </style></head><body>
    <div class="lockup">
      <div class="pre">★ VARIANCE IS REAL ★</div>
      <div class="head">WORST<br>BEAT<br>EVER.</div>
    </div>
  </body></html>`;
  await renderHtmlMp4(browser, hookHtml, 3, path.join(tmp, 'hook.mp4'));

  // Mini "loss" simulation — just use a slowed-down clip with a "LOSS" overlay
  const overlayPath = path.join(tmp, 'loss-overlay.png');
  const overlayHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  body{background:transparent;}
  .panel{position:absolute;left:60px;right:60px;top:10%;
    padding:30px 40px;
    background:linear-gradient(180deg, rgba(40,8,12,0.78), rgba(60,12,18,0.72));
    border:3px solid rgba(255,94,94,0.85);border-radius:22px;text-align:center;
    box-shadow:0 12px 40px rgba(0,0,0,0.55), 0 0 60px rgba(255,94,94,0.25);}
  .panel .label{font-family:'Press Start 2P',monospace;font-size:32px;letter-spacing:0.42em;color:#ff5e5e;
    text-shadow:0 0 14px rgba(255,94,94,0.65);margin-bottom:16px;}
  .panel .num{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;font-size:160px;line-height:1.0;
    color:#fff7d6;-webkit-text-stroke:3px #1a0408;text-shadow:0 0 22px rgba(184,0,31,0.65);}
  </style></head><body>
    <div class="panel">
      <div class="label">★ SIDE BET WIPED ★</div>
      <div class="num">−$25</div>
    </div>
  </body></html>`;
  // Pillow-style png render
  {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(overlayHtml, { waitUntil: 'networkidle2' });
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 200));
    await page.screenshot({ path: overlayPath, type: 'png', omitBackground: true,
      clip: { x:0, y:0, width:W, height:H } });
    await page.close();
  }

  // Use the source dragon7 clip slowed + overlay
  sh(`ffmpeg -y -hide_banner -loglevel error -ss 1 -t 9 -i "${SRC_D7}" \
      -loop 1 -t 9 -i "${overlayPath}" \
      -filter_complex "
        [0:v]scale=${W}:${H}:flags=lanczos,setpts=1.3*PTS[v];
        [1:v]format=rgba,fade=t=in:st=1.0:d=0.4:alpha=1,fade=t=out:st=8.0:d=0.6:alpha=1[ovl];
        [v][ovl]overlay=0:0:format=auto
      " \
      -t 9 -r ${FPS} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -an "${tmp}/clip.mp4"`);

  const punchlineHtml = `<!DOCTYPE html><html><head>${FONTS}<style>${commonStyles()}
  .lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;}
  .head{font-family:'Cinzel',serif;font-weight:900;font-size:62px;letter-spacing:0.12em;color:#fff7d6;line-height:1.4;text-transform:uppercase;
    text-shadow:0 0 14px rgba(0,0,0,0.85);}
  .head .gold{color:#ffd76e;}
  </style></head><body>
    <div class="lockup">
      <div class="head">Run it back —<br>it's <span class="gold">free.</span></div>
    </div>
  </body></html>`;
  await renderHtmlMp4(browser, punchlineHtml, 4, path.join(tmp, 'punch.mp4'));
  await renderHtmlMp4(browser, ctaCardHtml(), 4, path.join(tmp, 'cta.mp4'));

  fs.writeFileSync(`${tmp}/concat.txt`,
    `file '${tmp}/hook.mp4'\nfile '${tmp}/clip.mp4'\nfile '${tmp}/punch.mp4'\nfile '${tmp}/cta.mp4'\n`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${tmp}/concat.txt" -c copy "${tmp}/video-only.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-only.mp4" -t 20 -c copy "${tmp}/video-trim.mp4"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -f lavfi -t 20 -i "anullsrc=cl=stereo:r=48000" -c:a aac -b:a 192k "${tmp}/audio.m4a"`);
  sh(`ffmpeg -y -hide_banner -loglevel error -i "${tmp}/video-trim.mp4" -i "${tmp}/audio.m4a" \
      -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${out}"`);
  console.log(`  ✓ ${path.basename(out)}`);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    await buildBankerVsPlayer(browser);
    await buildSqueezeASMR(browser);
    await build60In60(browser);
    await buildManifesto(browser);
    await build3DTableDevlog(browser);
    await buildWorstBeat(browser);
  } finally {
    await browser.close();
  }
  console.log('\n──────────────────────────────────────────────');
  console.log('6 topical Shorts built in:', OUT);
  for (const f of fs.readdirSync(OUT).sort().filter(n => n.match(/^(1[8-9]|2[0-3])-/))) {
    const stat = fs.statSync(path.join(OUT, f));
    console.log(`  ${f}  ${(stat.size/1024/1024).toFixed(2)} MB`);
  }
  console.log('──────────────────────────────────────────────');
})().catch(e => { console.error(e); process.exit(1); });
