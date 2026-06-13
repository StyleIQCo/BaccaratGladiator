// Propagate the MC anchor 2 refactor (emoji → SVG, bespoke eases,
// canvas particles) across the 51 palette-swap variants. Each variant
// is on its own git branch; we extract the file via `git show`, apply
// the patches, write to /tmp, and report. Deploy + commit happens in
// a separate step after visual verification.
//
// Usage:
//   node propagate-refactor.js              # all 50 palette-swap variants
//   node propagate-refactor.js <slug>       # single variant
//   node propagate-refactor.js --apply      # also write to working tree (skips git checkout)
//
// Notes:
//   - Game logic is NOT touched. Patches are surgical inserts + emoji→SVG swaps.
//   - Easing tokens are added to :root but existing transitions/keyframes are
//     left alone in this pass — swapping every cubic-bezier across 50 files
//     is high-risk; the easing tokens become available for future patches.
//   - Sprite registry, win-particle canvas, and WinParticleSystem mirror MC.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ALL_PALETTE_SWAPS = [
  // 50 palette-swap reskins
  'ac','baseball','batumi','bond','boxing','breaking','bricks',
  'cali-surfer','canada-f1','canine-club','coachella','cruise',
  'cyberpunk','cycling','cyprus','disco','fast-furious','gta',
  'hawaii','hipster','huff-puff','jet','kenya','ktown','labubu',
  'mad-max','manila','marrakech','melbourne','mexico','miami',
  'mockingbird','muay-thai','neo-tokyo-anime','nyc','oceans-11',
  'orbit','pga','portlandia','sg','silicon-valley','skydiving',
  'spain','techno-rave','texas','toy-story','ufc','uruguay',
  'vegas-hangover','wing-chun',
  // Canonical MC base + 4 boss variants — propagator's MC-targeted
  // patches still apply to these (sprite registry, easing tokens,
  // win canvas, base emoji swaps for ⊞/🔇/✕). Boss-specific glyphs
  // (🛡/🎤/⌚/🧶) remain — those are a separate variant-specific pass.
  'mc','gladiator','ktv-karaoke','prohibition-jazz','cat-cafe',
];

// ── Patch payloads ────────────────────────────────────────────────

const EASING_TOKENS_BLOCK = `
/* ════════════════════════════════════════════════════════════════
   Bespoke easing tokens — propagated from MC anchor refactor.
   Available for future per-variant easing upgrades.
   ════════════════════════════════════════════════════════════════ */
:root {
  --ease-out-back:   cubic-bezier(0.34, 1.30, 0.64, 1);
  --ease-spring:     cubic-bezier(0.5,  1.6,  0.4, 1);
  --ease-anticipate: cubic-bezier(0.7, -0.4, 0.4, 1);
  --ease-pop:        cubic-bezier(0.16, 1,    0.3, 1);
  --ease-press:      cubic-bezier(0.5,  0.05, 0.4, 1.4);
}
#sprite-defs { position:absolute; width:0; height:0; overflow:hidden; }
#win-particle-fx { position:fixed; inset:0; pointer-events:none; z-index:8; }
`;

