// Apply the anchor 1/6 refactor to stage-select.html (and the index.html
// mirror) in place. Surgical patches — does not rewrite the file.
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator';

const EASE_TOKENS = `
/* ── Bespoke easing tokens (single source of truth) ─────────────── */
:root {
  --ease-out-back:   cubic-bezier(0.34, 1.30, 0.64, 1);
  --ease-spring:     cubic-bezier(0.5,  1.6,  0.4, 1);
  --ease-anticipate: cubic-bezier(0.7, -0.4, 0.4, 1);
  --ease-pop:        cubic-bezier(0.16, 1,    0.3, 1);
  --ease-press:      cubic-bezier(0.5,  0.05, 0.4, 1.4);
}
#sprite-defs { position:absolute; width:0; height:0; overflow:hidden; }
#particle-fx { position:fixed; inset:0; z-index:35; pointer-events:none; }
#marquee .pre .ico { width:11px; height:11px; color:#ff6cfa;
  filter:drop-shadow(0 0 4px #ff48d8); vertical-align:middle; }
#coin-hint .ico { width:11px; height:11px; color:currentColor; vertical-align:middle; }
.arrow .ico { width:22px; height:22px; color:currentColor;
  filter:drop-shadow(0 0 4px rgba(255,200,80,0.4)); }
#btn-home .ico { width:18px; height:18px; color:currentColor; }
.card .lock .icon { width:42px; height:42px; }
.arrow.pressed { animation:arrow-press 320ms var(--ease-press); }
@keyframes arrow-press {
  0%   { transform:translateY(0)    scale(1);    box-shadow:0 4px 0 #4a0820, 0 6px 14px rgba(0,0,0,0.6); }
  18%  { transform:translateY(-1px) scale(0.99); }
  35%  { transform:translateY(5px)  scale(0.96); box-shadow:0 1px 0 #4a0820, 0 2px 6px rgba(0,0,0,0.6); }
  62%  { transform:translateY(-2px) scale(1.04); }
  82%  { transform:translateY(1px)  scale(0.99); }
  100% { transform:translateY(0)    scale(1);    box-shadow:0 4px 0 #4a0820, 0 6px 14px rgba(0,0,0,0.6); }
}
#btn-select.pressed { animation:select-press 460ms var(--ease-press); }
@keyframes select-press {
  0%   { transform:translateY(0)   scale(1);    box-shadow:0 5px 0 #6a3818, 0 7px 18px rgba(255,180,40,0.45); }
  16%  { transform:translateY(-2px) scale(0.99); }
  38%  { transform:translateY(7px)  scale(0.94); box-shadow:0 1px 0 #6a3818, 0 2px 6px rgba(255,180,40,0.4); }
  62%  { transform:translateY(-3px) scale(1.06); }
  82%  { transform:translateY(2px)  scale(0.99); }
  100% { transform:translateY(0)   scale(1);    box-shadow:0 5px 0 #6a3818, 0 7px 18px rgba(255,180,40,0.45); }
}
.tier-pip.just-cleared { animation:pip-pop 700ms var(--ease-spring); }
@keyframes pip-pop {
  0%   { transform:scaleY(1)   scaleX(1); }
  35%  { transform:scaleY(2.4) scaleX(1.18); }
  60%  { transform:scaleY(0.85) scaleX(0.96); }
  85%  { transform:scaleY(1.08) scaleX(1.02); }
  100% { transform:scaleY(1)   scaleX(1); }
}
`;

const SPRITE_BLOCK = `
<svg id="sprite-defs" aria-hidden="true">
  <defs>
    <symbol id="i-lock" viewBox="0 0 24 24">
      <path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="4" y="10" width="16" height="11" rx="2.2" fill="currentColor"/>
      <path d="M12 14v3.6" fill="none" stroke="#1a0700"
            stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="12" cy="14" r="1.3" fill="#1a0700"/>
    </symbol>
    <symbol id="i-chevron-r" viewBox="0 0 24 24">
      <path d="M9 5.5l7 6.5-7 6.5" fill="none" stroke="currentColor"
            stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-chevron-l" viewBox="0 0 24 24">
      <path d="M15 5.5l-7 6.5 7 6.5" fill="none" stroke="currentColor"
            stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-star" viewBox="0 0 24 24">
      <path d="M12 2.4l2.94 6.46 6.96.74-5.18 4.74 1.46 6.86L12 17.7l-6.18 3.5 1.46-6.86L2.1 9.6l6.96-.74z"
            fill="currentColor"/>
    </symbol>
    <symbol id="i-info" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" fill="none"
              stroke="currentColor" stroke-width="2"/>
      <path d="M12 11v6.5" fill="none" stroke="currentColor"
            stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="12" cy="7.4" r="1.3" fill="currentColor"/>
    </symbol>
  </defs>
</svg>
`;

