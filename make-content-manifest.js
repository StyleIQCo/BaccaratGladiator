// Generates the seamless content kit for posting 25 Shorts across
// YouTube + Instagram + (optionally) X / TikTok / itch.io / Reddit.
//
// Outputs (all in shorts/):
//   manifest.json      — full metadata per video (machine-readable)
//   captions.md        — paste-ready caption blocks per platform per video
//   buffer-import.csv  — Buffer / Later / Hootsuite compatible CSV
//   posting-checklist.md — printable checklist for the 25-day calendar

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SHORTS_DIR = path.join(ROOT, 'shorts');
const URL = 'https://baccaratgladiator.com';
const CHANNEL_HANDLE = '@baccaratgladiator';
const OG_HANDLE = 'baccaratgladiator';

// 25-day calendar: start Monday after this script runs (or today if Mon).
function nextMonday() {
  const d = new Date();
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1); // 1 = Monday
  d.setHours(15, 0, 0, 0); // 3 PM ET (best YouTube Shorts window)
  return d;
}
function fmtISO(d) { return d.toISOString().slice(0,16).replace('T',' ')+' UTC'; }
function fmtShort(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Posting schedule order — alternating clusters for algorithmic variety.
const POST_ORDER = [
  // Day 1-7
  { file: '06-stage-macau.mp4',                   cluster: 'casino' },
  { file: '18-banker-vs-player.mp4',              cluster: 'strategy' },
  { file: '07-stage-huff-puff.mp4',               cluster: 'casual' },
  { file: '19-squeeze-asmr.mp4',                  cluster: 'tactile' },
  { file: '17-stage-gladiator.mp4',               cluster: 'progression' },
  { file: '22-3d-table-devlog.mp4',               cluster: 'devlog' },
  { file: '09-stage-cat-cafe.mp4',                cluster: 'cute' },
  // Day 8-14
  { file: '04-tier-10-colosseum.mp4',             cluster: 'curiosity' },
  { file: '21-free-forever.mp4',                  cluster: 'brand' },
  { file: '14-stage-miami.mp4',                   cluster: 'lifestyle' },
  { file: '01-side-bet-showdown.mp4',             cluster: 'casino' },
  { file: '20-60-stages-in-60-seconds.mp4',       cluster: 'aspirational' },
  { file: '12-stage-coachella.mp4',               cluster: 'festival' },
  { file: '23-worst-beat-ever.mp4',               cluster: 'variance' },
  // Day 15-21
  { file: '13-stage-spain.mp4',                   cluster: 'international' },
  { file: '02-korean-bbq-rule.mp4',               cluster: 'curiosity' },
  { file: '11-stage-kenya.mp4',                   cluster: 'international' },
  { file: '03-ez-baccarat-howto.mp4',             cluster: 'educational' },
  { file: '16-stage-imperial-vip.mp4',            cluster: 'high-tier' },
  { file: '10-stage-marrakech.mp4',               cluster: 'international' },
  { file: '05-devlog-6-weeks.mp4',                cluster: 'devlog' },
  // Day 22-23
  { file: '15-stage-hawaii.mp4',                  cluster: 'aspirational' },
  { file: '08-stage-toy-story.mp4',               cluster: 'playful' },
];

// Per-video caption + hashtag content.
// Note: TikTok-safe versions intentionally drop "casino", "$", "win", multipliers.
const META = {
  '01-side-bet-showdown.mp4': {
    title: '3 Baccarat Side Bets Ranked 🐉🐼🥢',
    yt_title: '3 Baccarat Side Bets Ranked 🐉🐼🥢 #shorts',
    yt: '3 baccarat side bets compared — Dragon 7 (40:1), Panda 8 (25:1), Korean BBQ. All faithful to real EZ Baccarat math.\n\nFree practice → baccaratgladiator.com\n\n#shorts #baccarat #ezbaccarat #dragon7 #panda8 #cardgame #strategy',
    ig: '3 baccarat side bets ranked 🐉🐼🥢\nDragon 7 · Panda 8 · Korean BBQ — all faithful to real EZ Baccarat math.\n\nLink in bio → baccaratgladiator.com\n\n#baccarat #ezbaccarat #dragon7 #panda8 #cardgame #strategy #indiegame @indiegamefactory @indiegamelover',
    tt: '3 card-game side bets explained 🐉🐼🥢\nLink in bio.\n\n#cardgame #strategy #indiegame #devlog #math',
    x:  '3 baccarat side bets ranked 🐉🐼🥢\nDragon 7 · Panda 8 · Korean BBQ\n\nbaccaratgladiator.com',
  },
  '02-korean-bbq-rule.mp4': {
    title: 'The Korean BBQ Baccarat Rule 🥩🥢',
    yt_title: 'The Korean BBQ Baccarat Rule (Almost No One Knows) 🥩🥢 #shorts',
    yt: 'There\'s a baccarat rule almost no one knows about. The Korean BBQ rule — a 2-card 7 vs 2-card 6 stand-off where neither side wins, and players just order food. A real rule, faithfully simulated.\n\nbaccaratgladiator.com\n\n#shorts #baccarat #weirdrules #cardgame #macau #ezbaccarat',
    ig: 'The Korean BBQ rule in baccarat 🥩🥢\nA 2-card 7 vs 2-card 6 stand-off where neither side wins — players just order food.\n\nLink in bio → baccaratgladiator.com\n\n#baccarat #weirdrules #cardgame #macau #ezbaccarat #didyouknow @indiegamefactory @indiegamelover',
    tt: 'Did you know this card-game rule? 🥩🥢\nWhen 2-card 7 meets 2-card 6, both sides stand. Both lose. Players order food.\nLink in bio.\n\n#cardgame #didyouknow #weirdrules',
    x:  'The Korean BBQ baccarat rule — when nobody wins, players just order food 🥩🥢\n\nbaccaratgladiator.com',
  },
  '03-ez-baccarat-howto.mp4': {
    title: 'EZ Baccarat in 30 Seconds 🐉',
    yt_title: 'EZ Baccarat Rules Explained in 30 Seconds 🐉 #shorts',
    yt: 'EZ Baccarat in 30 seconds — the rules that replaced the 5% banker commission. Includes Dragon 7 (40:1) and Panda 8 (25:1) side bets.\n\nPractice for free → baccaratgladiator.com\n\n#shorts #baccarat #ezbaccarat #howtoplay #cardgame #strategy #beginner',
    ig: 'EZ Baccarat in 30 seconds 🐉\nThe rules that replaced the 5% banker commission.\n\nLink in bio → baccaratgladiator.com\n\n#baccarat #ezbaccarat #howtoplay #cardgame #strategy #beginner @indiegamefactory @indiegamelover',
    tt: 'How this card game works in 30 seconds 🐉\nLink in bio.\n\n#cardgame #howtoplay #beginner #strategy',
    x:  'EZ Baccarat in 30 seconds — the rules that replaced the 5% commission 🐉\n\nbaccaratgladiator.com',
  },
  '04-tier-10-colosseum.mp4': {
    title: 'Tier 10 Boss Reveal — The Colosseum 🛡',
    yt_title: 'The Final Boss Tier — The Colosseum 🛡 #shorts',
    yt: 'To unlock the final tier in Baccarat Gladiator, you have to clear all 9 below. Tier 10 — Imperial Rome · Tyrian purple · The Colosseum.\n\nbaccaratgladiator.com\n\n#shorts #indiegame #baccarat #colosseum #progression #cardgame #devlog',
    ig: 'The final boss tier in Baccarat Gladiator 🛡\nClear 9 venues to unlock The Colosseum.\n\nLink in bio → baccaratgladiator.com\n\n#indiegame #baccarat #colosseum #progression #cardgame #devlog @indiegamefactory @indiegamelover',
    tt: 'The final boss tier in this game 🛡\nClear 9 levels to unlock it.\nLink in bio.\n\n#indiegame #cardgame #devlog #progression',
    x:  'The final boss tier in Baccarat Gladiator 🛡 — Imperial Rome, Tyrian purple, The Colosseum.\n\nbaccaratgladiator.com',
  },
  '05-devlog-6-weeks.mp4': {
    title: 'I Built a 60-Stage Baccarat Arcade in 6 Weeks 🎮',
    yt_title: 'I Built a 60-Stage Baccarat Arcade in 6 Weeks (Solo Dev) 🎮 #shorts',
    yt: 'Built a 60-stage baccarat arcade in 6 weeks — solo, browser-based, Three.js. Here\'s the timelapse.\n\nLive → baccaratgladiator.com\n\n#shorts #indiedev #devlog #gamedev #buildinpublic #threejs #solodev #webgame #indiehackers',
    ig: 'Built a 60-stage baccarat arcade in 6 weeks 🎮\nSolo dev, browser-based, Three.js. The full timelapse.\n\nLink in bio → baccaratgladiator.com\n\n#indiedev #devlog #gamedev #buildinpublic #threejs #solodev #webgame #indiehackers @indiegamefactory @madebydevs @gamedevwizards',
    tt: 'Built a 60-stage card game arcade in 6 weeks. Solo. Three.js.\nLink in bio.\n\n#gamedev #devlog #indiedev #buildinpublic #threejs #solodev',
    x:  'Built a 60-stage baccarat arcade in 6 weeks — solo, browser-based, @threejs_org.\n\nFull build at baccaratgladiator.com',
  },
  '06-stage-macau.mp4': makeStageCaption('06', 'Macau', 'Cotai Strip · Imperial Dragon', '🇲🇴', 1, 'macau'),
  '07-stage-huff-puff.mp4': makeStageCaption('07', 'Big Bad Wolfie', 'Howl at the moon', '🐺', 1, 'folklore'),
  '08-stage-toy-story.mp4': makeStageCaption('08', 'Toy Cosmos', 'Bedroom rocket · to the moon', '🚀', 1, 'playful'),
  '09-stage-cat-cafe.mp4':  makeStageCaption('09', 'Cat Cafe', 'Tokyo paw bets', '🐱', 1, 'tokyo'),
  '10-stage-marrakech.mp4': makeStageCaption('10', 'Marrakech', 'Souk · spice & velvet', '🇲🇦', 2, 'morocco'),
  '11-stage-kenya.mp4':     makeStageCaption('11', 'Kenya', 'Savanna · sunrise pit', '🇰🇪', 3, 'kenya'),
  '12-stage-coachella.mp4': makeStageCaption('12', 'Coachella', 'Festival ferris · neon sand', '🎡', 4, 'festival'),
  '13-stage-spain.mp4':     makeStageCaption('13', 'Spain', 'Madrid · matador red', '🇪🇸', 5, 'spain'),
  '14-stage-miami.mp4':     makeStageCaption('14', 'Miami', 'South Beach · pastel deco', '🌴', 7, 'miami'),
  '15-stage-hawaii.mp4':    makeStageCaption('15', 'Hawaii', 'Big Island · volcano table', '🌺', 7, 'hawaii'),
  '16-stage-imperial-vip.mp4': makeStageCaption('16', 'Imperial Suite', 'Forbidden City · jade table', '🐉', 9, 'imperial'),
  '17-stage-gladiator.mp4': makeStageCaption('17', 'The Colosseum', 'Imperial Rome · Tyrian purple', '🛡', 10, 'colosseum'),
  '18-banker-vs-player.mp4': {
    title: 'Banker vs Player — 50.7% vs 49.3% 🐉',
    yt_title: 'Banker vs Player — Why Banker Wins (50.7% vs 49.3%) 🐉 #shorts',
    yt: 'Banker vs Player — 50.7% vs 49.3%. The math says it all. EZ Baccarat removes the 5% commission. Banker still pays 1:1, you just push on a Dragon 7.\n\nFree practice → baccaratgladiator.com\n\n#shorts #baccarat #ezbaccarat #math #strategy #cardgame',
    ig: 'Banker vs Player — 50.7% vs 49.3%. The math says it all 🐉\n\nLink in bio → baccaratgladiator.com\n\n#baccarat #ezbaccarat #math #strategy #cardgame @indiegamefactory @indiegamelover',
    tt: 'The math behind this card game — 50.7% vs 49.3%.\nLink in bio.\n\n#cardgame #math #strategy #didyouknow',
    x:  'Banker vs Player — 50.7% vs 49.3%. The math behind why banker is the play.\n\nbaccaratgladiator.com',
  },
  '19-squeeze-asmr.mp4': {
    title: 'The Card Squeeze — ASMR Baccarat 🃏',
    yt_title: 'The Card Squeeze — ASMR Baccarat (Slow-Mo) 🃏 #shorts',
    yt: 'The squeeze — slow it down next time you play. Real baccarat is half math, half ritual.\n\nbaccaratgladiator.com\n\n#shorts #baccarat #asmr #cards #squeeze #cardgame #satisfying',
    ig: 'The squeeze 🃏\nSlow it down next time you play.\n\nLink in bio → baccaratgladiator.com\n\n#baccarat #asmr #cards #squeeze #cardgame #satisfying #slowmo @indiegamefactory @indiegamelover',
    tt: 'Slow-motion card flip ASMR 🃏\nLink in bio.\n\n#asmr #cards #satisfying #slowmo #relaxing',
    x:  'Slow it down — the squeeze in baccarat is half math, half ritual.\n\nbaccaratgladiator.com',
  },
  '20-60-stages-in-60-seconds.mp4': {
    title: '60 Stages in 60 Seconds 🎰',
    yt_title: '60 Baccarat Stages in 60 Seconds 🎰 #shorts',
    yt: '60 stages in 60 seconds — from Macau to The Colosseum. A whirlwind tour of every venue in Baccarat Gladiator.\n\nFree play → baccaratgladiator.com\n\n#shorts #baccarat #indiegame #60stages #cardgame #devlog #arcade',
    ig: '60 stages in 60 seconds 🎰\nFrom Macau to The Colosseum.\n\nLink in bio → baccaratgladiator.com\n\n#baccarat #indiegame #60stages #cardgame #devlog #arcade @indiegamefactory @indiegamelover @madebydevs',
    tt: '60 levels in 60 seconds 🎰 An indie card-game showcase.\nLink in bio.\n\n#indiegame #cardgame #devlog #60levels #arcade',
    x:  '60 baccarat stages in 60 seconds 🎰\nFrom Macau to The Colosseum, every venue in Baccarat Gladiator.\n\nbaccaratgladiator.com',
  },
  '21-free-forever.mp4': {
    title: 'No Ads. No Purchases. No Real Money. Just Baccarat 🎯',
    yt_title: 'Free Forever — No Ads, No Purchases, No Real Money 🎯 #shorts',
    yt: 'No ads. No purchases. No signup. No real money. Just baccarat — free forever, runs in any browser.\n\nbaccaratgladiator.com\n\n#shorts #baccarat #freegame #indiegame #cardgame #nopaywall',
    ig: 'No ads. No purchases. No signup. No real money. Just baccarat 🎯\n\nLink in bio → baccaratgladiator.com\n\n#baccarat #freegame #indiegame #cardgame #nopaywall @indiegamefactory @indiegamelover',
    tt: 'No ads. No purchases. No signup. Just a card game.\nLink in bio.\n\n#freegame #indiegame #cardgame #nopaywall',
    x:  'No ads. No purchases. No signup. No real money. Just baccarat.\n\nbaccaratgladiator.com',
  },
  '22-3d-table-devlog.mp4': {
    title: 'Building a 3D Baccarat Table in Three.js 💻',
    yt_title: 'I Built a 3D Baccarat Table in Three.js (Devlog) 💻 #shorts',
    yt: 'Built a 3D baccarat table in Three.js. Solo dev, 6 weeks. Devlog inside.\n\nbaccaratgladiator.com\n\n#shorts #threejs #gamedev #devlog #indiedev #buildinpublic #webgame #javascript',
    ig: 'Built a 3D baccarat table in Three.js 💻\nSolo dev, 6 weeks.\n\nLink in bio → baccaratgladiator.com\n\n#threejs #gamedev #devlog #indiedev #buildinpublic #webgame #javascript @gamedevwizards @madebydevs',
    tt: 'Built a 3D card-game table from scratch. Three.js, solo dev, 6 weeks.\nLink in bio.\n\n#threejs #gamedev #devlog #indiedev #webgame #javascript',
    x:  'Built a 3D baccarat table in @threejs_org. Solo, 6 weeks. Devlog inside.\n\nbaccaratgladiator.com',
  },
  '23-worst-beat-ever.mp4': {
    title: 'Worst Beat Ever — But It\'s Free 😩',
    yt_title: 'Worst Baccarat Beat Ever (But It\'s Free) 😩 #shorts',
    yt: 'Worst beat ever — but it\'s free, run it back. The whole point of social baccarat: variance is real, but stakes aren\'t.\n\nbaccaratgladiator.com\n\n#shorts #baccarat #variance #cardgame #indiegame #freegame',
    ig: 'Worst beat ever — but it\'s free, run it back 😩\n\nLink in bio → baccaratgladiator.com\n\n#baccarat #variance #cardgame #indiegame #freegame @indiegamefactory @indiegamelover',
    tt: 'Worst card-game beat ever 😩 But it\'s free — run it back.\nLink in bio.\n\n#cardgame #variance #freegame #relatable',
    x:  'Worst beat ever — but it\'s free, run it back. Social baccarat at its finest.\n\nbaccaratgladiator.com',
  },
};

function makeStageCaption(num, name, tag, region, tier, cluster) {
  const tierBadge = `Tier ${tier}`;
  const tagWithTier = `${tag} · ${tierBadge}`;
  return {
    title: `Stage ${num}: ${name} ${region}`,
    yt_title: `Stage ${num}: ${name} ${region} #shorts`,
    yt: `${region} Stage ${num}: ${name} · ${tag}\nOne of 60+ themed baccarat venues. Free play, no real money.\n\nbaccaratgladiator.com\n\n#shorts #baccarat #stage${num} #${cluster.replace(/[^a-z]/g,'')} #indiegame #cardgame #arcade`,
    ig: `${region} Stage ${num}: ${name}\n${tag}\n\nOne of 60+ themed baccarat venues. Free play, no real money.\n\nLink in bio → baccaratgladiator.com\n\n#baccarat #stage${num} #${cluster.replace(/[^a-z]/g,'')} #indiegame #cardgame #arcade @indiegamefactory @indiegamelover`,
    tt: `${region} ${name} — ${tag}\nOne of 60+ levels. Free, browser-based.\nLink in bio.\n\n#indiegame #cardgame #${cluster.replace(/[^a-z]/g,'')} #devlog`,
    x:  `${region} Stage ${num}: ${name} — ${tag}\nOne of 60+ themed venues in Baccarat Gladiator.\n\nbaccaratgladiator.com`,
  };
}

// ────────────────────────────────────────────────────────────
// Build manifest.json
// ────────────────────────────────────────────────────────────
const manifest = { url: URL, channel: CHANNEL_HANDLE, ig: OG_HANDLE, generated_at: new Date().toISOString(), videos: [] };

const start = nextMonday();
for (let i = 0; i < POST_ORDER.length; i++) {
  const { file, cluster } = POST_ORDER[i];
  const meta = META[file];
  if (!meta) {
    console.warn(`No metadata for ${file} — skipping`);
    continue;
  }
  const filePath = path.join(SHORTS_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.warn(`Missing file ${file} — skipping`);
    continue;
  }
  const stat = fs.statSync(filePath);
  const scheduled = new Date(start);
  scheduled.setDate(scheduled.getDate() + i);

  manifest.videos.push({
    day: i + 1,
    file,
    file_path: path.relative(ROOT, filePath),
    file_size_mb: +(stat.size / 1024 / 1024).toFixed(2),
    cluster,
    scheduled_date: scheduled.toISOString().slice(0, 10),
    scheduled_time: '15:00 ET / 19:00 UTC',
    title: meta.title,
    yt: { title: meta.yt_title, description: meta.yt + '\n\nMade for kids: NO\nCategory: Gaming\nLanguage: English' },
    ig: { caption: meta.ig },
    tt: { caption: meta.tt },
    x:  { caption: meta.x },
  });
}

fs.writeFileSync(path.join(SHORTS_DIR, 'manifest.json'),
  JSON.stringify(manifest, null, 2));
console.log(`✓ shorts/manifest.json (${manifest.videos.length} videos)`);

// ────────────────────────────────────────────────────────────
// Build captions.md (paste-ready)
// ────────────────────────────────────────────────────────────
let md = `# Baccarat Gladiator — 25-Day Caption Pack\n\n`;
md += `Site: ${URL}\nChannel: ${CHANNEL_HANDLE}\nIG: @${OG_HANDLE}\n\n`;
md += `Schedule: starting ${fmtShort(start)}, posting at 3 PM ET / 7 PM UTC.\n\n---\n\n`;

for (const v of manifest.videos) {
  md += `## Day ${v.day} — ${fmtShort(new Date(v.scheduled_date))} (cluster: ${v.cluster})\n`;
  md += `**File:** \`${v.file}\` (${v.file_size_mb} MB)\n`;
  md += `**Title:** ${v.title}\n\n`;

  md += `### YouTube Shorts\n\`\`\`title\n${v.yt.title}\n\`\`\`\n\`\`\`description\n${v.yt.description}\n\`\`\`\n\n`;
  md += `### Instagram Reels\n\`\`\`\n${v.ig.caption}\n\`\`\`\n\n`;
  md += `### TikTok (only after appeal lands)\n\`\`\`\n${v.tt.caption}\n\`\`\`\n\n`;
  md += `### X / Twitter\n\`\`\`\n${v.x.caption}\n\`\`\`\n\n---\n\n`;
}

fs.writeFileSync(path.join(SHORTS_DIR, 'captions.md'), md);
console.log(`✓ shorts/captions.md`);

// ────────────────────────────────────────────────────────────
// Build buffer-import.csv (Buffer / Hootsuite / Later compatible)
// ────────────────────────────────────────────────────────────
// CSV columns: scheduled_at,profile,text,media_url
// Buffer accepts CSV uploads at https://buffer.com/app/post-uploader
let csv = 'scheduled_at,profile,text,media_url\n';
for (const v of manifest.videos) {
  const dt = `${v.scheduled_date} 15:00:00`;
  const mediaUrl = `${URL}/shorts/${v.file}`;  // assumes you'll upload shorts/ to S3 mirror
  for (const [profile, caption] of [
    ['instagram', v.ig.caption],
    ['x',        v.x.caption],
  ]) {
    const cleanCaption = caption.replace(/"/g, '""').replace(/\n/g, '\\n');
    csv += `"${dt}","${profile}","${cleanCaption}","${mediaUrl}"\n`;
  }
}
fs.writeFileSync(path.join(SHORTS_DIR, 'buffer-import.csv'), csv);
console.log(`✓ shorts/buffer-import.csv`);

// ────────────────────────────────────────────────────────────
// Build posting-checklist.md
// ────────────────────────────────────────────────────────────
let cl = `# Baccarat Gladiator — 25-Day Posting Checklist\n\n`;
cl += `Tick each box as you post. Aim for **3 PM ET / 7 PM UTC** for YouTube algorithm priming.\n\n`;
cl += `| Day | Date | Cluster | File | YouTube | Instagram | X |\n`;
cl += `|---|---|---|---|---|---|---|\n`;
for (const v of manifest.videos) {
  cl += `| ${v.day} | ${fmtShort(new Date(v.scheduled_date))} | ${v.cluster} | \`${v.file}\` | ☐ | ☐ | ☐ |\n`;
}
cl += `\n## Daily routine (5 min per day)\n\n`;
cl += `1. Open \`captions.md\` → find today's day\n`;
cl += `2. Upload .mp4 to YouTube Shorts → paste title + description → publish (Public)\n`;
cl += `3. AirDrop .mp4 to phone → IG Reels → paste caption → publish\n`;
cl += `4. (Once TikTok appeal clears) → repost with TT-safe caption\n`;
cl += `5. X / Twitter → upload .mp4 → paste tweet caption\n`;
cl += `6. Tick the boxes above\n\n`;
cl += `## Pinned comment template (paste on every YouTube + IG post)\n\n`;
cl += `\`\`\`\n🎰 Free at baccaratgladiator.com (link in bio) · 60+ stages, no real money\n\`\`\`\n`;

fs.writeFileSync(path.join(SHORTS_DIR, 'posting-checklist.md'), cl);
console.log(`✓ shorts/posting-checklist.md`);

console.log('\n──────────────────────────────────────────────');
console.log('Content kit ready in shorts/:');
console.log('  • manifest.json       (machine-readable)');
console.log('  • captions.md         (paste-ready per video)');
console.log('  • buffer-import.csv   (for Buffer / Later / Hootsuite)');
console.log('  • posting-checklist.md (printable 25-day calendar)');
console.log('──────────────────────────────────────────────');
