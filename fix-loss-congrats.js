// Fix the dealer-reaction bug: warm_congrats.mp4 should never play when
// the player's net is ≤ 0. Original logic fired congrats whenever a pair
// (isPairP || isPairB) landed on the felt, regardless of whether the
// player had a winning bet. New logic gates congrats on `net > 0`.
//
// Sweeps across all 55 variant branches. For each:
//   git checkout {branch}
//   patch the file in place
//   git add + commit
//   leave file in working tree for the deploy phase
//
// Usage: node fix-loss-congrats.js [--dry-run]
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

const DRY = process.argv.includes('--dry-run');

function sh(cmd) {
  try { return execSync(cmd, { encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim(); }
  catch (e) { return { error: e.message, stderr: e.stderr?.toString() || '' }; }
}

function patchHtml(html) {
  const before = html;
  // Generic pattern: any `if (X || ... || net > 100) playCongratsVideo();`
  // condition where the body fires the warm-congrats video. Variants use
  // different side-bet flags (isPairP/isPairB, isDragon7/isPanda8,
  // isBigTiger/isSmallTiger/isTiger/isTigerTie, isPDragonBig/isBDragonBig,
  // isPerfectPair, isEitherPair, etc.) so we capture the whole condition
  // and prepend `net > 0 &&`. Skip lines already gated on `net > 0`.
  const pattern = /if\s*\(\s*([^)]*\bnet\s*>\s*100[^)]*)\)\s+playCongratsVideo\(\);/;
  const m = html.match(pattern);
  if (!m) return { html, changed:false };
  const inner = m[1].trim();
  // Skip if already gated on net > 0 (idempotent).
  if (/^net\s*>\s*0\s*&&/.test(inner)) return { html, changed:false };
  // Skip if the only condition is `net > 100` (implies net > 0 — no bug).
  if (/^net\s*>\s*100\s*$/.test(inner)) return { html, changed:false };
  html = html.replace(pattern,
    `if (net > 0 && (${inner})) playCongratsVideo();`);
  return { html, changed: html !== before };
}

const startBranch = sh('git symbolic-ref --short HEAD');

const dirty = sh('git status --porcelain');
let stashed = false;
if (dirty && dirty.length) {
  console.log('Stashing local changes (untracked + modified)...');
  sh('git stash push -u -m "wip-pre-loss-congrats-fix"');
  stashed = true;
}

const fixed = [];
for (const slug of SLUGS) {
  const branch = `road-to-${slug}`;
  const file = `road-to-${slug}.html`;
  const co = sh(`git checkout ${branch}`);
  if (co && co.error) {
    console.log(`FAIL ${slug.padEnd(20)} checkout: ${co.stderr.split('\n')[0]}`);
    continue;
  }
  if (!fs.existsSync(file)) {
    console.log(`SKIP ${slug.padEnd(20)} no file`);
    continue;
  }
  const orig = fs.readFileSync(file, 'utf8');
  const { html: out, changed } = patchHtml(orig);
  if (!changed) {
    console.log(`NOOP ${slug.padEnd(20)} pattern not found (already fixed?)`);
    continue;
  }
  if (DRY) {
    console.log(`DRY  ${slug.padEnd(20)} would patch (orig ${orig.length} → new ${out.length})`);
    continue;
  }
  fs.writeFileSync(file, out);
  sh(`git add ${file}`);
  const msg = `${slug}: fix dealer-congrats-on-loss bug

The dealer's warm_congrats.mp4 was firing whenever a pair landed on
the felt (isPairP || isPairB), regardless of whether the player held
a winning bet. Concrete repro: bet $100 on banker, player wins with
no pair → fine. But if the cards happened to land a player pair, the
player lost $100 yet got celebrated by the dealer.

Fix gates the congrats on \`net > 0\` so the video only plays when the
player is up on the hand. The other branches (smirk for small win,
laughing for tie-no-bet, sympathetic for loss) already followed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`;
  fs.writeFileSync('/tmp/.fix-msg', msg);
  const commit = sh(`git commit -F /tmp/.fix-msg`);
  if (commit && commit.error) {
    console.log(`FAIL ${slug.padEnd(20)} commit: ${commit.stderr.split('\n')[0]}`);
    continue;
  }
  fixed.push(slug);
  console.log(`OK   ${slug.padEnd(20)} fixed + committed`);
}

console.log(`\nReturning to ${startBranch}...`);
sh(`git checkout ${startBranch}`);
if (stashed) {
  console.log('Restoring stashed changes...');
  sh('git stash pop');
}

console.log(`\nDone: ${fixed.length}/${SLUGS.length} branches patched.`);
console.log('Slugs to redeploy:', fixed.join(' '));
