// Fix the broken hiscore-render string in all 55 variant branches.
// The `String.prototype.replace` semantics interpreted `$'` in my
// replacement payload as the post-match substring, mangling the line:
//   '<span class="amt">+$' + entry.amount.toLocaleString() + '</span>' +
// into:
//   '<span class="amt">+\n</body>\n</html>\n + entry.amount...
// Sweep, re-write the offending block correctly, commit, ready for deploy.
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

function sh(cmd) {
  try { return execSync(cmd, { encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim(); }
  catch (e) { return { error: e.message, stderr: e.stderr?.toString() || '' }; }
}

// Match the mangled section regardless of what got inserted post-match.
// Starts at: '<span class="amt">+\n  (the broken open quote)
// Ends at:   \n + entry.amount.toLocaleString() + '</span>' +
const BAD_RE = /'<span class="amt">\+\n[\s\S]*?\n \+ entry\.amount\.toLocaleString\(\) \+ '<\/span>' \+/;

const GOOD = `'<span class="amt">+$' + entry.amount.toLocaleString() + '</span>' +`;

const startBranch = sh('git symbolic-ref --short HEAD');
const dirty = sh('git status --porcelain');
let stashed = false;
if (dirty && dirty.length) {
  sh('git stash push -u -m "wip-pre-hiscore-string-fix"');
  stashed = true;
}

const fixed = [];
for (const slug of SLUGS) {
  const branch = `road-to-${slug}`;
  const file = `road-to-${slug}.html`;
  const co = sh(`git checkout ${branch}`);
  if (co && co.error) { console.log(`FAIL ${slug.padEnd(20)} checkout`); continue; }
  if (!fs.existsSync(file)) { console.log(`SKIP ${slug.padEnd(20)} no file`); continue; }

  const orig = fs.readFileSync(file, 'utf8');
  const m = orig.match(BAD_RE);
  if (!m) {
    console.log(`NOOP ${slug.padEnd(20)}`);
    continue;
  }
  // The swallowed content (post-match substring) was DUPLICATED into the
  // file: once inside the mangled <span> string, and once at its real
  // position after init();</script>. So the fix is just to replace the
  // mangled section with the correct one-line GOOD payload — no need to
  // preserve the swallow.
  const i = orig.indexOf(m[0]);
  const out = orig.slice(0, i) + GOOD + orig.slice(i + m[0].length);
  fs.writeFileSync(file, out);
  sh(`git add ${file}`);
  const msg = `${slug}: fix hiscore innerHTML string mangling

The previous patch used String.replace() with a payload containing $'
which JS interpreted as the post-match substring placeholder. The
result was the renderHiscores list-item template inserting the entire
trailing portion of the variant file (</body></html>) into the
'<span class="amt">+ ... </span>' literal. Fix is the original
intended payload:
  '<span class="amt">+$' + entry.amount.toLocaleString() + '</span>'

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`;
  fs.writeFileSync('/tmp/.fix-hi-msg', msg);
  const commit = sh(`git commit -F /tmp/.fix-hi-msg`);
  if (commit && commit.error) { console.log(`FAIL ${slug.padEnd(20)} commit`); continue; }
  fixed.push(slug);
  console.log(`OK   ${slug.padEnd(20)} fixed + committed`);
}

console.log(`\nReturning to ${startBranch}...`);
sh(`git checkout ${startBranch}`);
if (stashed) sh('git stash pop');
console.log(`\nDone: ${fixed.length}/${SLUGS.length} branches repaired.`);