const SPRITE_REGISTRY_BLOCK = `
<svg id="sprite-defs" aria-hidden="true">
  <defs>
    <symbol id="i-grid" viewBox="0 0 24 24">
      <rect x="3" y="3"  width="7" height="7" rx="1.4" fill="currentColor"/>
      <rect x="14" y="3" width="7" height="7" rx="1.4" fill="currentColor"/>
      <rect x="3" y="14" width="7" height="7" rx="1.4" fill="currentColor"/>
      <rect x="14" y="14" width="7" height="7" rx="1.4" fill="currentColor"/>
    </symbol>
    <symbol id="i-sound-off" viewBox="0 0 24 24">
      <path d="M3 9v6h4l5 5V4L7 9H3z" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <path d="M16 9l5 5M21 9l-5 5" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </symbol>
    <symbol id="i-sound-on" viewBox="0 0 24 24">
      <path d="M3 9v6h4l5 5V4L7 9H3z" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <path d="M16 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </symbol>
    <symbol id="i-close" viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6L6 18" fill="none"
            stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    </symbol>
    <symbol id="i-monkey-card" viewBox="0 0 24 24">
      <rect x="4" y="3" width="16" height="18" rx="2.2"
            fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M8 9c0-1.4 1.6-2.4 4-2.4S16 7.6 16 9c0 1.6-2 2.6-2 4M12 16.5v.5"
            fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </symbol>
    <symbol id="i-eye" viewBox="0 0 24 24">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
            fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
    </symbol>
    <symbol id="i-sparkle" viewBox="0 0 24 24">
      <path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z"
            fill="currentColor"/>
    </symbol>
  </defs>
</svg>
`;

// Win-particle canvas tag. Inserted right after <canvas id="stage"></canvas>
const WIN_CANVAS_TAG = `<canvas id="win-particle-fx"></canvas>`;

// CSS for the SVG icon size in the buttons. Inserted near the end of <style>
const ICO_SIZE_CSS = `
#btn-burger,#btn-sound,#menu-close { display:flex; align-items:center; justify-content:center; }
#btn-burger .ico, #btn-sound .ico { width:20px; height:20px; color:currentColor; }
#menu-close .ico { width:18px; height:18px; color:currentColor; }
`;

// New WinParticleSystem JS — inserted just before init() near end of module script.
const WIN_PARTICLE_JS = `
// ════════════════════════════════════════════════════════════════
//  WIN-STATE + SHOE-TRANSITION PARTICLE SYSTEM (propagated)
//  Bespoke physics. Auto-pauses rAF loop when idle.
// ════════════════════════════════════════════════════════════════
class WinParticleSystem {
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
  confettiBurst(x, y, winner) {
    const palette = winner === 'P'
      ? ['#9fbfff','#5f8cff','#ffe39a','#ffffff','#aac8ff']
      : ['#ff9c9c','#ff6868','#ffe39a','#ffffff','#ffb8b8'];
    for (let i = 0; i < 64; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const speed = 5 + Math.random() * 8;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (1 + Math.random() * 3),
        gy: 0.30, drag: 0.985,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.42,
        color: palette[i % palette.length],
        size: 4 + Math.random() * 6,
        life: 1.0, decay: 0.0050 + Math.random() * 0.005,
        shape: Math.random() < 0.55 ? 'rect' : (Math.random() < 0.7 ? 'circle' : 'streak'),
      });
    }
    this._start();
  }
  shoeSweep() {
    const palette = ['#c9a84c', '#f7e09a', '#ffe39a', '#fff5d4', '#a87830'];
    const baseY = this.h - 20;
    for (let i = 0; i < 48; i++) {
      const x = (i / 48) * this.w + (Math.random() - 0.5) * 30;
      this.particles.push({
        x, y: baseY,
        vx: (Math.random() - 0.3) * 3.5,
        vy: -2 - Math.random() * 4,
        gy: 0.06, drag: 0.992,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.18,
        color: palette[i % palette.length],
        size: 2 + Math.random() * 3,
        life: 1.0, decay: 0.006 + Math.random() * 0.004,
        shape: 'circle',
      });
    }
    this._start();
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
const winFx = new WinParticleSystem(document.getElementById('win-particle-fx'));
bus.on('shoeRebuilt', () => winFx.shoeSweep());
// Wrap highlightWinner so the particle burst fires from the winning total's
// screen position. Keeps the existing function intact.
const _origHighlightWinner = highlightWinner;
highlightWinner = function(winner){
  _origHighlightWinner(winner);
  if (winner === 'P' || winner === 'B') {
    const winEl = document.querySelector(winner === 'P' ? '.total.t-player' : '.total.t-banker');
    if (winEl) {
      const r = winEl.getBoundingClientRect();
      winFx.confettiBurst(r.left + r.width / 2, r.top + r.height / 2, winner);
    }
  }
};
`;

