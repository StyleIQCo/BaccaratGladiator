// Strip branded IP references (Labubu, Lego/bricks, Toy Story, GTA, Fast &
// Furious, Bond, Ocean's 11, Mad Max, Vegas Hangover, To Kill a Mockingbird,
// Akira/Neo-Tokyo) from user-visible copy. URL slugs stay so existing links,
// previews, and branches keep working.
//
// Two passes:
//   1. stage-select.html + index.html — STAGES display names + taglines
//   2. Each branded variant HTML on its branch — <title>, og:title meta,
//      and welcome copy referencing the brand.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator';
process.chdir(REPO);

// ── Brand map ────────────────────────────────────────────────────
const BRANDS = [
  // slug, oldDisplay, newDisplay, oldTag, newTag, oldTitleFragment, newTitleFragment
  { slug:'labubu',          oldName:'Labubu Lab',     newName:'Plush Club',
    oldTag:'Plush mascot energy', newTag:'Plush mascots · velvet table',
    oldTitle:'Road to Labubu', newTitle:'Road to Plush Club' },
  { slug:'bricks',           oldName:'Bricks',         newName:'Block City',
    oldTag:'Block-by-block builder', newTag:'Stack city · click click',
    oldTitle:'Road to bricks', newTitle:'Road to Block City' },
  { slug:'toy-story',        oldName:'Toy Story',      newName:'Playroom',
    oldTag:"Andy's room · to infinity", newTag:'Toy box · to infinity',
    oldTitle:'Road to toy-story', newTitle:'Road to Playroom' },
  { slug:'gta',              oldName:'Vinewood',       newName:'Heist City',
    oldTag:'Grand theft baccarat', newTag:'Skyline scores · neon nights',
    oldTitle:'Road to GTA',    newTitle:'Road to Heist City' },
  { slug:'fast-furious',     oldName:'Fast & Furious', newName:'Quarter Mile',
    oldTag:'Quarter mile · family', newTag:'Street race · the family ride',
    oldTitle:'Road to fast-furious', newTitle:'Road to Quarter Mile' },
  { slug:'bond',             oldName:'Bond',           newName:'Spy Noir',
    oldTag:'MI6 · shaken not stirred', newTag:'Spy noir · shaken not stirred',
    oldTitle:'Road to Bond',   newTitle:'Road to Spy Noir' },
  { slug:'oceans-11',        oldName:"Ocean's 11",     newName:'Vault Job',
    oldTag:'Bellagio heist · five for five', newTag:'High-roller heist · five for five',
    oldTitle:'Road to Oceans 11', newTitle:'Road to Vault Job' },
  { slug:'mad-max',          oldName:'Mad Max',        newName:'Wasteland',
    oldTag:'Wasteland · fury road', newTag:'Wasteland · dust storm',
    oldTitle:'Road to Mad Max', newTitle:'Road to Wasteland' },
  { slug:'vegas-hangover',   oldName:'Vegas Hangover', newName:'Bachelor Strip',
    oldTag:'Caesars · what happens here', newTag:'Strip suite · what happens here',
    oldTitle:'Road to Vegas Hangover', newTitle:'Road to Bachelor Strip' },
  { slug:'mockingbird',      oldName:'Mockingbird',    newName:'Sleepy South',
    oldTag:'Maycomb · sleepy south', newTag:'Porch · cicada nights',
    oldTitle:'Road to Mockingbird', newTitle:'Road to Sleepy South' },
  { slug:'neo-tokyo-anime',  oldName:'Neo Tokyo',      newName:'Neo Tokyo',
    oldTag:'Akira · neo tokyo 2099', newTag:'Cyberpunk skyline · 2099',
    oldTitle:'Road to Neo-Tokyo', newTitle:'Road to Neo Tokyo' },
];

