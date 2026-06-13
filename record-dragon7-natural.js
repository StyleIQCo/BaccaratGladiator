// Capture a real Dragon-7 win from a road-to-nine (Macau) shoe and
// produce a YouTube-Shorts-ready 1080×1920 MP4 with an outro CTA.
//
// Method:
//   1. Open baccarat-game.html?director=1, dismiss splash + guest gate.
//   2. Force the Macau venue (the in-game "road-to-nine" arena), EZ mode
//      so the Dragon 7 / Panda 8 side bets are live.
//   3. Place a real banker + dragon7 bet exactly like a player would.
//   4. Pure-math fast-forward through the live shoe (≤60 hands) to find
//      the next natural Dragon 7. Trim the shoe so the very next deal
//      produces that exact hand.
//   5. Visually deal the hand at full speed: cards drop, flip, third
//      card pulls, reveal, totals tick — then the legendary Dragon 7
//      celebration fires.
//   6. Inject a glassmorphic outro card (CTA + QR + URL) over the game
//      UI for the final 5s so the Short ends on a clear call to action.
//   7. Record real-time with timestamp-tracked screenshots; ffmpeg's
//      concat demuxer holds each frame for its actual capture interval
//      so the encoded video plays in real time at 30fps.
//
// Output: /tmp/baccarat-gladiator-dragon7-natural.mp4

const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const W = 1080, H = 1920, FPS = 30;
const VW = 540, VH = 960;       // mobile viewport — game's CSS triggers
                                // its single-column layout below 600px wide.
const PROJECT = '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator';
const FRAMES_DIR = '/tmp/dragon7-natural-frames';
const OUTPUT_MP4 = '/tmp/baccarat-gladiator-dragon7-natural.mp4';
const CAPTURE_S  = 22;          // hard cap on capture window

