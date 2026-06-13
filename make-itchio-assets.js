// itch.io assets:
//   itch-cover-630x500.jpg     — required cover (5:4)
//   itch-cover-1260x1000.jpg   — 2× retina cover
//   itch-screenshot-1.jpg ... itch-screenshot-5.jpg — 1280×720 screenshots
//
// Cover layout: gold "BACCARAT GLADIATOR" headline + "EZ Baccarat ·
// 60+ Themed Stages" subtitle + dragon emoji on a crimson/imperial bg.
// Screenshots are pulled from the existing 30s short at strategic
// timestamps that show off the gameplay + stage selector + CTA.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const SRC_30S = path.join(ROOT, 'baccarat-gladiator-dragon7-15s-stages.mp4');
const SRC_RAW = path.join(ROOT, 'baccarat-gladiator-macau-dragon7-short.mp4');

function sh(c) { console.log('  $', c.replace(/\s+/g,' ').slice(0,200)); execSync(c, { stdio: 'inherit' }); }
function dataUrl(p, mime) { return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`; }

(async () => {
  console.log('\n[1/3] Extracting hero frame for cover bg…');
  const heroBg = '/tmp/itch-hero.jpg';
  sh(`ffmpeg -y -hide_banner -loglevel error -ss 4.85 -i "${SRC_RAW}" \
      -frames:v 1 -q:v 2 "${heroBg}"`);
  const heroUrl = dataUrl(heroBg, 'image/jpeg');

  console.log('\n[2/3] Rendering itch.io cover via puppeteer…');
  const browser = await puppeteer.launch({ headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none'] });

  async function renderCover(W, H, outName) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@900&family=Press+Start+2P&display=swap">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${W}px;height:${H}px;background:#000;overflow:hidden;font-family:'Cinzel',serif;}
.bg{position:absolute;inset:0;background:url('${heroUrl}') center/cover no-repeat;
  filter:blur(${Math.round(W*0.008)}px) saturate(1.1) brightness(0.55);transform:scale(1.06);}
.tint{position:absolute;inset:0;
  background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,180,40,0.30), transparent 55%),
             radial-gradient(ellipse 90% 90% at 50% 60%, rgba(184,0,31,0.45), rgba(20,4,8,0.65) 75%);}
.scanline{position:absolute;inset:0;
  background:repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.10) 3px);
  mix-blend-mode:multiply;opacity:0.30;}
.lockup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${W*0.05}px;}
.pre{font-family:'Press Start 2P',monospace;font-size:${W*0.022}px;
  letter-spacing:0.42em;color:#ff6cfa;text-shadow:0 0 14px rgba(255,108,250,0.65),0 1px 3px rgba(0,0,0,0.85);
  margin-bottom:${W*0.018}px;}
.title{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;
  font-size:${W*0.105}px;line-height:0.96;letter-spacing:0.03em;
  background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 78%, #b8001f 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
  filter:drop-shadow(0 6px 18px rgba(0,0,0,0.85)) drop-shadow(0 0 32px rgba(255,180,40,0.5));
  margin-bottom:${W*0.025}px;}
.sub{font-family:'Cinzel',serif;font-weight:900;font-size:${W*0.038}px;letter-spacing:0.18em;
  color:#fff7d6;text-shadow:0 0 14px rgba(255,180,40,0.6),0 2px 5px rgba(0,0,0,0.85);
  text-transform:uppercase;}
.dragon{font-size:${W*0.07}px;line-height:1;margin-top:${W*0.018}px;
  filter:drop-shadow(0 0 22px #ffaa1a) drop-shadow(0 0 12px #ff5e00) drop-shadow(0 6px 10px rgba(0,0,0,0.85));}
.corner{position:absolute;width:${W*0.07}px;height:${W*0.07}px;border:2px solid rgba(255,215,110,0.55);}
.corner.tl{top:${W*0.025}px;left:${W*0.025}px;border-right:none;border-bottom:none;}
.corner.tr{top:${W*0.025}px;right:${W*0.025}px;border-left:none;border-bottom:none;}
.corner.bl{bottom:${W*0.025}px;left:${W*0.025}px;border-right:none;border-top:none;}
.corner.br{bottom:${W*0.025}px;right:${W*0.025}px;border-left:none;border-top:none;}
.vignette{position:absolute;inset:0;
  background:radial-gradient(ellipse 80% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%);}
</style></head>
<body>
  <div class="bg"></div><div class="tint"></div><div class="scanline"></div>
  <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
  <div class="lockup">
    <div class="pre">★ INSERT COIN ★</div>
    <div class="title">BACCARAT<br>GLADIATOR</div>
    <div class="sub">EZ Baccarat · 60+ Themed Stages</div>
    <div class="dragon">🐉</div>
  </div>
  <div class="vignette"></div>
</body></html>`;
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle2' });
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 250));
    const out = path.join(ROOT, outName);
    await page.screenshot({ path: out, type: 'jpeg', quality: 92,
                             clip: { x:0, y:0, width:W, height:H } });
    await page.close();
    console.log(`  ${outName} (${W}×${H})`);
    return out;
  }

  await renderCover(630,  500,  'itch-cover-630x500.jpg');
  await renderCover(1260, 1000, 'itch-cover-1260x1000.jpg');
  await browser.close();

  console.log('\n[3/3] Extracting screenshots from the 30s short…');
  // Pick 5 frames that show range: hook, climax peak, AYNE overlay,
  // stage selector, CTA card. All resized to 1280×720 (16:9 itch standard).
  const shots = [
    { t: 1.5,  name: 'itch-shot-01-hook.jpg' },        // hook with table zoom
    { t: 5.5,  name: 'itch-shot-02-dragon7.jpg' },     // Dragon 7 win moment
    { t: 6.2,  name: 'itch-shot-03-aync.jpg' },        // AYNE overlay
    { t: 14.0, name: 'itch-shot-04-stages.jpg' },      // stage selector
    { t: 28.5, name: 'itch-shot-05-cta.jpg' },         // CTA card
  ];
  for (const s of shots) {
    sh(`ffmpeg -y -hide_banner -loglevel error -ss ${s.t} -i "${SRC_30S}" \
        -frames:v 1 -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,scale=1280:720:flags=lanczos" \
        -q:v 2 "${path.join(ROOT, s.name)}"`);
    console.log(`  ${s.name}`);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log('Done. itch.io upload checklist:');
  console.log('  Cover:        itch-cover-630x500.jpg');
  console.log('  Cover (2×):   itch-cover-1260x1000.jpg');
  console.log('  Screenshots:  itch-shot-01..05-*.jpg');
  console.log('──────────────────────────────────────────────');
})().catch(e => { console.error(e); process.exit(1); });
