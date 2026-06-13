// Play the tournament headless, capture bet history, run the same bet
// history through the Python server engine, verify finalBalance matches.
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');

(async () => {
  // Headed (not headless) so Three.js/WebGL renders the way live testers see
  // it — but parked off-screen so the window doesn't pop into view on deploy.
  const browser = await puppeteer.launch({ headless: false,  // headed for WebGL
    args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle',
           '--window-position=-2400,-2400'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 540, height: 960, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setCacheEnabled(false);
  if (typeof page.setBypassServiceWorker === 'function') await page.setBypassServiceWorker(true);

  // Use the LIVE deployed page so we exercise the actual bg-v97 build.
  const TOURN_ID = '2026-06';
  await page.goto(`https://baccaratgladiator.com/road-to-macau.html?tournament=${TOURN_ID}&cb=${Date.now()}`,
    { waitUntil: 'networkidle2', timeout: 60_000 });
  await new Promise(r => setTimeout(r, 2500));

  // Auto-play: place flat bets each hand, deal, advance.
  const NUM_HANDS = 10;  // small smoke run; full 80 takes ~5 min headed
  const expected = await page.evaluate(async (n) => {
    const T = window.__bgTournament;
    if (!T) return { error: 'tournament-mode-not-active' };
    const state = window.__macauState;
    if (!state) return { error: 'no-state-bridge' };

    function clickIfExists(sel) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return true; }
      return false;
    }

    function placeBets() {
      // Set bets directly via state for deterministic test
      state.bets.banker  = 100;
      state.bets.bdragon = 25;
      state.bets.pdragon = 25;
      // Subtract from balance to mimic chip placement
      state.balance -= 150;
      if (typeof window.__macauSync === 'function') window.__macauSync();
    }

    async function waitFor(check, timeoutMs = 15000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (check()) return true;
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    }

    for (let i = 0; i < n; i++) {
      await waitFor(() => state.phase === 'betting');
      if (state.balance < 150) break;
      placeBets();
      // Click DEAL — this snapshots bets into TOURNAMENT.betHistory
      const dealBtn = document.getElementById('btn-deal');
      if (!dealBtn || dealBtn.disabled) break;
      dealBtn.click();
      // Tap-to-flip during squeeze, fast
      await waitFor(() => state.phase === 'squeeze' || state.phase === 'betting' || state.phase === 'resolving');
      let attempts = 0;
      while (state.phase !== 'betting' && attempts < 50) {
        const flipBtn = document.querySelector('#btn-flip-all, .btn-flip-all');
        if (flipBtn) flipBtn.click();
        await new Promise(r => setTimeout(r, 200));
        attempts++;
      }
    }

    return {
      finalBalance: state.balance,
      handsPlayed:  T.handsPlayed,
      betHistory:   T.betHistory,
      dragon7:      state.stats.bdragon,
      panda8:       state.stats.pdragon,
    };
  }, NUM_HANDS);

  console.log('Client played', expected.handsPlayed, 'hands');
  console.log('Client final balance:', expected.finalBalance);
  console.log('Client bet history length:', expected.betHistory.length);
  fs.writeFileSync('/tmp/bet-history.json', JSON.stringify(expected.betHistory));
  await browser.close();

  // Server replay via Python engine
  console.log('\n=== Server replay ===');
  const pyOut = execSync(
    `/tmp/sam-test-venv/bin/python -c "
import sys, json
sys.path.insert(0, '/Users/henryfi/Documents/Claude/Projects/BaccaratGladiator/aws_s3/backend/lambda')
from baccarat_engine import hash_string_to_seed, replay_tournament
bets = json.load(open('/tmp/bet-history.json'))
seed = hash_string_to_seed('bg-tournament-${TOURN_ID}')
result = replay_tournament(seed, bets, starting_balance=10000, max_bet_per_circle=5000)
print(json.dumps(result))
"`, { encoding: 'utf8' });
  const server = JSON.parse(pyOut.trim());
  console.log('Server replay:', server);
  console.log('\n=== Match check ===');
  console.log('Client final:', expected.finalBalance);
  console.log('Server final:', server.final_balance);
  console.log('Match:', expected.finalBalance === server.final_balance ? '✓ PASS' : '✗ FAIL');
  console.log('Dragon 7 match:', expected.dragon7 === server.dragon7 ? '✓' : '✗');
  console.log('Panda 8 match:', expected.panda8 === server.panda8 ? '✓' : '✗');
})().catch(e => { console.error(e); process.exit(1); });
