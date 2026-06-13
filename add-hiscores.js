// Add a cross-variant high-score slide-out tab to every variant. Mirrors
// the roads-shelf pattern: right-edge handle, panel slides in on tap,
// vertical "★ HI" label. Stores top-10 single-hand wins in localStorage
// under `bg_hiscores`, shared across all variants. Hooks into the
// existing showMsg('win') call to capture amounts.
const { execSync } = require('child_process');
const fs = require('fs');

const SLUGS = [
  'ac','baseball','batumi','bond','boxing','breaking','bricks',
  'cali-surfer','canada-f1','canine-club','coachella','cruise',
  'cyberpunk','cycling','cyprus','disco','fast-furious','gta',
  'hawaii','hipster','huff-puff','jet','kenya','ktown','labubu',
  'mad-max','manila','marrakech','melbourne','mexico','miami',
  'mockingbird','muay-thai','neo-tokyo-anime','nyc','oceans-11',
  'orbit','pga','portlandia','sg','silicon-valley','skydiving',
  'spain','techno-rave','texas','toy-story','ufc','uruguay',
  'vegas-hangover','wing-chun',
  'mc','gladiator','ktv-karaoke','prohibition-jazz','cat-cafe',
];

const REPO = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator';
process.chdir(REPO);

const HISCORE_CSS = `
/* High-score slide-out shelf — mirrors roads-shelf pattern. */
@media (max-width: 899px) {
  #hiscores-handle {
    position:fixed; right:0; top:60%;
    width:30px; height:96px;
    background:rgba(20,8,4,0.94);
    border:1px solid rgba(255,210,80,0.45);
    border-right:none;
    border-radius:10px 0 0 10px;
    display:flex; align-items:center; justify-content:center;
    cursor:pointer; z-index:10;
    box-shadow:-4px 4px 16px rgba(0,0,0,0.6);
    -webkit-tap-highlight-color:transparent;
    transition:right 0.42s var(--ease-out-back, ease);
  }
  #hiscores-handle::after {
    content:'★ HI';
    writing-mode:vertical-rl; text-orientation:mixed;
    font-family:'Cinzel',serif; font-size:0.62rem; letter-spacing:3px;
    color:rgba(255,210,80,0.92);
    transform:rotate(180deg);
  }
  #hiscores-shelf {
    position:fixed; top:0; bottom:0; right:0;
    width:calc(100vw - 30px);
    padding:18px 16px 18px 22px;
    background:rgba(20,8,4,0.96);
    border-left:1px solid rgba(255,210,80,0.5);
    border-radius:14px 0 0 14px;
    z-index:11;
    transform:translateX(100%);
    transition:transform 0.42s var(--ease-out-back, ease);
    overflow-y:auto;
    backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
    color:#f0e3c0; font-family:'Cinzel',serif;
  }
  #hiscores-shelf.open { transform:translateX(0); }
  body:has(#hiscores-shelf.open) #hiscores-handle { right:calc(100vw - 30px); }
}
@media (min-width: 900px) {
  /* Desktop: sit to the LEFT of the roads shelf as a sibling panel */
  #hiscores-handle { display:none; }
  #hiscores-shelf {
    position:fixed; top:78px; right:386px; width:260px;
    max-height:calc(100vh - 100px);
    background:rgba(20,8,4,0.96);
    border:1px solid rgba(255,210,80,0.4);
    border-radius:14px;
    padding:16px; z-index:10;
    color:#f0e3c0; font-family:'Cinzel',serif;
    transform:none !important; overflow-y:auto;
  }
}
#hiscores-shelf h2 {
  font-size:0.95rem; letter-spacing:5px; color:#ffe39a;
  margin-bottom:14px; padding-bottom:10px;
  border-bottom:1px solid rgba(255,210,80,0.25);
  font-weight:900;
  display:flex; align-items:center; gap:8px;
}
#hiscores-shelf h2 .ico { width:14px; height:14px; color:#ffe39a; }
#hiscores-list { list-style:none; padding:0; margin:0;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
#hiscores-list li {
  display:flex; align-items:center; gap:10px;
  padding:9px 4px; border-bottom:1px solid rgba(255,210,80,0.12);
  font-size:0.74rem;
  animation:hi-slide-in 0.45s var(--ease-out-back, ease) both;
}
#hiscores-list li:nth-child(1) { animation-delay:0.02s; }
#hiscores-list li:nth-child(2) { animation-delay:0.06s; }
#hiscores-list li:nth-child(3) { animation-delay:0.10s; }
#hiscores-list li:nth-child(4) { animation-delay:0.14s; }
#hiscores-list li:nth-child(5) { animation-delay:0.18s; }
@keyframes hi-slide-in {
  from { opacity:0; transform:translateX(20px); }
  to   { opacity:1; transform:translateX(0); }
}
#hiscores-list .rank {
  font-family:'Press Start 2P',monospace; font-size:0.5rem;
  letter-spacing:2px; color:#ffc060; min-width:26px; }
#hiscores-list .stage {
  flex:1; color:#e8dfc4; letter-spacing:1.5px; font-size:0.62rem;
  text-transform:uppercase; font-family:'Cinzel',serif; font-weight:700; }
#hiscores-list .stage.current { color:#ffe39a; }
#hiscores-list .amt {
  color:#7fffa9; font-weight:900; letter-spacing:1px;
  font-variant-numeric:tabular-nums; font-size:0.84rem; }
#hiscores-list .when {
  font-size:0.45rem; letter-spacing:1px; color:rgba(232,223,192,0.55);
  font-family:'Press Start 2P',monospace; min-width:36px; text-align:right; }
#hiscores-empty {
  color:rgba(232,223,192,0.55); font-size:0.7rem;
  letter-spacing:2px; text-align:center; padding:30px 10px;
  font-family:'Cinzel',serif; }
#hiscores-shelf .footer-note {
  font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  font-size:0.55rem; color:rgba(232,223,192,0.4);
  letter-spacing:1px; text-align:center; padding:14px 0 4px;
  border-top:1px solid rgba(255,210,80,0.12); margin-top:8px; }
`;

