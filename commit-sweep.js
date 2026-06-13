// Sweep across all 55 variant branches, drop the propagator's refactored
// file into the working tree, and commit. Saves the user's main checkout
// at the start, restores at the end.
//
// Usage: node commit-sweep.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

function sh(cmd) {
  try { return execSync(cmd, { encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim(); }
  catch (e) { return { error: e.message, stderr: e.stderr?.toString() || '' }; }
}

const startBranch = sh('git symbolic-ref --short HEAD');
console.log(`Starting on branch: ${startBranch}`);

// Stash any uncommitted state so checkouts succeed cleanly.
const dirty = sh('git status --porcelain');
let stashed = false;
if (dirty && dirty.length) {
  console.log('Stashing local changes...');
  sh('git stash push -u -m "wip-pre-sweep"');
  stashed = true;
}

const results = [];
for (const slug of SLUGS) {
  const branch = `road-to-${slug}`;
  const file = `road-to-${slug}.html`;
  const refactored = `/tmp/${file.replace('.html', '.refactored.html')}`;

  if (!fs.existsSync(refactored)) {
    console.log(`SKIP ${slug.padEnd(20)} no /tmp file`);
    results.push({ slug, ok:false, reason:'no /tmp file' });
    continue;
  }

  const checkout = sh(`git checkout ${branch}`);
  if (checkout && checkout.error) {
    console.log(`FAIL ${slug.padEnd(20)} checkout: ${checkout.stderr.split('\n')[0]}`);
    results.push({ slug, ok:false, reason:'checkout' });
    continue;
  }

  fs.copyFileSync(refactored, path.join(REPO, file));

  const status = sh(`git status --porcelain ${file}`);
  if (!status || !status.length) {
    console.log(`NOOP ${slug.padEnd(20)} (file already matches)`);
    results.push({ slug, ok:true, changed:false });
    continue;
  }

  sh(`git add ${file}`);
  const commitMsg = `${slug}: emoji → SVG sprites, bespoke easing tokens, win-particle canvas

Propagated from MC anchor refactor:
- :root --ease-* tokens (out-back, spring, anticipate, pop, press)
- <svg id="sprite-defs"> registry: i-grid, i-sound-off/on, i-close,
  i-monkey-card, i-eye, i-sparkle (all currentColor)
- HTML emoji glyphs (⌘/🔇/✕, plus the squeeze-hint
  monkey/eye/sparkle innerHTML) swapped for inline <use> references
- applyDealerAudioState now toggles the speaker SVG via use[href] swap
  rather than textContent assignment
- New <canvas id=\"win-particle-fx\"> + WinParticleSystem class:
    - bus.on('shoeRebuilt') → gold sand-sweep on each new shoe
    - highlightWinner wrapped → confetti from winning total's rect
- bus.emit('shoeRebuilt', cs.length) added inside newShoe()

Game logic, betting math, and state management untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`;
  fs.writeFileSync('/tmp/.commit-msg', commitMsg);
  const commit = sh(`git commit -F /tmp/.commit-msg`);
  if (commit.error) {
    console.log(`FAIL ${slug.padEnd(20)} commit: ${commit.stderr.split('\n')[0]}`);
    results.push({ slug, ok:false, reason:'commit' });
    continue;
  }
  console.log(`OK   ${slug.padEnd(20)} committed`);
  results.push({ slug, ok:true, changed:true });
}

console.log(`\nReturning to ${startBranch}...`);
sh(`git checkout ${startBranch}`);
if (stashed) {
  console.log('Restoring stashed changes...');
  sh('git stash pop');
}

const ok = results.filter(r => r.changed).length;
console.log(`\nDone: ${ok}/${results.length} branches updated.`);
