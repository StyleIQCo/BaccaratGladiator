// Per-hand 20-second buckets on the road-to-macau (EZ Baccarat) table.
// Architecture: open headed Chrome (real WebGL → real Three.js scene),
// drive auto-bets ($200 Banker + $25 Dragon 7 + $25 Panda 8 every hand),
// and start a fresh frame-capture bucket at the moment each bet is
// placed. Each bucket runs for up to 20s — that comfortably covers
// "NO MORE BETS" through deal, reveal, resolve, payout, and the dealer
// `warm_congrats.mp4` reaction on a hit.
//
// After every hand we inspect state.stats.bdragon (Dragon 7) and
// state.stats.pdragon (Panda 8). If either fired during this bucket
// we keep the bucket as the final mp4 and stop. Otherwise the bucket
// frames are deleted and we capture again at the next bet.
//
// Why per-hand: makes it trivial to verify the saved clip is the actual
// winning hand, bounds disk to one bucket at a time, and the encoded
// 20s mp4 is exactly one complete EZ hand for the YouTube Short.
//
// Output: /tmp/baccarat-gladiator-macau-dragon-short.mp4

const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

// ── Tunables ────────────────────────────────────────────────────────
const VW = 540,  VH = 960;             // mobile viewport (game's mobile CSS triggers)
const W  = 1080, H  = 1920;            // final encoded resolution
const FPS = 30;                        // encoded frame rate
const BUCKET_MS       = 20_000;        // 20s per-hand bucket
const HAND_TIMEOUT_MS = 18_000;        // worst-case wait for hand to resolve
const POST_WIN_MS     = 8_000;         // extra capture after a hit lands (catches dealer congrats)
// Three target events sized for a real shoe:
//   Dragon 7   ≈ 2.27% / hand
//   Panda 8    ≈ 1.82% / hand
//   Korean BBQ ≈ 3.00% / hand
// All three together = ~95th-percentile around 200 hands. 500-hand cap
// gives ~5x headroom; 60-min wall ceiling matches at ~5–8s per hand.
const MAX_HANDS       = 500;
const MAX_WALL_MIN    = 60;
const FRAMES_DIR      = '/tmp/macau-dragon-frames';
const OUTPUT_DRAGON7  = '/tmp/baccarat-gladiator-macau-dragon7-short.mp4';
const OUTPUT_PANDA8   = '/tmp/baccarat-gladiator-macau-panda8-short.mp4';
const OUTPUT_KBBQ     = '/tmp/baccarat-gladiator-macau-koreanbbq-short.mp4';
const PROJECT = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator';

