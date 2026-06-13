#!/usr/bin/env node
//
// ═══════════════════════════════════════════════════════════════════
//   THEME SMOKE TEST
//   Verifies a deployed extended/seasonal theme stage end-to-end.
//
//   USAGE
//     node test-theme-smoke.js                  → tests "zombies" by default
//     node test-theme-smoke.js egypt            → tests one named slug
//     node test-theme-smoke.js --all            → loops over every entry in
//                                                 themes-extended.js
//     BASE_URL=http://localhost:8080 node test-theme-smoke.js egypt
//                                              → run against a local server
//                                                 instead of prod
//
//   CHECKS PER THEME
//     1. baccarat-game.html?theme=<slug> applies the palette inline on body
//     2. body[data-themed='1'] + body[data-theme-slug='<slug>'] are set
//     3. .card-face computed bg = cream #fffef8 (gameplay safety)
//     4. .scoreboards computed bg = warm-brown gradient (gameplay safety)
//     5. stage-select carousel includes the card (skipped for inactive
//        seasonals, which only render when their date window is open)
//     6. Tapping SELECT routes to baccarat-game.html?theme=<slug>
//
//   EXIT CODES
//     0 — all checks passed
//     1 — at least one check failed
//     2 — script crashed
// ═══════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

const args     = process.argv.slice(2);
const RUN_ALL  = args.includes('--all');
const SLUG_ARG = args.find(a => !a.startsWith('--')) || 'zombies';
const BASE     = (process.env.BASE_URL || 'https://baccaratgladiator.com').replace(/\/$/, '');

// ── Load the local themes-extended.js to learn the expected palette
// for the slug we're testing. Single source of truth — adding a new
// theme entry is enough; no test changes needed. ─────────────────────
function loadThemesModule() {
  const code = fs.readFileSync(path.resolve(__dirname, 'themes-extended.js'), 'utf8');
  const win = {};
  const doc = { body: null };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', code)(win, doc);
  if (!win.BG_THEMES_EXTENDED) throw new Error('themes-extended.js did not expose window.BG_THEMES_EXTENDED');
  return win.BG_THEMES_EXTENDED;
}
const THEMES = loadThemesModule();

function targetSlugs() {
  if (!RUN_ALL) return [SLUG_ARG];
  // All extended stages, then any seasonals currently in window.
  const slugs = THEMES.STAGES.map(s => s.slug);
  THEMES.getActiveSeasonalStages().forEach(s => slugs.push(s.slug));
  return slugs;
}

function norm(s) { return String(s || '').replace(/\s+/g, ''); }

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let totalFails = 0;
function pass(label) { console.log(`  ${GREEN}✓${RESET} ${label}`); }
function fail(label, detail) {
  totalFails++;
  console.log(`  ${RED}✗${RESET} ${label}` + (detail ? `\n      ${DIM}${detail}${RESET}` : ''));
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('bg_age_confirmed', '1');
      localStorage.setItem('age_gate_passed', '1');
      localStorage.setItem('responsible_gaming_ack', '1');
      // Mark T1–T9 cleared so any tier's stage is unlocked for the SELECT test.
      localStorage.setItem('bg_cleared_tiers', '[1,2,3,4,5,6,7,8,9]');
    } catch (_) {}
  });
  return page;
}

async function dismissAgeGate(page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b =>
      /I Am 21|Continue|Accept|Got it/i.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 500));
}