const PARTICLE_JS = `
// ════════════════════════════════════════════════════════════════
//  Particle FX — physics confetti for SELECT and tier unlock.
// ════════════════════════════════════════════════════════════════
class StageSelectFx {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.rafId = null;
    this.lastTs = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._tick = this._tick.bind(this);
  }
  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width  = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = w; this.h = h;
  }
  burst(x, y, palette, count = 60) {
    const colors = palette && palette.length ? palette : ['#ffe1a8'];
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const speed = 5 + Math.random() * 9;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (1 + Math.random() * 3),
        gy: 0.32, drag: 0.985,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.42,
        color: colors[i % colors.length],
        size: 4 + Math.random() * 6,
        life: 1.0, decay: 0.0045 + Math.random() * 0.006,
        shape: Math.random() < 0.55 ? 'rect' : (Math.random() < 0.7 ? 'circle' : 'streak'),
      });
    }
    this._start();
  }
  goldRush(x, y, count = 100) {
    this.burst(x, y, ['#fff5c8', '#ffe7a0', '#f5c450', '#ffd75a', '#c5b358'], count);
  }
  _start() {
    if (this.rafId !== null) return;
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this._tick);
  }
  _tick(ts) {
    const dt = Math.min((ts - this.lastTs) / 16.667, 2.5);
    this.lastTs = ts;
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);
    if (this.particles.length === 0) { this.rafId = null; return; }
    const next = [];
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.vy += p.gy * dt;
      p.vx *= Math.pow(p.drag, dt);
      p.vy *= Math.pow(p.drag, dt);
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.rot += p.rotV * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0 || p.y > h + 60 || p.x < -60 || p.x > w + 60) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        const sw = p.size * 0.6, sh = p.size * 1.2;
        ctx.fillRect(-sw/2, -sh/2, sw, sh);
      } else if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size * 0.18, -p.size * 1.4, p.size * 0.36, p.size * 2.8);
      }
      ctx.restore();
      next.push(p);
    }
    this.particles = next;
    this.rafId = requestAnimationFrame(this._tick);
  }
}
const fx = new StageSelectFx(document.getElementById('particle-fx'));
// Wrap select() to fire confetti from the SELECT button center.
const _origSelect = select;
select = function() {
  const stage = STAGES[idx];
  if (isTierUnlocked(stage.tier)) {
    const wasNewClear = !cleared.has(stage.tier);
    const btn = document.getElementById('btn-select');
    btn.classList.remove('pressed'); void btn.offsetWidth; btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 480);
    const r = btn.getBoundingClientRect();
    const tier = TIERS[stage.tier - 1];
    fx.burst(r.left + r.width / 2, r.top + r.height / 2,
             [tier.color, '#fff5c8', '#ffe7a0', '#ff6cfa', '#9affe7'], 70);
    if (wasNewClear && stage.tier < 10) {
      setTimeout(() => {
        const pip = document.getElementById('tier-bar').children[stage.tier - 1];
        if (pip) {
          pip.classList.add('just-cleared');
          setTimeout(() => pip.classList.remove('just-cleared'), 720);
        }
        fx.goldRush(window.innerWidth / 2, window.innerHeight * 0.55, 110);
      }, 220);
    }
  } else {
    const card = deck.children[idx];
    const btn = document.getElementById('btn-select');
    btn.classList.remove('pressed'); void btn.offsetWidth; btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 480);
  }
  _origSelect();
};
// Pulse arrow button on every nav click.
function _pulseArrow(el) {
  if (!el) return;
  el.classList.remove('pressed');
  void el.offsetWidth;
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 340);
}
document.getElementById('btn-prev').addEventListener('click', e => _pulseArrow(e.currentTarget));
document.getElementById('btn-next').addEventListener('click', e => _pulseArrow(e.currentTarget));
`;

