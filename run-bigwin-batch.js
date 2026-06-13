// Run auto-play across all variants in parallel batches of 6.
// Total estimated runtime: ~50 min for 60 variants.
const { playOne } = require('./auto-play');

const SLUGS = [
  // T1
  'nine','cat-cafe','canine-club','labubu','huff-puff','toy-story','bricks',
  // T2
  'hipster','portlandia','mockingbird','breaking','cali-surfer','marrakech',
  // T3
  'kenya','batumi','cyprus','jiufen-tea','mexico','uruguay','ktown',
  // T4
  'disco','coachella','techno-rave','muay-thai','wing-chun','canada-f1',
  // T5
  'spain','neo-tokyo-anime','texas','silicon-valley','cycling','pga',
  // T6
  'baseball','ufc','boxing','melbourne','manila','seoul','skydiving',
  // T7
  'nyc','miami','hawaii','mad-max','fast-furious','cyberpunk',
  // T8
  'jet','cruise','orbit','gta','vegas-hangover','oceans-11','bond',
  // T9
  'mc','lv','ac','bahamas','sg','pnw','london',
  // T10 — Final Arena
  'gladiator','ktv-karaoke','prohibition-jazz',
];

const BATCH_SIZE = parseInt(process.argv[2] || '6', 10);
const ONLY = process.argv[3];                    // optional comma-separated subset

const slugs = ONLY ? ONLY.split(',') : SLUGS;

(async () => {
  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < slugs.length; i += BATCH_SIZE) {
    const batch = slugs.slice(i, i + BATCH_SIZE);
    console.log(`── Batch ${Math.floor(i/BATCH_SIZE)+1}: ${batch.join(', ')}`);
    await Promise.all(batch.map(s => playOne(s).catch(e => {
      console.log(`FAIL ${s.padEnd(22)} crashed: ${e.message}`);
      return false;
    })));
    done += batch.length;
    const elapsed = (Date.now() - t0) / 1000;
    const rate = done / elapsed;
    const eta = (slugs.length - done) / Math.max(rate, 0.01);
    console.log(`── progress ${done}/${slugs.length} · ${elapsed.toFixed(0)}s elapsed · ETA ${(eta/60).toFixed(1)}min`);
  }
  const total = (Date.now() - t0) / 60000;
  console.log(`Done in ${total.toFixed(1)} min`);
})();