// ── Patches ───────────────────────────────────────────────────────

function applyPatches(html, slug) {
  const before = html;
  const log = [];

  // Patch 1: easing tokens block — insert immediately after the opening <style>.
  if (!html.includes('--ease-out-back')) {
    html = html.replace(/(<style>\s*)/, `$1${EASING_TOKENS_BLOCK}\n`);
    log.push('+easing-tokens');
  }

  // Patch 2: ico-size CSS — append to end of <style>.
  if (!html.includes('#btn-burger .ico')) {
    html = html.replace(/(<\/style>)/, `${ICO_SIZE_CSS}\n$1`);
    log.push('+ico-css');
  }

  // Patch 3: SVG sprite registry — insert immediately after <body>.
  if (!html.includes('id="sprite-defs"')) {
    html = html.replace(/(<body>\s*)/, `$1${SPRITE_REGISTRY_BLOCK}\n`);
    log.push('+sprite-defs');
  }

  // Patch 4: win-particle canvas — insert right after <canvas id="stage"></canvas>.
  if (!html.includes('id="win-particle-fx"')) {
    html = html.replace(
      /(<canvas id="stage"><\/canvas>)/,
      `$1\n${WIN_CANVAS_TAG}`
    );
    log.push('+win-canvas');
  }

  // Patch 5: replace ⊞ in burger button.
  if (html.includes('aria-label="Menu">⊞<')) {
    html = html.replace(
      /<button id="btn-burger" aria-label="Menu">⊞<\/button>/,
      `<button id="btn-burger" aria-label="Menu"><svg class="ico" aria-hidden="true"><use href="#i-grid"/></svg></button>`
    );
    log.push('+burger-svg');
  }

  // Patch 6: replace 🔇 in btn-sound (default state — JS swaps on toggle).
  html = html.replace(
    /<button id="btn-sound" aria-label="Toggle dealer audio" title="Dealer audio">🔇<\/button>/,
    `<button id="btn-sound" aria-label="Toggle dealer audio" title="Dealer audio"><svg class="ico" aria-hidden="true"><use href="#i-sound-off"/></svg></button>`
  );
  if (html !== before && log.indexOf('+sound-svg') === -1 && !before.includes('id="btn-sound"')) {
    // no-op
  } else if (html.includes('href="#i-sound-off"')) {
    log.push('+sound-svg');
  }

  // Patch 7: replace ✕ in menu-close.
  html = html.replace(
    /<button id="menu-close" aria-label="Close">✕<\/button>/,
    `<button id="menu-close" aria-label="Close"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>`
  );
  if (html.includes('href="#i-close"')) log.push('+close-svg');

  // Patch 8: applyDealerAudioState — swap textContent assignment with SVG href swap.
  // Match the line `btn.textContent = window.__rtnDealerAudioOn ? '🔊' : '🔇';`
  // (with any whitespace around it).
  const dealerAudioRe = /btn\.textContent\s*=\s*window\.__rtnDealerAudioOn\s*\?\s*['"]🔊['"]\s*:\s*['"]🔇['"];/;
  if (dealerAudioRe.test(html)) {
    html = html.replace(dealerAudioRe,
      `const useEl = btn.querySelector('use'); if (useEl) useEl.setAttribute('href', window.__rtnDealerAudioOn ? '#i-sound-on' : '#i-sound-off');`);
    log.push('+dealer-audio-svg');
  }

  // Patch 9: setSqueezeHint — replace emoji glyphs with SVG <use> markers.
  // Three substitutions on innerHTML strings. Handle conservatively — only
  // the well-known combinations from MC base.
  const squeezePatches = [
    {
      from: /'🃏 MONKEY — VALUE 0'/,
      to:   `'<svg class="ico" aria-hidden="true"><use href="#i-monkey-card"/></svg> MONKEY — VALUE 0'`
    },
    {
      from: /'👁 ONE LINE — A · 2 · 3'/,
      to:   `'<svg class="ico" aria-hidden="true"><use href="#i-eye"/></svg> ONE LINE — A · 2 · 3'`
    },
    {
      from: /'👁 TWO LINES — 4 · 5'/,
      to:   `'<svg class="ico" aria-hidden="true"><use href="#i-eye"/></svg> TWO LINES — 4 · 5'`
    },
    {
      from: /'👁 DOTS — 6 · 7 · 8 · 9'/,
      to:   `'<svg class="ico" aria-hidden="true"><use href="#i-eye"/></svg> DOTS — 6 · 7 · 8 · 9'`
    },
    {
      from: /'🃏 MONKEY'/,
      to:   `'<svg class="ico" aria-hidden="true"><use href="#i-monkey-card"/></svg> MONKEY'`
    },
    {
      from: /'✦ ALMOST THERE…'/,
      to:   `'<svg class="ico" aria-hidden="true"><use href="#i-sparkle"/></svg> ALMOST THERE…'`
    },
  ];
  for (const p of squeezePatches) {
    if (p.from.test(html)) { html = html.replace(p.from, p.to); log.push('+squeeze-svg'); }
  }

  // Patch 10: bus.emit('shoeRebuilt') inside newShoe.
  // Inject right before the `return cs;` at the end of newShoe.
  if (!html.includes("bus.emit('shoeRebuilt'")) {
    html = html.replace(
      /(function newShoe\(\)[\s\S]*?for \(let i = cs\.length - 1; i > 0; i--\)[\s\S]*?\}\s*)return cs;/,
      `$1bus.emit('shoeRebuilt', cs.length);\n  return cs;`
    );
    if (html.includes("bus.emit('shoeRebuilt'")) log.push('+shoe-rebuild-emit');
  }

  // Patch 11: WinParticleSystem class + hooks — insert before `init();`.
  if (!html.includes('class WinParticleSystem')) {
    html = html.replace(/(\binit\(\);\s*<\/script>)/, `${WIN_PARTICLE_JS}\n$1`);
    if (html.includes('class WinParticleSystem')) log.push('+win-particle-js');
  }

  return { html, log, changed: html !== before };
}