(async () => {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
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
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2,
                           isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0,160)));
  page.on('console', e => {
    if(e.type() === 'error') console.log('CON-ERR:', e.text().slice(0, 200));
  });

  const url = 'file://' + path.resolve(PROJECT, 'baccarat-game.html')
            + '?director=1';
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // ── 1. Splash + guest-trial gate ─────────────────────────────────
  await page.evaluate(() => { if(window.enterArena) window.enterArena(); });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => {
    if(typeof startGuestTrial === 'function') startGuestTrial();
  });
  await new Promise(r => setTimeout(r, 1300));

  // ── 2. Force Macau (the road-to-nine arena) ──────────────────────
  await page.evaluate(() => {
    // Bypass the title-rank gate — we're recording, the player is "Emperor".
    if(typeof playerTitle !== 'undefined') playerTitle = 'Emperor';
    if(typeof playerXp    !== 'undefined') playerXp    = 99999;
    currentVenue = 'macau';
    // applyVenueTheme can throw deep inside the audio chain when no
    // user gesture has touched the page — the visual theme still
    // applies via data-venue, so swallow audio errors and force
    // the body attribute manually.
    try { applyVenueTheme(); } catch(e) {}
    document.body.setAttribute('data-venue', 'macau');
    if(typeof refreshUI === 'function') { try { refreshUI(); } catch(e) {} }
  });

  // ── 3. EZ mode — Dragon 7 side bet live ──────────────────────────
  await page.evaluate(() => { if(typeof setMode === 'function') setMode('ez'); });
  await new Promise(r => setTimeout(r, 400));

  // ── 4. Hide the dev "Director's Cut" panel for the recording ─────
  await page.addStyleTag({ content: '#dc-panel{display:none !important;}' });

  // ── 5. Find a natural Dragon 7 within ≤60 hands of the live shoe ─
  const ffResult = await page.evaluate(() => {
    if(typeof shoe === 'undefined' || !Array.isArray(shoe)) return { ok:false };
    if(typeof simHand !== 'function' && typeof bankerDraws !== 'function') {
      return { ok:false, reason:'no math fns' };
    }
    // Inline simulate (mirrors deal()'s math exactly) against a copy
    function sim(testShoe){
      if(testShoe.length < 6) return null;
      const draw = () => testShoe.pop();
      const pH = [draw(), draw()];
      const bH = [draw(), draw()];
      let pT = total(pH), bT = total(bH);
      const natural = pT >= 8 || bT >= 8;
      let pThird = null, bThird = null;
      if(!natural){
        if(pT <= 5){ pThird = draw(); pH.push(pThird); pT = total(pH); }
        if(bankerDraws(bT, pThird)){
          bThird = draw(); bH.push(bThird); bT = total(bH);
        }
      }
      let winner;
      if(pT === bT) winner = 'T'; else if(bT > pT) winner = 'B'; else winner = 'P';
      return {
        winner, pT, bT, pLen: pH.length, bLen: bH.length,
        isDragon7: winner === 'B' && bH.length === 3 && bT === 7,
      };
    }

    // Try multiple shoes until a Dragon 7 falls within 60 hands.
    for(let attempt = 0; attempt < 8; attempt++){
      const testShoe = shoe.slice();
      const startLen = testShoe.length;
      let consumed = 0;
      let found = false;
      let handsExamined = 0;
      while(handsExamined < 60){
        const before = testShoe.length;
        const r = sim(testShoe);
        if(!r) break;
        handsExamined++;
        if(r.isDragon7){
          consumed = startLen - before;
          found = true;
          break;
        }
      }
      if(found){
        // Trim the live shoe so the next deal() produces the Dragon 7
        if(consumed > 0) shoe.splice(shoe.length - consumed, consumed);
        cardsDealtThisShoe += consumed;
        return { ok:true, attempt, handsExamined, consumed };
      }
      // No D7 in this shoe — force a reshuffle and retry
      if(typeof buildShoe === 'function'){
        try { buildShoe(); cardsDealtThisShoe = 0; } catch(e) {}
      } else { break; }
    }
    return { ok:false, reason:'no dragon 7 in 8 shoes' };
  });
  console.log('Dragon 7 search:', JSON.stringify(ffResult));
  if(!ffResult.ok){
    console.log('Could not find Dragon 7 — aborting');
    await browser.close(); process.exit(1);
  }

  // ── 6. Place real bets (banker + dragon7) — looks like a player ──
  await page.evaluate(() => {
    bets.banker  = 25;
    bets.dragon7 = 25;
    window.__directorCut = true;   // bypass speed-mode guards
    if(typeof refreshUI === 'function') refreshUI();
  });
  await new Promise(r => setTimeout(r, 600));

  // ── 7. Inject outro slate so it's ready to fade in over the UI ───
  await page.evaluate(() => {
    const o = document.createElement('div');
    o.id = 'natural-outro';
    o.innerHTML = `
      <style>
        #natural-outro {
          position:fixed; left:0; right:0; bottom:0; top:0;
          z-index:9800;
          display:flex; align-items:center; justify-content:center;
          background:radial-gradient(ellipse at 50% 35%,
            rgba(40,16,80,0.88) 0%,
            rgba(8,0,20,0.95) 60%,
            rgba(0,0,0,1) 100%);
          opacity:0;
          transition:opacity 700ms cubic-bezier(0.18, 0.95, 0.30, 1);
          pointer-events:none;
        }
        #natural-outro.on { opacity:1; }
        #natural-outro .no-card {
          width:88vw; max-width:480px;
          padding:32px 28px 26px;
          border-radius:22px;
          background:linear-gradient(180deg, rgba(20,10,30,0.55), rgba(8,4,16,0.85));
          backdrop-filter:blur(18px) saturate(140%);
          -webkit-backdrop-filter:blur(18px) saturate(140%);
          border:1.5px solid rgba(212,175,55,0.55);
          box-shadow:
            0 24px 60px rgba(0,0,0,0.85),
            0 0 80px rgba(212,175,55,0.30),
            inset 0 1px 0 rgba(255,255,255,0.12);
          text-align:center;
        }
        #natural-outro .no-tag {
          font-family:'Press Start 2P', monospace;
          font-size:13px; letter-spacing:0.42em; color:#9affe7;
          text-shadow:0 0 10px rgba(74,223,211,0.55);
          margin-bottom:14px;
        }
        #natural-outro .no-title {
          font-family:'Cinzel', serif; font-weight:900;
          font-size:54px; line-height:0.92; letter-spacing:0.10em;
          background:linear-gradient(90deg, #ffd76e 0%, #ff7a1a 50%, #ffd76e 100%);
          background-size:200% 100%;
          -webkit-background-clip:text; background-clip:text;
          -webkit-text-fill-color:transparent; color:transparent;
          filter:drop-shadow(0 4px 10px rgba(0,0,0,0.85));
          animation:no-shimmer 3.0s ease infinite;
          margin-bottom:14px;
        }
        @keyframes no-shimmer {
          0%,100% { background-position:0 50%; }
          50%     { background-position:200% 50%; }
        }
        #natural-outro .no-bullets {
          font-family:'Press Start 2P', monospace;
          font-size:11px; letter-spacing:0.18em; color:#ffe1a8;
          line-height:2.0; margin-bottom:18px;
        }
        #natural-outro .no-cta {
          font-family:'Press Start 2P', monospace; font-size:14px;
          letter-spacing:0.28em; color:#ffe7a0;
          padding:14px 28px; border-radius:10px;
          background:linear-gradient(180deg, #2a1a08, #15090a);
          border:2px solid #ffb000;
          text-shadow:0 0 12px rgba(255,200,80,0.7);
          box-shadow:0 8px 22px rgba(0,0,0,0.7),
                     0 0 24px rgba(255,176,0,0.4),
                     inset 0 0 16px rgba(255,200,80,0.12);
          display:inline-block;
          animation:no-pulse 1.4s ease infinite;
          margin-bottom:16px;
        }
        @keyframes no-pulse {
          0%,100% { box-shadow:0 8px 22px rgba(0,0,0,0.7), 0 0 24px rgba(255,176,0,0.4), inset 0 0 16px rgba(255,200,80,0.12); }
          50%     { box-shadow:0 8px 22px rgba(0,0,0,0.7), 0 0 48px rgba(255,176,0,0.8), inset 0 0 28px rgba(255,200,80,0.22); }
        }
        #natural-outro .no-qr-row {
          display:flex; gap:18px; justify-content:center; align-items:flex-start;
        }
        #natural-outro .no-qr {
          display:flex; flex-direction:column; align-items:center; gap:6px;
        }
        #natural-outro .no-qr img {
          width:120px; height:120px; padding:5px;
          background:#ffe7a0;
          border:2px solid rgba(212,175,55,0.7);
          border-radius:10px;
          box-shadow:0 6px 16px rgba(0,0,0,0.6);
        }
        #natural-outro .no-qr-cap {
          font-family:'Press Start 2P', monospace; font-size:9px;
          letter-spacing:1.5px; color:#ffd58a;
        }
        #natural-outro .no-qr-url {
          font-family:'Press Start 2P', monospace; font-size:8px;
          letter-spacing:1px; color:#9affe7;
        }
        #natural-outro .no-disc {
          margin-top:14px; padding-top:12px;
          border-top:1px solid rgba(212,175,55,0.18);
          font-family:'Press Start 2P', monospace; font-size:8px;
          letter-spacing:0.18em; color:rgba(255,224,160,0.55);
          line-height:1.6;
        }
      </style>
      <div class="no-card">
        <div class="no-tag">SIDE-BET LEGENDS</div>
        <div class="no-title">BACCARAT<br>GLADIATOR</div>
        <div class="no-bullets">
          DRAGON 7 · 40 TO 1<br>
          PANDA 8 · 25 TO 1<br>
          TIGER 6 · 50 TO 1
        </div>
        <div class="no-cta">PLAY FREE NOW</div>
        <div class="no-qr-row">
          <div class="no-qr">
            <img src="qr-game.png" alt="QR baccaratgladiator.com">
            <div class="no-qr-cap">PLAY THE GAME</div>
            <div class="no-qr-url">BACCARATGLADIATOR.COM</div>
          </div>
          <div class="no-qr">
            <img src="qr-book.png" alt="QR Road to Nine on Amazon">
            <div class="no-qr-cap">READ THE BOOK</div>
            <div class="no-qr-url">ROAD TO NINE · AMAZON</div>
          </div>
        </div>
        <div class="no-disc">ENTERTAINMENT ONLY · NO REAL MONEY · NO CASH PRIZES</div>
      </div>
    `;
    document.body.appendChild(o);
  });

  // ── 8. Deal! Recording starts NOW ────────────────────────────────
  console.log(`Recording up to ${CAPTURE_S}s of natural play + Dragon 7...`);
  const startWall = Date.now();

  // Trigger the deal — Director's Cut bypass keeps speed-mode reveals
  // active so the third card auto-flips and the celebration fires.
  await page.evaluate(() => {
    if(typeof deal === 'function') deal();
  });

  // Schedule the outro to fade in at ~16s — by then the celebration
  // (3.3s) has fully ended and the table sits in 'dealt' state.
  setTimeout(async () => {
    try { await page.evaluate(() => {
      document.getElementById('natural-outro').classList.add('on');
    }); } catch(e) {}
  }, 16000);

  // Capture loop
  const stamps = [];
  let i = 0;
  while(true){
    const t = Date.now() - startWall;
    if(t >= CAPTURE_S * 1000) break;
    await page.screenshot({
      path: path.join(FRAMES_DIR, `f${String(i).padStart(5,'0')}.jpg`),
      type: 'jpeg', quality: 90,
      optimizeForSpeed: true,
    });
    stamps.push(t);
    i++;
    if(i % 30 === 0){
      const elapsed = ((Date.now() - startWall) / 1000).toFixed(1);
      process.stdout.write(`\r  ${elapsed}s · ${i} frames`);
    }
  }
  const savedFrames = i;
  const totalWall = (Date.now() - startWall) / 1000;
  const totalShowMs = stamps[stamps.length - 1] || (CAPTURE_S * 1000);
  console.log(`\n  ${savedFrames} frames in ${totalWall.toFixed(1)}s `
            + `= ${(savedFrames/totalWall).toFixed(1)}fps native`);

  await browser.close();

  // ── 9. Variable-duration concat → fixed 30fps mp4 ───────────────
  const concatPath = path.join(FRAMES_DIR, 'frames.txt');
  let concat = '';
  for(let f = 0; f < savedFrames; f++){
    const dur = (f < savedFrames - 1)
      ? Math.max(0.001, (stamps[f+1] - stamps[f]) / 1000)
      : Math.max(0.001, (totalShowMs - stamps[f]) / 1000 || 0.04);
    concat += `file '${path.join(FRAMES_DIR, `f${String(f).padStart(5,'0')}.jpg`)}'\n`;
    concat += `duration ${dur.toFixed(4)}\n`;
  }
  concat += `file '${path.join(FRAMES_DIR, `f${String(savedFrames-1).padStart(5,'0')}.jpg`)}'\n`;
  fs.writeFileSync(concatPath, concat);

  console.log('Encoding to fixed 30fps...');
  const ff = spawnSync('ffmpeg', [
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
    OUTPUT_MP4,
  ], { stdio:'inherit' });

  if(ff.status !== 0){
    console.log('ffmpeg failed with exit code', ff.status);
    process.exit(1);
  }

  const stat = fs.statSync(OUTPUT_MP4);
  console.log(`\nOK ${OUTPUT_MP4}`);
  console.log(`   ${(stat.size / 1024 / 1024).toFixed(2)} MB · ${W}×${H} `
            + `· ~${(totalShowMs/1000).toFixed(1)}s · ${FPS}fps · H.264 silent`);

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
})();
