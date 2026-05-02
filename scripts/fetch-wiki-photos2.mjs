// Fetches Wikipedia thumbnail URLs for remaining casinos (rate-limit friendly)
const CASINOS = [
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
  { id:'marina-bay-sands',   wikiTitle:'Marina Bay Sands' },
  { id:'rws',                wikiTitle:'Resorts World Sentosa' },
  { id:'paradise-city',      wikiTitle:'Paradise City (resort)' },
  { id:'kangwon-land',       wikiTitle:'Kangwon Land' },
  { id:'okada-manila',       wikiTitle:'Okada Manila' },
  { id:'solaire',            wikiTitle:'Solaire Resort & Casino' },
  { id:'city-of-dreams-manila', wikiTitle:'City of Dreams Manila' },
  { id:'crown-melbourne',    wikiTitle:'Crown Melbourne' },
  { id:'crown-sydney',       wikiTitle:'Crown Sydney' },
  { id:'the-star-sydney',    wikiTitle:'The Star, Sydney' },
  { id:'crown-perth',        wikiTitle:'Crown Perth' },
  { id:'monte-carlo',        wikiTitle:'Monte Carlo Casino' },
  { id:'casino-venice',      wikiTitle:'Casino di Venezia' },
  { id:'casino-estoril',     wikiTitle:'Casino Estoril' },
  { id:'borgata',            wikiTitle:'Borgata' },
  { id:'ocean-casino',       wikiTitle:'Ocean Casino Resort' },
  { id:'hard-rock-ac',       wikiTitle:'Hard Rock Hotel & Casino Atlantic City' },
  { id:'tropicana-ac',       wikiTitle:'Tropicana Atlantic City' },
  { id:'resorts-world-nyc',  wikiTitle:'Resorts World New York City' },
  { id:'mgm-national-harbor',wikiTitle:'MGM National Harbor' },
  { id:'foxwoods',           wikiTitle:'Foxwoods Resort Casino' },
  { id:'mohegan-sun',        wikiTitle:'Mohegan Sun' },
  { id:'niagara-fallsview',  wikiTitle:'Niagara Fallsview Casino Resort' },
  { id:'atlantis-bahamas',   wikiTitle:'Atlantis Paradise Island' },
  { id:'grandwest',          wikiTitle:'GrandWest' },
  { id:'skycity-auckland',   wikiTitle:'SkyCity Auckland' },
  { id:'hippodrome',         wikiTitle:'Hippodrome Casino' },
  { id:'crockfords',         wikiTitle:'Crockfords' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPhoto(casino) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(casino.wikiTitle)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'BaccaratGladiator/1.0 (frankie@styleiq.co)' } });
      if (res.status === 429) {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return { id: casino.id, photo: null, reason: `HTTP ${res.status}` };
      const data = await res.json();
      if (!data.thumbnail) return { id: casino.id, photo: null, reason: 'no thumbnail' };
      const src = data.thumbnail.source;
      if (src.endsWith('.svg') || src.includes('.svg/')) return { id: casino.id, photo: null, reason: 'SVG' };
      // Bump to 640px wide for better quality
      const hires = src.replace(/\/\d+px-/, '/640px-');
      return { id: casino.id, photo: hires, title: data.title };
    } catch (e) {
      return { id: casino.id, photo: null, reason: e.message };
    }
  }
  return { id: casino.id, photo: null, reason: 'max retries' };
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
  await sleep(800);
}

console.log('\n\nconst WIKI_PHOTOS_2 = ' + JSON.stringify(results, null, 2) + ';');
