import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'casino-map-preview.jpg');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630 });

// Load the live site
console.log('Loading casino map...');
await page.goto('https://baccaratgladiator.com/casino-map', {
  waitUntil: 'networkidle2',
  timeout: 30000
});

// Dismiss intro overlay immediately
await page.evaluate(() => {
  const overlay = document.getElementById('intro-overlay');
  if (overlay) overlay.remove();
});

// Wait for map tiles to render
await new Promise(r => setTimeout(r, 3000));

// Open Bellagio detail panel via JS
await page.evaluate(() => {
  if (typeof openDetail === 'function') openDetail('bellagio');
});

// Wait for panel animation + photo to load
await new Promise(r => setTimeout(r, 2500));

// Screenshot
await page.screenshot({
  path: outPath,
  type: 'jpeg',
  quality: 93,
  clip: { x: 0, y: 0, width: 1200, height: 630 }
});

await browser.close();
console.log('Saved:', outPath);