// ── Driver ────────────────────────────────────────────────────────

function loadVariant(slug) {
  const branch = `road-to-${slug}`;
  const file = `road-to-${slug}.html`;
  try {
    const html = execSync(`git show ${branch}:${file}`, { encoding: 'utf8' });
    return html;
  } catch (e) {
    console.log(`SKIP ${slug.padEnd(20)} ${e.message.split('\n')[0]}`);
    return null;
  }
}

function processSlug(slug, opts = {}) {
  const html = loadVariant(slug);
  if (!html) return { slug, ok: false };
  const { html: out, log, changed } = applyPatches(html, slug);
  if (!changed) {
    console.log(`NOOP ${slug.padEnd(20)} (already refactored?)`);
    return { slug, ok: true, changed: false };
  }
  const outPath = path.join('/tmp', `road-to-${slug}.refactored.html`);
  fs.writeFileSync(outPath, out);
  const beforeBytes = Buffer.byteLength(html);
  const afterBytes = Buffer.byteLength(out);
  console.log(`OK   ${slug.padEnd(20)} ${log.join(' ')} · ${beforeBytes}→${afterBytes} bytes`);
  return { slug, ok: true, changed: true, log, outPath };
}

const args = process.argv.slice(2);
const slugFilter = args.find(a => !a.startsWith('--'));
const apply = args.includes('--apply');

const targets = slugFilter ? [slugFilter] : ALL_PALETTE_SWAPS;
const results = targets.map(s => processSlug(s, { apply }));
const ok = results.filter(r => r.changed).length;
const total = results.length;
console.log(`\nDone: ${ok}/${total} variants patched. Files in /tmp/road-to-<slug>.refactored.html`);
