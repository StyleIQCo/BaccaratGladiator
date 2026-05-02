// Fetches Wikipedia thumbnail URLs for all casinos
// Run: node scripts/fetch-wiki-photos.mjs

const CASINOS = [
  { id:'bellagio',           wikiTitle:'Bellagio (resort)' },
  { id:'wynn-lv',            wikiTitle:'Wynn Las Vegas' },
  { id:'encore-lv',          wikiTitle:'Encore Las Vegas' },
  { id:'venetian-lv',        wikiTitle:'The Venetian Las Vegas' },
  { id:'aria-lv',            wikiTitle:'Aria Resort and Casino' },
  { id:'cosmopolitan-lv',    wikiTitle:'The Cosmopolitan of Las Vegas' },
  { id:'mgm-grand-lv',       wikiTitle:'MGM Grand Las Vegas' },
  { id:'mandalay-bay',       wikiTitle:'Mandalay Bay' },
  { id:'palms-lv',           wikiTitle:'Palms Casino Resort' },
  { id:'rio-lv',             wikiTitle:'Rio All-Suite Hotel & Casino' },
  { id:'park-mgm',           wikiTitle:'Park MGM' },
  { id:'treasure-island',    wikiTitle:'Treasure Island Las Vegas' },
  { id:'wynn-macau',         wikiTitle:'Wynn Macau' },
  { id:'wynn-palace',        wikiTitle:'Wynn Palace' },
  { id:'grand-lisboa',       wikiTitle:'Grand Lisboa' },
  { id:'sands-macau',        wikiTitle:'Sands Macao' },
  { id:'venetian-macau',     wikiTitle:'The Venetian Macao' },
  { id:'galaxy-macau',       wikiTitle:'Galaxy Macau' },
  { id:'city-of-dreams',     wikiTitle:'City of Dreams, Macau' },
  { id:'studio-city',        wikiTitle:'Studio City, Macau' },
  { id:'mgm-cotai',          wikiTitle:'MGM Cotai' },
  { id:'commerce-casino',    wikiTitle:'Commerce Casino' },
  { id:'tulalip-resort',     wikiTitle:'Tulalip Resort Casino' },
  { id:'muckleshoot-casino', wikiTitle:'Muckleshoot Casino' },
  { id:'snoqualmie-casino',  wikiTitle:'Snoqualmie Casino' },
  { id:'ilani-casino',       wikiTitle:'Ilani' },
  { id:'emerald-queen',      wikiTitle:'Emerald Queen Casino' },
  { id:'marina-bay-sands',   wikiTitle:'Marina Bay Sands' },
  { id:'rws',                wikiTitle:'Resorts World Sentosa' },
  { id:'paradise-city',      wikiTitle:'Paradise City (resort)' },
  { id:'seven-luck-hilton',  wikiTitle:'Seven Luck Casino' },
  { id:'kangwon-land',       wikiTitle:'Kangwon Land' },
  { id:'okada-manila',       wikiTitle:'Okada Manila' },
  { id:'solaire',            wikiTitle:'Solaire Resort & Casino' },
  { id:'city-of-dreams-manila', wikiTitle:'City of Dreams Manila' },
  { id:'nagaworld',          wikiTitle:'NagaWorld' },
  { id:'crown-melbourne',    wikiTitle:'Crown Melbourne' },
  { id:'crown-sydney',       wikiTitle:'Crown Sydney' },
  { id:'the-star-sydney',    wikiTitle:'The Star, Sydney' },
  { id:'crown-perth',        wikiTitle:'Crown Perth' },
  { id:'monte-carlo',        wikiTitle:'Monte Carlo Casino' },
  { id:'casino-cafe-paris',  wikiTitle:'Café de Paris, Monte Carlo' },
  { id:'casino-baden-baden', wikiTitle:'Casino Baden-Baden' },
  { id:'casino-venezia',     wikiTitle:'Casino di Venezia' },
  { id:'casino-estoril',     wikiTitle:'Casino Estoril' },
  { id:'casino-divonne',     wikiTitle:'Casino de Divonne-les-Bains' },
  { id:'holland-casino-amsterdam', wikiTitle:'Holland Casino' },
  { id:'casino-tallinn',     wikiTitle:'Olympic Casino' },
  { id:'crockfords',         wikiTitle:'Crockfords' },
  { id:'ritz-club',          wikiTitle:'The Ritz Club, London' },
  { id:'hippodrome',         wikiTitle:'Hippodrome Casino' },
  { id:'grosvenor-vic',      wikiTitle:'Grosvenor Victoria Casino' },
  { id:'borgata',            wikiTitle:'Borgata' },
  { id:'ocean-casino',       wikiTitle:'Ocean Casino Resort' },
  { id:'hard-rock-ac',       wikiTitle:'Hard Rock Hotel & Casino Atlantic City' },
  { id:'tropicana-ac',       wikiTitle:'Tropicana Atlantic City' },
  { id:'resorts-world-nyc',  wikiTitle:'Resorts World New York City' },
  { id:'mgm-national-harbor',wikiTitle:'MGM National Harbor' },
  { id:'foxwoods',           wikiTitle:'Foxwoods Resort Casino' },
  { id:'mohegan-sun',        wikiTitle:'Mohegan Sun' },
  { id:'live-casino-md',     wikiTitle:'Live! Casino & Hotel Maryland' },
  { id:'wind-creek-bethlehem',wikiTitle:'Wind Creek Bethlehem' },
  { id:'niagara-fallsview',  wikiTitle:'Niagara Fallsview Casino Resort' },
  { id:'river-rock',         wikiTitle:'River Rock Casino Resort' },
  { id:'great-canadian-toronto', wikiTitle:'Great Canadian Casino Resort Toronto' },
  { id:'atlantis-bahamas',   wikiTitle:'Atlantis Paradise Island' },
  { id:'grandwest',          wikiTitle:'GrandWest' },
  { id:'skycity-auckland',   wikiTitle:'SkyCity Auckland' },
];

async function fetchPhoto(casino) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(casino.wikiTitle)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'BaccaratGladiator/1.0' } });
    if (!res.ok) return { id: casino.id, photo: null, reason: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data.thumbnail) return { id: casino.id, photo: null, reason: 'no thumbnail' };
    // Use originalimage if available for better quality, else thumbnail
    const src = (data.originalimage && data.originalimage.source) ? data.originalimage.source : data.thumbnail.source;
    // Skip SVG (logos) and very small images
    if (src.endsWith('.svg') || src.includes('.svg/')) return { id: casino.id, photo: null, reason: 'SVG (logo)' };
    return { id: casino.id, photo: src, title: data.title };
  } catch (e) {
    return { id: casino.id, photo: null, reason: e.message };
  }
}

const results = {};
for (const casino of CASINOS) {
  const r = await fetchPhoto(casino);
  if (r.photo) {
    results[r.id] = r.photo;
    console.log(`✓ ${r.id}: ${r.photo.split('/').pop()}`);
  } else {
    console.log(`✗ ${r.id}: ${r.reason}`);
  }
  await new Promise(r => setTimeout(r, 120)); // polite rate limiting
}

console.log('\n\nconst WIKI_PHOTOS = ' + JSON.stringify(results, null, 2) + ';');
