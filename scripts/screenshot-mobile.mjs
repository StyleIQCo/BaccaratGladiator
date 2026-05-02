import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

// iPhone 14 Pro dimensions
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

console.log('Loading casino map on mobile...');
await page.goto('https://baccaratgladiator.com/casino-map', { waitUntil: 'networkidle2', timeout: 30000 });

// Dismiss intro
await page.evaluate(() => { const o = document.getElementById('intro-overlay'); if(o) o.remove(); });
await new Promise(r => setTimeout(r, 3000));

// Screenshot 1: initial view (map + sidebar)
await page.screenshot({ path: path.join(__dirname, '../mobile-initial.jpg'), type:'jpeg', quality:90 });
console.log('Saved mobile-initial.jpg');

// Click a casino card to open detail panel
await page.evaluate(() => { if(typeof openDetail==='function') openDetail('bellagio'); });
await new Promise(r => setTimeout(r, 2500));

// Screenshot 2: detail panel open
await page.screenshot({ path: path.join(__dirname, '../mobile-detail.jpg'), type:'jpeg', quality:90 });
console.log('Saved mobile-detail.jpg');

await browser.close();