function sh(cmd) {
  try { return execSync(cmd, { encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim(); }
  catch (e) { return { error: e.message, stderr: e.stderr?.toString() || '' }; }
}

// ── PASS 1: stage-select.html (and its index.html mirror) ─────────
function patchStageSelect() {
  const target = path.join(REPO, 'stage-select.html');
  let html = fs.readFileSync(target, 'utf8');
  const before = html;
  for (const b of BRANDS) {
    // Match: { slug:'<slug>', name:'<oldName>', tag:'<oldTag>', tier:N }
    // Tolerant of internal whitespace.
    const slugEsc = b.slug.replace(/[-]/g, '\\-');
    const re = new RegExp(
      `(slug:\\s*'${slugEsc}'[^}]*?name:\\s*)'[^']*'([^}]*?tag:\\s*)'[^']*'`
    );
    if (re.test(html)) {
      html = html.replace(re, (_m, a, c) => `${a}'${b.newName.replace(/'/g, "\\'")}'${c}'${b.newTag}'`);
    }
  }
  if (html === before) return false;
  fs.writeFileSync(target, html);
  fs.writeFileSync(path.join(REPO, 'index.html'), html);
  console.log('OK   stage-select.html + index.html updated');
  return true;
}

// ── PASS 2: per-variant HTML titles + OG meta + welcome ───────────
function patchVariant(brand) {
  const branch = `road-to-${brand.slug}`;
  const file = `road-to-${brand.slug}.html`;
  const co = sh(`git checkout ${branch}`);
  if (co && co.error) {
    console.log(`FAIL ${brand.slug.padEnd(20)} checkout: ${co.stderr.split('\n')[0]}`);
    return false;
  }
  if (!fs.existsSync(file)) {
    console.log(`SKIP ${brand.slug.padEnd(20)} no file`);
    return false;
  }
  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  // <title>
  html = html.replace(
    new RegExp(`<title>${escapeRe(brand.oldTitle)}([^<]*)<\\/title>`),
    `<title>${brand.newTitle}$1</title>`
  );
  // og:title and twitter:title meta if present
  html = html.replace(
    new RegExp(`(content=")${escapeRe(brand.oldTitle)}`, 'g'),
    `$1${brand.newTitle}`
  );
  // Welcome <h3> sometimes carries the brand name
  html = html.replace(
    new RegExp(`<h3>([^<]*?)${escapeRe(brand.oldName)}([^<]*?)</h3>`, 'i'),
    `<h3>$1${brand.newName.toUpperCase()}$2</h3>`
  );

  if (html === before) {
    console.log(`NOOP ${brand.slug.padEnd(20)} (no brand-y copy found)`);
    return false;
  }

  fs.writeFileSync(file, html);
  sh(`git add ${file}`);
  const msg = `${brand.slug}: debrand user-facing copy

Replace branded IP references (${brand.oldName} / ${brand.oldTitle}) with
${brand.newName}. URL slug stays for back-compat with existing links,
previews, and branches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`;
  fs.writeFileSync('/tmp/.debrand-msg', msg);
  const commit = sh(`git commit -F /tmp/.debrand-msg`);
  if (commit && commit.error) {
    console.log(`FAIL ${brand.slug.padEnd(20)} commit: ${commit.stderr.split('\n')[0]}`);
    return false;
  }
  console.log(`OK   ${brand.slug.padEnd(20)} debranded`);
  return true;
}

function escapeRe(s) { return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'); }

const startBranch = sh('git symbolic-ref --short HEAD');

const dirty = sh('git status --porcelain');
let stashed = false;
if (dirty && dirty.length) {
  console.log('Stashing local changes...');
  sh('git stash push -u -m "wip-pre-debrand"');
  stashed = true;
}

console.log('=== Pass 2: per-variant HTML ===');
const fixed = [];
for (const b of BRANDS) {
  if (patchVariant(b)) fixed.push(b.slug);
}

console.log(`\nReturning to ${startBranch}...`);
sh(`git checkout ${startBranch}`);
if (stashed) {
  console.log('Restoring stashed changes...');
  sh('git stash pop');
}

console.log('\n=== Pass 1: stage-select.html ===');
const stageChanged = patchStageSelect();

console.log(`\nDone. Variants debranded: ${fixed.length}/${BRANDS.length}.`);
console.log('Variants to redeploy:', fixed.join(' '));
console.log('Stage-select changed:', stageChanged);