function patch(html) {
  const before = html;
  const log = [];

  // 1. Easing tokens — insert immediately after <style>.
  if (!html.includes('--ease-out-back')) {
    html = html.replace(/(<style>\s*)/, `$1${EASE_TOKENS}\n`);
    log.push('+easing-tokens');
  }
  // 2. Sprite registry — insert immediately after <body>.
  if (!html.includes('id="sprite-defs"')) {
    html = html.replace(/(<body>\s*)/, `$1${SPRITE_BLOCK}\n`);
    log.push('+sprite-defs');
  }
  // 3. Replace ★ in INSERT COIN.
  if (html.includes('★ INSERT COIN ★')) {
    html = html.replace(
      /<div class="pre">★ INSERT COIN ★<\/div>/,
      `<div class="pre"><svg class="ico" aria-hidden="true"><use href="#i-star"/></svg> INSERT COIN <svg class="ico" aria-hidden="true"><use href="#i-star"/></svg></div>`
    );
    log.push('+insert-coin-svg');
  }
  // 4. Replace ◀ ▶ in coin-hint.
  if (html.includes('SWIPE OR TAP ◀ ▶')) {
    html = html.replace(
      /<div id="coin-hint">SWIPE OR TAP ◀ ▶<\/div>/,
      `<div id="coin-hint">SWIPE OR TAP <svg class="ico" aria-hidden="true"><use href="#i-chevron-l"/></svg> <svg class="ico" aria-hidden="true"><use href="#i-chevron-r"/></svg></div>`
    );
    log.push('+coin-hint-svg');
  }
  // 5. Replace ◀ in btn-prev.
  html = html.replace(
    /<button class="arrow" id="btn-prev" aria-label="Previous stage">◀<\/button>/,
    `<button class="arrow" id="btn-prev" aria-label="Previous stage"><svg class="ico" aria-hidden="true"><use href="#i-chevron-l"/></svg></button>`
  );
  // 6. Replace ▶ in btn-next.
  html = html.replace(
    /<button class="arrow" id="btn-next" aria-label="Next stage">▶<\/button>/,
    `<button class="arrow" id="btn-next" aria-label="Next stage"><svg class="ico" aria-hidden="true"><use href="#i-chevron-r"/></svg></button>`
  );
  if (html.includes('href="#i-chevron-l"')) log.push('+arrow-svg');
  // 7. Replace 🔒 in card template.
  if (html.includes('<div class="icon">🔒</div>')) {
    html = html.replace(
      /<div class="icon">🔒<\/div>/,
      `<svg class="icon" aria-hidden="true"><use href="#i-lock"/></svg>`
    );
    log.push('+lock-svg');
  }
  // 8. Replace "i" in btn-home with i-info SVG (handles both ⌂ legacy and "i" current).
  html = html.replace(
    /<button id="btn-home" aria-label="(?:About|Home)" title="(?:Home|Marketing splash)">[i⌂]<\/button>/,
    `<button id="btn-home" aria-label="About" title="Marketing splash"><svg class="ico" aria-hidden="true"><use href="#i-info"/></svg></button>`
  );
  if (html.includes('href="#i-info"')) log.push('+home-svg');

  // 9. Add particle canvas (after </header> close of #marquee).
  if (!html.includes('id="particle-fx"')) {
    html = html.replace(
      /(<\/header>)\s*\n\s*(<button id="btn-home")/,
      `$1\n\n<canvas id="particle-fx" aria-hidden="true"></canvas>\n\n$2`
    );
    if (html.includes('id="particle-fx"')) log.push('+particle-canvas');
  }
  // 10. Append particle JS at end of <script> just before </script>.
  if (!html.includes('class StageSelectFx')) {
    html = html.replace(
      /(\n\s*\/\/\s*Initial paint\s*\n\s*layout\(\);\s*\n)\s*<\/script>/,
      `$1${PARTICLE_JS}\n</script>`
    );
    if (html.includes('class StageSelectFx')) log.push('+particle-js');
  }

  return { html, log, changed: html !== before };
}

const target = path.join(ROOT, 'stage-select.html');
const html = fs.readFileSync(target, 'utf8');
const { html: out, log, changed } = patch(html);
if (changed) {
  fs.writeFileSync(target, out);
  // Mirror to index.html
  fs.writeFileSync(path.join(ROOT, 'index.html'), out);
  console.log(`OK stage-select.html (and index.html mirror): ${log.join(' ')}`);
} else {
  console.log('NOOP stage-select.html (already patched)');
}
