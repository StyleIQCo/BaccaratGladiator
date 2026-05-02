import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function shot(browser, label, viewport, ua, outFile) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setUserAgent(ua);
  await page.goto('https://baccaratgladiator.com/casino-map', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => { const o = document.getElementById('intro-overlay'); if(o) o.remove(); });
  await new Promise(r => setTimeout(r, 3500));
  await page.screenshot({ path: outFile, type: 'jpeg', quality: 90 });
  console.log(`Saved ${label}: ${outFile}`);
  await page.close();
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

await Promise.all([
  // iOS Safari — iPhone 14 Pro
  shot(browser, 'iOS Safari',
    { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    path.join(__dirname, '../mobile-safari.jpg')
  ),
  // Android Chrome — Pixel 7
  shot(browser, 'Android Chrome',
    { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    path.join(__dirname, '../mobile-chrome.jpg')
  ),
]);

await browser.close();