const HISCORE_HTML = `
<div id="hiscores-handle"></div>
<aside id="hiscores-shelf" aria-label="High scores">
  <h2><svg class="ico" aria-hidden="true"><use href="#i-star"/></svg> HIGH SCORES</h2>
  <ol id="hiscores-list"></ol>
  <div id="hiscores-empty" hidden>Play a hand to set your first score.</div>
  <div class="footer-note">TOP 10 SINGLE-HAND WINS · ACROSS ALL STAGES</div>
</aside>
`;

// New star sprite (might already exist via stage-select propagation)
const STAR_SYMBOL = `<symbol id="i-star" viewBox="0 0 24 24">
      <path d="M12 2.4l2.94 6.46 6.96.74-5.18 4.74 1.46 6.86L12 17.7l-6.18 3.5 1.46-6.86L2.1 9.6l6.96-.74z"
            fill="currentColor"/>
    </symbol>`;

const HISCORE_JS = `
// ════════════════════════════════════════════════════════════════
//  HIGH SCORES — cross-variant top-10 single-hand wins (localStorage)
// ════════════════════════════════════════════════════════════════
const HISCORE_KEY = 'bg_hiscores';
const HISCORE_LIMIT = 10;
function _loadHiscores() {
  try { return JSON.parse(localStorage.getItem(HISCORE_KEY) || '[]'); }
  catch (e) { return []; }
}
function _saveHiscores(list) {
  try { localStorage.setItem(HISCORE_KEY, JSON.stringify(list.slice(0, HISCORE_LIMIT))); }
  catch (e) {}
}
const _variantSlug = (location.pathname.match(/road-to-([a-z0-9-]+)\\.html/i) || [])[1] || 'unknown';
function _slugDisplay(slug) {
  if (!slug) return 'STAGE';
  return slug.replace(/-/g, ' ').toUpperCase();
}
function _shortDate(ts) {
  const d = new Date(ts); const m = d.getMonth() + 1, day = d.getDate();
  return m + '/' + day;
}
function recordHiscore(amount, slug) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const stageSlug = slug || _variantSlug;
  const list = _loadHiscores();
  // One entry per stage. New wins only update the leaderboard if
  // they BEAT the player's existing best on that stage — otherwise
  // every winning hand would push a new row, leaving a trail of
  // near-duplicate "high scores" of similar amounts.
  const existingIdx = list.findIndex(e => e.slug === stageSlug);
  if (existingIdx >= 0) {
    if (amount <= list[existingIdx].amount) return;
    list[existingIdx] = { amount, slug: stageSlug, ts: Date.now() };
  } else {
    list.push({ amount, slug: stageSlug, ts: Date.now() });
  }
  list.sort((a, b) => b.amount - a.amount);
  _saveHiscores(list);
  renderHiscores();
}
function renderHiscores() {
  const list = _loadHiscores();
  const ol = document.getElementById('hiscores-list');
  const empty = document.getElementById('hiscores-empty');
  if (!ol) return;
  ol.innerHTML = '';
  if (list.length === 0) { if (empty) empty.hidden = false; return; }
  if (empty) empty.hidden = true;
  list.slice(0, HISCORE_LIMIT).forEach((entry, i) => {
    const li = document.createElement('li');
    const isCurrent = entry.slug === _variantSlug;
    li.innerHTML =
      '<span class="rank">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="stage' + (isCurrent ? ' current' : '') + '">' + _slugDisplay(entry.slug) + '</span>' +
      '<span class="amt">+$' + entry.amount.toLocaleString() + '</span>' +
      '<span class="when">' + _shortDate(entry.ts) + '</span>';
    ol.appendChild(li);
  });
}

// Wrap showMsg so winning hands automatically push to the leaderboard.
// Original signature: showMsg(text, kind, ms). When kind==='win' the
// payout amount appears in the text as plus-dollar-amount.
const _origShowMsg = showMsg;
showMsg = function(text, kind, ms){
  if (kind === 'win') {
    const m = (text || '').match(/\\+\\$([0-9,]+)/);
    if (m) {
      const amt = parseInt(m[1].replace(/,/g, ''), 10);
      if (amt > 0) recordHiscore(amt, _variantSlug);
    }
  }
  _origShowMsg(text, kind, ms);
};

// Slide-out wiring — mirrors the roads-shelf pattern.
const hiscoresShelf = document.getElementById('hiscores-shelf');
const hiscoresHandle = document.getElementById('hiscores-handle');
if (hiscoresHandle && hiscoresShelf) {
  hiscoresHandle.addEventListener('click', () => {
    if (window.innerWidth >= 900) return;
    hiscoresShelf.classList.toggle('open');
    // Auto-close roads shelf if it was open, to avoid visual stacking.
    const rs = document.getElementById('roads-shelf');
    if (rs && hiscoresShelf.classList.contains('open')) rs.classList.remove('open');
    if (hiscoresShelf.classList.contains('open')) renderHiscores();
  });
}
let _hiTouchX = null;
if (hiscoresShelf) {
  hiscoresShelf.addEventListener('touchstart', e => {
    if (window.innerWidth >= 900 || !hiscoresShelf.classList.contains('open')) return;
    _hiTouchX = e.touches[0].clientX;
  }, { passive: true });
  hiscoresShelf.addEventListener('touchend', e => {
    if (_hiTouchX === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? _hiTouchX) - _hiTouchX;
    if (dx > 50) hiscoresShelf.classList.remove('open');
    _hiTouchX = null;
  });
}
// Also close on tap inside (desktop sits inline so this only fires on mobile)
hiscoresShelf && hiscoresShelf.addEventListener('click', e => {
  if (window.innerWidth >= 900) return;
  // Don't close if clicking the list (allow scroll/select)
  if (e.target.closest('#hiscores-list')) return;
});

renderHiscores();
`;

