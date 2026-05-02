// Preview both photo options at 1200px wide in a browser to pick the best
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new' });

const photos = [
  { name: 'bellagio', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Las_Vegas%2C_Bellagio_Fountains%2C_2018.11.24_%2815%29.jpg/960px-Las_Vegas%2C_Bellagio_Fountains%2C_2018.11.24_%2815%29.jpg' },
  { name: 'monte-carlo-06', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/2016_Casino_de_Monte_Carlo_06.jpg/1280px-2016_Casino_de_Monte_Carlo_06.jpg' },
  { name: 'monte-carlo-11', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/2016_Casino_de_Monte_Carlo_11.jpg/1280px-2016_Casino_de_Monte_Carlo_11.jpg' },
  { name: 'monte-carlo-14', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/2016_Casino_de_Monte_Carlo_14.jpg/1280px-2016_Casino_de_Monte_Carlo_14.jpg' },
];

for (const p of photos) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 300 });
  await page.setContent(`<body style="margin:0;background:#000"><img src="${p.url}" style="width:100%;height:300px;object-fit:cover;object-position:center 30%;display:block"></body>`);
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: `scripts/photo-${p.name}.jpg`, type:'jpeg', quality:85 });
  console.log('Saved', p.name);
  await page.close();
}
await browser.close();
