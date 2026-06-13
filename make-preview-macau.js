// Generate a 1200x630 OG preview for the Macau stage in the carousel.
// Renders a styled HTML card via puppeteer (matches the in-game palette
// — imperial red + lacquered gold + Cotai-strip lantern accents) and
// saves the JPEG into previews/preview-macau.jpg so the stage card has
// art on first paint.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'previews', 'preview-macau.jpg');
const W = 1200, H = 630;

const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@700;900&family=Press+Start+2P&display=swap" as="style">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@700;900&family=Press+Start+2P&display=swap">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body {
  width:${W}px; height:${H}px; background:#000;
  font-family:'Cinzel', serif;
  overflow:hidden;
}

/* ── Layered backdrop: Cotai-strip skyline silhouette over crimson glow ── */
.bg {
  position:absolute; inset:0;
  background:
    radial-gradient(ellipse 80% 60% at 50% 20%,
      rgba(255,180,40,0.30) 0%, transparent 38%),
    radial-gradient(ellipse 70% 70% at 50% 60%,
      #b8001f 0%, #5a0010 35%, #1f0408 75%, #0a0204 100%);
}
/* Skyline silhouette — pure CSS gradient bars representing Cotai towers */
.skyline {
  position:absolute; left:0; right:0; bottom:0; height:54%;
  background:
    linear-gradient(180deg, transparent 0%, transparent 35%, rgba(0,0,0,0.55) 80%),
    repeating-linear-gradient(90deg,
      transparent 0px,         transparent 32px,
      rgba(0,0,0,0.65) 32px,   rgba(0,0,0,0.65) 50px,
      transparent 50px,        transparent 68px,
      rgba(0,0,0,0.45) 68px,   rgba(0,0,0,0.45) 90px,
      transparent 90px,        transparent 110px,
      rgba(0,0,0,0.85) 110px,  rgba(0,0,0,0.85) 142px,
      transparent 142px,       transparent 170px,
      rgba(0,0,0,0.55) 170px,  rgba(0,0,0,0.55) 198px,
      transparent 198px,       transparent 220px);
  mask-image:linear-gradient(180deg, transparent 0%, black 18%, black 100%);
  -webkit-mask-image:linear-gradient(180deg, transparent 0%, black 18%, black 100%);
}
/* Window-light specks scattered across the skyline */
.skyline::before {
  content:""; position:absolute; inset:0;
  background-image:
    radial-gradient(2px 2px at 8% 80%, rgba(255,200,80,0.85), transparent),
    radial-gradient(1.5px 1.5px at 14% 65%, rgba(255,160,40,0.7), transparent),
    radial-gradient(2px 2px at 22% 78%, rgba(255,210,90,0.75), transparent),
    radial-gradient(1.5px 1.5px at 31% 60%, rgba(255,180,40,0.7), transparent),
    radial-gradient(2px 2px at 39% 82%, rgba(255,200,60,0.85), transparent),
    radial-gradient(1.5px 1.5px at 48% 55%, rgba(255,140,30,0.65), transparent),
    radial-gradient(2px 2px at 56% 70%, rgba(255,210,80,0.85), transparent),
    radial-gradient(2px 2px at 64% 60%, rgba(255,170,40,0.7), transparent),
    radial-gradient(1.5px 1.5px at 72% 78%, rgba(255,200,60,0.75), transparent),
    radial-gradient(2px 2px at 80% 65%, rgba(255,180,40,0.85), transparent),
    radial-gradient(1.5px 1.5px at 88% 80%, rgba(255,210,90,0.7), transparent),
    radial-gradient(2px 2px at 95% 60%, rgba(255,200,80,0.8), transparent);
  background-size:1200px 340px;
  background-repeat:no-repeat;
  filter:blur(0.6px);
}

/* ── Hanging lanterns top-left + top-right ── */
.lantern {
  position:absolute; width:54px; height:64px;
  border-radius:50% 50% 46% 46% / 60% 60% 40% 40%;
  background:radial-gradient(circle at 50% 28%,
    #ffe7a0 0%, #ff8a1a 22%, #b8001f 60%, #5a0008 100%);
  box-shadow:
    inset 0 -4px 6px rgba(40,4,4,0.6),
    inset 0 2px 4px rgba(255,220,140,0.55),
    0 0 24px rgba(255,140,40,0.55),
    0 0 60px rgba(184,0,31,0.35);
  filter:drop-shadow(0 6px 10px rgba(0,0,0,0.6));
}
.lantern::before {
  content:""; position:absolute; left:50%; top:-10px;
  transform:translateX(-50%);
  width:42%; height:14px; border-radius:4px 4px 2px 2px;
  background:linear-gradient(180deg, #2a0a0a, #100406);
}
.lantern::after {
  content:""; position:absolute; left:50%; bottom:-22px;
  transform:translateX(-50%);
  width:3px; height:22px; background:linear-gradient(180deg, #d4af37, #5a3a0a);
  box-shadow:0 0 6px rgba(212,175,55,0.55);
}
.lantern.l1 { top:60px;  left:90px;  transform:scale(0.95) rotate(-3deg); }
.lantern.l2 { top:140px; left:46px;  transform:scale(0.7)  rotate(2deg); }
.lantern.l3 { top:60px;  right:90px; transform:scale(0.95) rotate(3deg); }
.lantern.l4 { top:140px; right:46px; transform:scale(0.7)  rotate(-2deg); }

/* ── Center monogram + lockup ── */
.lockup {
  position:absolute; left:50%; top:50%;
  transform:translate(-50%, -50%);
  text-align:center;
  z-index:10;
}
.monogram {
  font-family:'Cinzel Decorative','Cinzel', serif;
  font-weight:900;
  font-size:240px; line-height:1;
  background:linear-gradient(180deg, #fff7d6 0%, #ffd76e 35%, #ff8a1a 70%, #b8001f 100%);
  -webkit-background-clip:text; background-clip:text;
  -webkit-text-fill-color:transparent; color:transparent;
  text-shadow:0 6px 24px rgba(0,0,0,0.85);
  filter:drop-shadow(0 0 30px rgba(255,180,40,0.55));
  letter-spacing:-0.04em;
}
.title {
  margin-top:-30px;
  font-family:'Cinzel', serif; font-weight:900;
  font-size:62px; letter-spacing:0.32em; line-height:1;
  color:#fff;
  text-shadow:0 2px 6px rgba(0,0,0,0.85), 0 0 22px rgba(255,180,40,0.4);
}
.subtitle {
  margin-top:14px;
  font-family:'Press Start 2P', monospace; font-size:18px;
  letter-spacing:0.42em;
  color:#ffd76e;
  text-shadow:0 0 14px rgba(255,180,40,0.55), 0 1px 3px rgba(0,0,0,0.85);
}

/* ── Vignette + scanline ── */
.vignette {
  position:absolute; inset:0;
  background:radial-gradient(ellipse at 50% 50%,
    transparent 50%, rgba(0,0,0,0.55) 100%);
  pointer-events:none;
}
.scanline {
  position:absolute; inset:0;
  background:repeating-linear-gradient(0deg,
    transparent 0px, transparent 2px,
    rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.10) 3px);
  mix-blend-mode:multiply; opacity:0.4;
  pointer-events:none;
}
</style></head>
<body>
  <div class="bg"></div>
  <div class="skyline"></div>

  <div class="lantern l1"></div>
  <div class="lantern l2"></div>
  <div class="lantern l3"></div>
  <div class="lantern l4"></div>

  <div class="lockup">
    <div class="monogram">VII</div>
    <div class="title">MACAU</div>
    <div class="subtitle">COTAI STRIP &nbsp;&middot;&nbsp; IMPERIAL DRAGON</div>
  </div>

  <div class="vignette"></div>
  <div class="scanline"></div>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle2' });
  // Give Google Fonts a beat to land
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({
    path: OUT, type: 'jpeg', quality: 92,
    clip: { x:0, y:0, width: W, height: H },
  });
  await browser.close();

  const stat = fs.statSync(OUT);
  console.log(`OK ${OUT} (${(stat.size/1024).toFixed(1)} KB · ${W}x${H} JPEG)`);
})();
