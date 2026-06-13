const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('bg_age_confirmed', '1');
      localStorage.setItem('age_gate_passed', '1');
      localStorage.setItem('responsible_gaming_ack', '1');
    } catch(_) {}
  });
  await page.goto('https://baccaratgladiator.com/baccarat-scoreboard.html?cb=' + Date.now(),
    { waitUntil: 'networkidle2', timeout: 60_000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /I Am 21|Continue/i.test(b.textContent||''));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  const debug = await page.evaluate(() => {
    const panel = document.querySelector('.leaderboard-panel');
    if (!panel) return { error: 'no panel' };
    const cs = getComputedStyle(panel);
    const parent = panel.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    return {
      panel: {
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        height: cs.height,
        maxHeight: cs.maxHeight,
        minHeight: cs.minHeight,
        overflow: cs.overflow,
        position: cs.position,
        flex: cs.flex,
      },
      parent: parent ? {
        tagName: parent.tagName,
        id: parent.id,
        classes: parent.className,
        display: pcs.display,
        gridTemplateRows: pcs.gridTemplateRows,
        gridTemplateColumns: pcs.gridTemplateColumns,
        flexDirection: pcs.flexDirection,
        height: pcs.height,
        clip: pcs.clipPath,
      } : null,
      bodyDisplay: document.getElementById('leaderboard-body') ? getComputedStyle(document.getElementById('leaderboard-body')).display : null,
      headerDisplay: document.querySelector('.leaderboard-header') ? getComputedStyle(document.querySelector('.leaderboard-header')).display : null,
    };
  });
  console.log(JSON.stringify(debug, null, 2));
  await browser.close();
})();