async function testTheme(browser, slug) {
  const entry = THEMES.getBySlug(slug);
  if (!entry) {
    console.log(`\n${RED}✗${RESET} Slug "${slug}" not found in themes-extended.js`);
    totalFails++;
    return;
  }
  const isSeasonal = !!entry.seasonal;
  const PALETTE = entry.palette;
  const cb = Date.now();

  console.log(`\n══ Testing theme: ${slug} ${DIM}(${entry.name}, T${entry.tier}${isSeasonal ? ', seasonal' : ''})${RESET} ══`);

  const page = await setupPage(browser);

  // 1 — Direct theme load
  console.log(`\n  ── 1. ${BASE}/baccarat-game.html?theme=${slug}`);
  await page.goto(`${BASE}/baccarat-game.html?theme=${slug}&cb=${cb}`,
                  { waitUntil: 'networkidle2', timeout: 60_000 });
  await new Promise(r => setTimeout(r, 2500));
  await dismissAgeGate(page);

  // Pass slug as an arg — it's defined in our Node-side scope, not the
  // page's browser scope. Forgetting this swallows the ReferenceError
  // into a `{error}` object and every subsequent field reads as undefined.
  const themeState = await page.evaluate((slug) => {
    const b = document.body;
    return {
      themed:     b.getAttribute('data-themed'),
      slug:       b.getAttribute('data-theme-slug'),
      bg1:        b.style.getPropertyValue('--venue-bg1').trim(),
      bg2:        b.style.getPropertyValue('--venue-bg2').trim(),
      glow:       b.style.getPropertyValue('--venue-glow').trim(),
      line:       b.style.getPropertyValue('--venue-line').trim(),
      city:       b.style.getPropertyValue('--venue-city').trim(),
      hasModule:  typeof window.BG_THEMES_EXTENDED === 'object',
      hasEntry:   !!(window.BG_THEMES_EXTENDED && window.BG_THEMES_EXTENDED.getBySlug(slug)),
    };
  }, slug);

  if (themeState.hasModule)  pass('themes-extended.js loaded');
  else                       fail('themes-extended.js NOT loaded');

  if (themeState.hasEntry)   pass(`getBySlug("${slug}") returns entry`);
  else                       fail(`getBySlug("${slug}") missing`);

  if (themeState.themed === '1') pass('body[data-themed="1"]');
  else                           fail('data-themed not set', `got: "${themeState.themed}"`);

  if (themeState.slug === slug)  pass(`body[data-theme-slug="${slug}"]`);
  else                           fail('data-theme-slug wrong', `got: "${themeState.slug}"`);

  for (const k of ['bg1', 'bg2', 'glow', 'line']) {
    const want = `--venue-${k}`;
    if (norm(themeState[k]) === norm(PALETTE[k])) pass(`${want} = ${themeState[k]}`);
    else fail(`${want} wrong`, `got "${themeState[k]}", want "${PALETTE[k]}"`);
  }
  // City is wrapped in quotes by setProperty; compare unquoted.
  const wantCity = `"${PALETTE.city || entry.name}"`;
  if (themeState.city === wantCity) pass(`--venue-city = ${themeState.city}`);
  else fail('--venue-city wrong', `got ${themeState.city}, want ${wantCity}`);

  // 2 — Gameplay safety
  console.log('\n  ── 2. Gameplay safety: cards + roads keep hardcoded values');
  const safety = await page.evaluate(() => {
    const score = document.querySelector('.scoreboards');
    const scoreBg = score ? getComputedStyle(score).backgroundImage : null;
    // Inject probe — cards aren't rendered until a hand is dealt
    const probe = document.createElement('div');
    probe.className = 'card-face';
    probe.style.cssText = 'position:absolute;left:-9999px';
    document.body.appendChild(probe);
    const cardBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { cardBg, scoreBg };
  });
  if (safety.cardBg === 'rgb(255, 254, 248)')
    pass('cards (.card-face) bg = cream #fffef8 under data-themed');
  else
    fail('card-face safety not active', `got: ${safety.cardBg}`);

  if (safety.scoreBg && safety.scoreBg.includes('42, 26, 8') &&
      safety.scoreBg.includes('30, 19, 4'))
    pass('roads (.scoreboards) bg = #2a1a08 → #1e1304 gradient');
  else
    fail('roads background changed by theme', `got: ${safety.scoreBg}`);

  // 3 + 4 — Stage carousel: card present, SELECT routes correctly
  console.log(`\n  ── 3. ${BASE}/stage-select.html — carousel includes card`);
  await page.goto(`${BASE}/stage-select.html?cb=${cb}`,
                  { waitUntil: 'networkidle2', timeout: 60_000 });
  await new Promise(r => setTimeout(r, 1500));

  const carousel = await page.evaluate((s) => {
    const cards = [...document.querySelectorAll('.card[data-slug]')];
    const card = cards.find(c => c.dataset.slug === s);
    if (!card) return { found: false, total: cards.length };
    return {
      found:  true,
      total:  cards.length,
      tier:   card.dataset.tier,
      name:   card.querySelector('.name')?.textContent?.trim(),
      region: card.querySelector('.region')?.textContent?.trim(),
    };
  }, slug);

  if (carousel.found) {
    pass(`carousel includes "${slug}" (${carousel.total} total stages)`);

    if (carousel.name === entry.name) pass(`card name = "${entry.name}"`);
    else fail('card name wrong', `got "${carousel.name}", want "${entry.name}"`);

    if (entry.region && carousel.region === entry.region) pass(`region badge = ${entry.region}`);
    else if (entry.region) fail('region wrong', `got "${carousel.region}", want "${entry.region}"`);

    if (String(carousel.tier) === String(entry.tier)) pass(`tier = T${entry.tier}`);
    else fail('tier wrong', `got T${carousel.tier}, want T${entry.tier}`);

    // SELECT navigation
    console.log(`\n  ── 4. Tap SELECT → baccarat-game.html?theme=${slug}`);
    await page.evaluate((s) => {
      const card = document.querySelector(`.card[data-slug="${s}"]`);
      if (card) card.click();
    }, slug);
    await new Promise(r => setTimeout(r, 600));
    const selBtn = await page.$('#btn-select');
    if (!selBtn) {
      fail('#btn-select not found');
    } else {
      const box = await selBtn.boundingBox();
      if (!box) fail('#btn-select not visible');
      else {
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await new Promise(r => setTimeout(r, 2200));
        const url = page.url();
        if (url.includes('baccarat-game.html') && url.includes(`theme=${slug}`))
          pass(`SELECT routed to ?theme=${slug}`);
        else
          fail('SELECT did not route to ?theme=' + slug, `landed: ${url}`);
      }
    }
  } else if (isSeasonal) {
    // Seasonals only render in their date window — that's intentional.
    console.log(`  ${DIM}(seasonal — skipped carousel + SELECT checks: not in window today)${RESET}`);
  } else {
    fail(`zombies card not in carousel`, `total cards: ${carousel.total}`);
  }

  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const slugs = targetSlugs();
  console.log(`\nBASE_URL: ${BASE}`);
  console.log(`Targets:  ${slugs.length === 1 ? slugs[0] : slugs.length + ' themes'}`);

  for (const slug of slugs) {
    try { await testTheme(browser, slug); }
    catch (e) {
      totalFails++;
      console.log(`\n${RED}✗ Crash testing ${slug}:${RESET} ${e.message}`);
    }
  }

  await browser.close();
  if (totalFails > 0) {
    console.log(`\n${RED}FAIL — ${totalFails} check(s) failed${RESET}\n`);
    process.exit(1);
  } else {
    console.log(`\n${GREEN}All smoke checks passed.${RESET}\n`);
  }
})().catch(err => {
  console.error(`\n${RED}Test crashed:${RESET}`, err);
  process.exit(2);
});