function sh(cmd) {
  try { return execSync(cmd, { encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim(); }
  catch (e) { return { error: e.message, stderr: e.stderr?.toString() || '' }; }
}

function patch(html) {
  const before = html;
  let log = [];

  if (html.includes('id="hiscores-shelf"')) {
    return { html, log:['noop'], changed:false };
  }

  // Insert star sprite if not already present (most variants got it via stage-select propagation).
  if (!html.includes('id="i-star"')) {
    html = html.replace(/(<defs>)/, `$1\n    ${STAR_SYMBOL}`);
    log.push('+star-sprite');
  }

  // Insert CSS at end of <style>
  html = html.replace(/(<\/style>)/, `${HISCORE_CSS}\n$1`);
  log.push('+hiscore-css');

  // Insert HTML right after roads-shelf </aside>
  if (/<\/aside>\s*<button id="btn-clear">/.test(html)) {
    html = html.replace(
      /(<\/aside>)(\s*<button id="btn-clear">)/,
      `$1\n${HISCORE_HTML}\n$2`
    );
    log.push('+hiscore-html');
  } else if (html.includes('id="roads-shelf"')) {
    // Fallback: insert after roads-shelf
    html = html.replace(
      /(<aside id="roads-shelf"[\s\S]*?<\/aside>)/,
      `$1\n${HISCORE_HTML}`
    );
    log.push('+hiscore-html-alt');
  }

  // Insert JS just before init();
  if (/\binit\(\);\s*<\/script>/.test(html)) {
    html = html.replace(/(\binit\(\);\s*<\/script>)/, `${HISCORE_JS}\n$1`);
    log.push('+hiscore-js');
  }

  return { html, log, changed: html !== before };
}

const startBranch = sh('git symbolic-ref --short HEAD');
const dirty = sh('git status --porcelain');
let stashed = false;
if (dirty && dirty.length) {
  console.log('Stashing local changes...');
  sh('git stash push -u -m "wip-pre-hiscores"');
  stashed = true;
}

const fixed = [];
for (const slug of SLUGS) {
  const branch = `road-to-${slug}`;
  const file = `road-to-${slug}.html`;
  const co = sh(`git checkout ${branch}`);
  if (co && co.error) {
    console.log(`FAIL ${slug.padEnd(20)} checkout`);
    continue;
  }
  if (!fs.existsSync(file)) {
    console.log(`SKIP ${slug.padEnd(20)} no file`);
    continue;
  }
  const orig = fs.readFileSync(file, 'utf8');
  const { html: out, log, changed } = patch(orig);
  if (!changed) {
    console.log(`NOOP ${slug.padEnd(20)} (already has hiscores)`);
    continue;
  }
  fs.writeFileSync(file, out);
  sh(`git add ${file}`);
  const msg = `${slug}: add cross-variant high-scores slide-out tab

Mirrors the roads-shelf right-side slide-out pattern. New '★ HI'
handle below the roads handle. Cross-variant top-10 single-hand wins
persisted in localStorage (key bg_hiscores). Auto-records via
showMsg('win') wrapper, so any hand that prints a +\\$N toast lands on
the leaderboard.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`;
  fs.writeFileSync('/tmp/.hi-msg', msg);
  const commit = sh(`git commit -F /tmp/.hi-msg`);
  if (commit && commit.error) {
    console.log(`FAIL ${slug.padEnd(20)} commit: ${commit.stderr.split('\n')[0]}`);
    continue;
  }
  console.log(`OK   ${slug.padEnd(20)} ${log.join(' ')}`);
  fixed.push(slug);
}

console.log(`\nReturning to ${startBranch}...`);
sh(`git checkout ${startBranch}`);
if (stashed) {
  console.log('Restoring stashed changes...');
  sh('git stash pop');
}

console.log(`\nDone: ${fixed.length}/${SLUGS.length} branches updated.`);