// ── Static server ──────────────────────────────────────────────────
function startStaticServer(rootDir){
  const types = {
    '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
    '.css':'text/css',   '.json':'application/json',
    '.png':'image/png',  '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
    '.svg':'image/svg+xml', '.mp4':'video/mp4', '.webm':'video/webm',
    '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf',
  };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if(p === '/' || p.endsWith('/')) p += 'index.html';
    const fp = path.join(rootDir, p);
    if(!fp.startsWith(rootDir)){ res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (err, data) => {
      if(err){ res.writeHead(404); res.end(); return; }
      const ct = types[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const { server, port } = await startStaticServer(PROJECT);
  console.log(`Static server on http://127.0.0.1:${port}`);

  // Headed Chrome — required for real WebGL on macOS. Headless even
  // with --use-gl=swiftshader fails to create the WebGL context, which
  // collapses dealController to a no-op and skips the EZ side-bet math.
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: VW, height: VH, deviceScaleFactor: 2,
                       isMobile: true, hasTouch: true },
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-features=IsolateOrigins,site-per-process',
      '--hide-scrollbars',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required',
      `--window-size=${VW},${VH}`,
      '--window-position=0,0',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2,
                           isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 180)));
  page.on('console', e => {
    if(e.type() === 'error') console.log('CON-ERR:', e.text().slice(0, 200));
  });

  await page.goto(`http://127.0.0.1:${port}/road-to-macau.html`,
                  { waitUntil: 'networkidle2', timeout: 30_000 });
  // Dismiss first-time tip
  await page.evaluate(() => {
    const tip = document.getElementById('first-tip');
    if(tip) tip.style.display = 'none';
  });
  await new Promise(r => setTimeout(r, 800));

  // Realistic ad bankroll. Auto top-up below catches a rare cold streak.
  await page.evaluate(() => { window.__macauState.balance = 8_000; });

  // Flip the on-screen audio toggle to 🔊 so the recorded UI doesn't
  // show a muted icon. The page starts muted because browsers block
  // autoplay; clicking #btn-sound (or firing unmuteDealer) flips the
  // icon and the `on` class. The dealer video itself stays muted in
  // headed Chrome's recording — actual dealer audio is overlaid via
  // ffmpeg in the encode step — but the UI now reads "audio on".
  await page.evaluate(() => {
    const btn = document.getElementById('btn-sound');
    if (btn) btn.click();
  });

  console.log('EZ Baccarat per-hand recorder.');
  console.log('  Targets: Dragon 7 (40:1) · Panda 8 (25:1) · Korean BBQ (7-vs-6).');
  console.log(`  Stops once all three captured, or ${MAX_HANDS} hands / ${MAX_WALL_MIN} min.`);

  const startWall = Date.now();
  let handsPlayed = 0;
  // Track each event independently:
  //   dragon7   — Banker 3-card 7 = 40:1
  //   panda8    — Player 3-card 8 = 25:1
  //   koreanbbq — one side hits 7 vs the other's 6 (funny, sticky banner)
  // Each bucket that triggers an event gets encoded to its own mp4.
  // The session continues until all three have been captured or the
  // safety cap fires.
  const captured = { dragon7: null, panda8: null, koreanbbq: null };

  // ── Per-hand recording loop ──────────────────────────────────────
  while(true){
    if((Date.now() - startWall) / 60_000 > MAX_WALL_MIN){
      console.log(`\n  Hit wall-clock cap (${MAX_WALL_MIN} min). Aborting.`);
      break;
    }
    if(handsPlayed >= MAX_HANDS){
      console.log(`\n  Hit ${MAX_HANDS}-hand cap. Aborting.`);
      break;
    }

    // ── Wait for betting phase + place bets ────────────────────────
    await page.waitForFunction(() =>
      window.__macauState && window.__macauState.phase === 'betting',
      { timeout: 30_000 }
    ).catch(() => {});

    const beforeStats = await page.evaluate(() => ({
      bdragon: window.__macauState.stats.bdragon || 0,    // Dragon 7
      pdragon: window.__macauState.stats.pdragon || 0,    // Panda 8
    }));

    await page.evaluate(() => {
      const STAKE_MAIN = 200;     // Banker
      const STAKE_BD   = 25;      // Dragon 7 (Banker 3-card 7)
      const STAKE_PD   = 25;      // Panda 8  (Player 3-card 8)
      // Top up if a cold streak burned through the bankroll.
      if(window.__macauState.balance < STAKE_MAIN + STAKE_BD + STAKE_PD){
        window.__macauState.balance = 8_000;
      }
      window.__macauState.bets = {
        player: 0, banker: STAKE_MAIN, tie: 0,
        bdragon: STAKE_BD, pdragon: STAKE_PD,
        pair_p: 0, pair_b: 0,
      };
      window.__macauState.balance -= (STAKE_MAIN + STAKE_BD + STAKE_PD);
      try { window.__macauSync(); } catch(e){}
    });

    // ── Begin per-hand bucket capture ──────────────────────────────
    const handIdx = handsPlayed;
    const bucketDir = path.join(FRAMES_DIR, `h${String(handIdx).padStart(4,'0')}`);
    fs.rmSync(bucketDir, { recursive: true, force: true });
    fs.mkdirSync(bucketDir, { recursive: true });

    const bucketStart = Date.now();
    const stamps = [];
    let frameI = 0;
    // Offset (ms from bucket start) at which the dealer's warm_congrats
    // video first becomes active. The encoder later overlays the
    // matching audio file at this exact offset so the final mp4 carries
    // the dealer's charming voice on the win moment without needing
    // system-audio capture (the in-page <video> tag is muted, so even
    // BlackHole wouldn't catch it).
    let dealerCongratsAt = null;

    // Trigger the deal — playHand() runs as Promise inside the page
    await page.evaluate(() => {
      const btn = document.getElementById('btn-deal');
      if(btn){ btn.disabled = false; btn.click(); }
    });

    // Concurrent: capture frames at native rate; auto-tap FLIP ALL
    // during squeeze so we don't burn 18s on the failsafe; track when
    // the hand ends so we stop early if it resolves before 20s. Also
    // watch for the Korean BBQ banner so we can mark this bucket if
    // it fires (banner is the #korean-bbq element with class "go").
    let handEnded = false;
    let flipped = false;
    let kbbqSeen = false;
    while(Date.now() - bucketStart < BUCKET_MS){
      const t = Date.now() - bucketStart;
      // Capture
      const fp = path.join(bucketDir, `f${String(frameI).padStart(5,'0')}.jpg`);
      try {
        await page.screenshot({ path: fp, type: 'jpeg', quality: 90, optimizeForSpeed: true });
        stamps.push(t); frameI++;
      } catch(e){ /* tolerate stalls */ }

      // Watch for the dealer's warm_congrats video taking over so we
      // know the offset at which to overlay her audio in post.
      if(dealerCongratsAt === null){
        const isCongrats = await page.evaluate(() => {
          const v = document.getElementById('dealer-vid');
          if(!v) return false;
          const src = v.currentSrc || (v.querySelector('source[type="video/mp4"]') || {}).src || '';
          return src.includes('warm_congrats');
        });
        if(isCongrats) dealerCongratsAt = t;
      }

      // Watch for the Korean BBQ banner (only fires on 7-vs-6 hands).
      if(!kbbqSeen){
        const isKbbq = await page.evaluate(() => {
          const el = document.getElementById('korean-bbq');
          return !!(el && el.classList.contains('go'));
        });
        if(isKbbq) kbbqSeen = true;
      }

      // FLIP ALL during squeeze so the recording stays inside the bucket
      if(!flipped){
        const did = await page.evaluate(() => {
          const ph = window.__macauState && window.__macauState.phase;
          if(ph === 'squeeze'){
            const fa = document.getElementById('btn-flip-all');
            if(fa && fa.classList.contains('show')){ fa.click(); return true; }
          }
          return false;
        });
        if(did) flipped = true;
      }

      // Detect hand end
      if(!handEnded){
        const phase = await page.evaluate(() =>
          window.__macauState && window.__macauState.phase);
        if(phase === 'betting' && Date.now() - bucketStart > 1200){
          handEnded = true;
        }
      }
      // If hand ended, run a short tail (POST_WIN_MS) to capture the
      // dealer congrats animation, then break out.
      if(handEnded && Date.now() - bucketStart > BUCKET_MS - POST_WIN_MS){
        // already past the post-win window — stop
        break;
      }
    }
    handsPlayed++;

    // ── Which events fired this hand? ──────────────────────────────
    const afterStats = await page.evaluate(() => ({
      bdragon: window.__macauState.stats.bdragon || 0,    // Dragon 7
      pdragon: window.__macauState.stats.pdragon || 0,    // Panda 8
    }));
    const hitDragon7 = afterStats.bdragon > beforeStats.bdragon;
    const hitPanda8  = afterStats.pdragon > beforeStats.pdragon;
    const hitKbbq    = kbbqSeen;
    // RE-RECORD MODE: the user re-asked for a clean Dragon 7 capture
    // (the previous one had the old permissive KBBQ banner firing on
    // the same hand). With isKoreanBBQ now requiring a 2-card stand-off
    // and Dragon 7 by definition having 3 cards on banker, a fresh
    // Dragon 7 capture cannot compound with KBBQ — but we also filter
    // out Panda 8 / KBBQ keeps in this run so it stops the moment the
    // Dragon 7 lands. Re-enable the other keeps by deleting these
    // single-event guards.
    const keepFor = [];
    if(hitDragon7 && !captured.dragon7)    keepFor.push('dragon7');
    // Dragon 7-only re-record run (post-emoji-swap). Re-enable the
    // other slots by removing these single-event guards.
    // if(hitPanda8  && !captured.panda8)     keepFor.push('panda8');
    // if(hitKbbq    && !captured.koreanbbq)  keepFor.push('koreanbbq');

    const elapsedMin = ((Date.now() - startWall) / 60_000).toFixed(2);
    let label = 'no event';
    const tags = [];
    if(hitDragon7) tags.push('D7');
    if(hitPanda8)  tags.push('P8');
    if(hitKbbq)    tags.push('KBBQ');
    if(tags.length) label = tags.join(' + ') + (keepFor.length ? ' ✓ KEEP' : ' (already captured)');
    process.stdout.write(`\r  ${elapsedMin}min · hand ${handsPlayed} · `
      + `${frameI} frames · ${label}     `);

    if(keepFor.length > 0){
      console.log('');
      // If we ended the bucket early, capture a few more seconds for the dealer reaction
      if(Date.now() - bucketStart < BUCKET_MS){
        const tailEnd = bucketStart + BUCKET_MS;
        while(Date.now() < tailEnd){
          const t = Date.now() - bucketStart;
          const fp = path.join(bucketDir, `f${String(frameI).padStart(5,'0')}.jpg`);
          try {
            await page.screenshot({ path: fp, type: 'jpeg', quality: 90, optimizeForSpeed: true });
            stamps.push(t); frameI++;
          } catch(e){}
        }
      }
      // Record this bucket against every event slot it fills. Same
      // bucket dir + stamps + dealer offset for each — cheap to share
      // since the encoder pulls from the same JPEGs.
      const payload = { dir: bucketDir, stamps: stamps.slice(), count: frameI,
                        dealerCongratsAt };
      for(const ev of keepFor) captured[ev] = payload;
      // Single-event re-record: stop once Dragon 7 lands.
      if(captured.dragon7) break;
      // Don't delete this bucket — it's still owned by `captured`.
      // Just move on; the encoder reads from disk at the end.
      continue;
    }

    // No relevant event — discard this bucket and continue
    fs.rmSync(bucketDir, { recursive: true, force: true });
  }

  await browser.close();
  server.close();

  if(!captured.dragon7 && !captured.panda8 && !captured.koreanbbq){
    console.log('No event captured. Nothing to encode.');
    process.exit(1);
  }

  // ── Encode each captured event into its own mp4 ────────────────
  // Same encoder logic for every event: variable-duration concat from
  // the bucket's frames → fixed 30fps H.264, then optional dealer-audio
  // overlay if the warm_congrats video was active during the bucket.
  const dealerAudio = path.join(PROJECT, 'dealer', 'warm_congrats.mp4');

  function encodeBucket(bucket, outputMp4, label){
    const { dir, stamps, count, dealerCongratsAt } = bucket;
    console.log(`\n[${label}] encoding ${count} frames`
      + (dealerCongratsAt != null
          ? ` (dealer audio overlay at ${(dealerCongratsAt/1000).toFixed(2)}s)`
          : ' (silent — no dealer audio detected)') + '...');

    const totalShowMs = stamps[stamps.length - 1];
    const concatPath = path.join(dir, `frames-${label}.txt`);
    let concat = '';
    for(let f = 0; f < count; f++){
      const dur = (f < count - 1)
        ? Math.max(0.001, (stamps[f+1] - stamps[f]) / 1000)
        : 0.066;
      concat += `file '${path.join(dir, `f${String(f).padStart(5,'0')}.jpg`)}'\n`;
      concat += `duration ${dur.toFixed(4)}\n`;
    }
    concat += `file '${path.join(dir, `f${String(count-1).padStart(5,'0')}.jpg`)}'\n`;
    fs.writeFileSync(concatPath, concat);

    // Stage 1: silent video
    const silentMp4 = path.join(dir, `silent-${label}.mp4`);
    const ff1 = spawnSync('ffmpeg', [
      '-y',
      '-f','concat','-safe','0',
      '-i', concatPath,
      '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos`,
      '-fps_mode','cfr',
      '-c:v','libx264',
      '-profile:v','high',
      '-preset','medium',
      '-crf','20',
      '-pix_fmt','yuv420p',
      '-movflags','+faststart',
      silentMp4,
    ], { stdio:'inherit' });
    if(ff1.status !== 0){
      console.log(`[${label}] silent encode failed (exit ${ff1.status})`);
      return false;
    }

    // Stage 2: overlay the dealer's warm_congrats AAC at the recorded
    // offset (pristine source audio — equivalent to a BlackHole capture
    // since the page's <video id="dealer-vid"> is muted anyway).
    if(dealerCongratsAt != null && fs.existsSync(dealerAudio)){
      const offsetMs = Math.max(0, Math.round(dealerCongratsAt));
      const ff2 = spawnSync('ffmpeg', [
        '-y',
        '-i', silentMp4,
        '-i', dealerAudio,
        '-filter_complex',
          `[1:a]adelay=${offsetMs}|${offsetMs},apad,volume=1.4[da];`
        + `[da]aresample=async=1[a]`,
        '-map','0:v',
        '-map','[a]',
        '-c:v','copy',
        '-c:a','aac',
        '-b:a','160k',
        '-shortest',
        '-movflags','+faststart',
        outputMp4,
      ], { stdio:'inherit' });
      if(ff2.status !== 0){
        console.log(`[${label}] audio overlay failed — falling back to silent.`);
        fs.copyFileSync(silentMp4, outputMp4);
      }
    } else {
      fs.copyFileSync(silentMp4, outputMp4);
    }

    const stat = fs.statSync(outputMp4);
    const audioFlag = (dealerCongratsAt != null) ? 'AAC dealer overlay' : 'silent';
    console.log(`[${label}] OK ${outputMp4}`);
    console.log(`        ${(stat.size/1024/1024).toFixed(2)} MB · ${W}×${H} `
              + `· ~${(totalShowMs/1000).toFixed(1)}s · ${FPS}fps · H.264 · ${audioFlag}`);
    return true;
  }

  if(captured.dragon7)   encodeBucket(captured.dragon7,   OUTPUT_DRAGON7, 'DRAGON 7');
  if(captured.panda8)    encodeBucket(captured.panda8,    OUTPUT_PANDA8,  'PANDA 8');
  if(captured.koreanbbq) encodeBucket(captured.koreanbbq, OUTPUT_KBBQ,    'KOREAN BBQ');

  console.log('\n── Session summary ──');
  console.log(`  Dragon 7:   ${captured.dragon7   ? OUTPUT_DRAGON7 : '(not captured)'}`);
  console.log(`  Panda 8:    ${captured.panda8    ? OUTPUT_PANDA8  : '(not captured)'}`);
  console.log(`  Korean BBQ: ${captured.koreanbbq ? OUTPUT_KBBQ    : '(not captured)'}`);

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
})();
