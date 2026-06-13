#!/usr/bin/env node
//
// ═══════════════════════════════════════════════════════════════════
//   iOS BUNDLE SMOKE TEST
//   Verifies the local www/ directory (the Capacitor webDir) is
//   internally consistent and bootable. Run after `./cap-sync.sh`
//   and before submitting to the App Store.
//
//   USAGE
//     node test-ios-bundle.js
//
//   CHECKS
//     1. Critical runtime files are present (HTML, JS, manifest)
//     2. Per-stage road-to-*.html and preview-*.jpg counts match the
//        carousel slug list in stage-select.html
//     3. Static link audit — every <a href>, <script src>, <img src>,
//        and url(...) reference in HTML/CSS resolves to a file in www/
//        (excluding external https:// references)
//     4. www/index.html loads in puppeteer via file:// without
//        uncaught errors (catches obvious runtime failures)
//
//   EXIT CODES
//     0 = all checks passed
//     1 = at least one check failed
//     2 = script crashed
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const WWW  = path.join(ROOT, 'www');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', RST = '\x1b[0m';
let fails = 0;
const pass = (m) => console.log(`  ${G}✓${RST} ${m}`);
const fail = (m, d) => { fails++; console.log(`  ${R}✗${RST} ${m}` + (d ? `\n      ${DIM}${d}${RST}` : '')); };
const warn = (m) => console.log(`  ${Y}⚠${RST} ${m}`);

if (!fs.existsSync(WWW)) {
  console.log(`${R}✗ www/ does not exist — run ./cap-sync.sh first${RST}`);
  process.exit(1);
}

// ── 1. Critical files ──────────────────────────────────────────────
console.log('\n══ 1. Critical files in www/ ══\n');
const CRITICAL = [
  'index.html', 'stage-select.html', 'baccarat-game.html',
  'baccarat-scoreboard.html', 'themes-extended.js',
  'three.module.js', 'sw.js', 'manifest.json',
];
for (const f of CRITICAL) {
  const p = path.join(WWW, f);
  if (fs.existsSync(p)) {
    const sz = fs.statSync(p).size;
    pass(`${f} (${(sz / 1024).toFixed(1)} KB)`);
  } else {
    fail(`${f} missing from www/`);
  }
}

// ── 2. Carousel coverage ───────────────────────────────────────────
console.log('\n══ 2. Carousel coverage (road-to + preview per slug) ══\n');
const carouselSrc = fs.readFileSync(path.join(ROOT, 'stage-select.html'), 'utf8');
const slugs = [...new Set(
  [...carouselSrc.matchAll(/slug:'([^']+)'/g)].map(m => m[1])
)];
console.log(`  ${slugs.length} unique slugs in carousel`);
let missingPages = 0, missingPreviews = 0;
for (const slug of slugs) {
  if (!fs.existsSync(path.join(WWW, `road-to-${slug}.html`))) {
    fail(`road-to-${slug}.html missing from www/`);
    missingPages++;
  }
  if (!fs.existsSync(path.join(WWW, `preview-${slug}.jpg`))) {
    warn(`preview-${slug}.jpg missing — carousel will fall back to gradient`);
    missingPreviews++;
  }
}
if (!missingPages) pass(`all ${slugs.length} road-to-*.html present`);
if (!missingPreviews) pass(`all ${slugs.length} preview-*.jpg present`);

// ── 3. Static link audit ───────────────────────────────────────────
console.log('\n══ 3. Static link audit ══\n');
const ATTR_PATTERNS = [
  /href\s*=\s*["']([^"']+)["']/gi,
  /src\s*=\s*["']([^"']+)["']/gi,
  /url\(["']?([^)"']+)["']?\)/gi,
];

function listHtmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listHtmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function isExternal(ref) {
  return /^(https?:|data:|blob:|mailto:|tel:|javascript:|#)/i.test(ref) ||
         ref.startsWith('//');
}

// Skip JS template-literal placeholders (`url('${var}.jpg')`) and other
// dynamic refs — the regex sees them as text but they're constructed
// at runtime and can't be statically validated.
function isDynamic(ref) {
  return ref.includes('${') || ref.includes('"+') || ref.startsWith('${');
}

// Filter bare CSS keywords (`url(blob)`, `url(auto)`) and other
// non-path-shaped strings the loose url() regex matches as text.
function looksLikePath(ref) {
  return ref.includes('/') || /\.[a-z0-9]{1,5}(\?|#|$)/i.test(ref);
}

// Filter inline-handler captures like `href="javascript:foo()"` or
// `onclick="window.location.href='/foo'"` where the regex grabs the
// JS expression text rather than a URL. Anything containing `(`,
// `=`, or shell-y punctuation is not a real path.
function looksLikeJSExpr(ref) {
  return /[()=;{}]|window\.|location\./.test(ref);
}

// Refs that exist for the web origin (SEO, marketing redirects) but
// have no analog in a native app bundle. Safe to ignore in this audit.
const WEB_ONLY_REFS = new Set([
  '/sitemap.xml',
  '/landing.html',
]);

// Per-stage video loops (e.g. ac-loop.webm) are graceful-fallback
// assets — the source explicitly hides their elements until a video
// is dropped in. Their absence doesn't break gameplay.
function isOptionalLoopAsset(ref) {
  return /^\/?(?:road-to-)?[a-z0-9-]+(?:-loop|-arena-loop|-suite-loop|-lounge-loop)\.(?:webm|mp4)$/i.test(ref);
}

const htmlFiles = listHtmlFiles(WWW);
const brokenLinks = new Map(); // file → [refs that didn't resolve]
let totalRefsChecked = 0;

for (const file of htmlFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const seen = new Set();
  for (const re of ATTR_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      let ref = m[1].trim();
      if (!ref || isExternal(ref) || isDynamic(ref) ||
          !looksLikePath(ref) || looksLikeJSExpr(ref)) continue;
      // strip query/hash for filesystem lookup
      ref = ref.split('?')[0].split('#')[0];
      if (!ref) continue;
      if (WEB_ONLY_REFS.has(ref) || isOptionalLoopAsset(ref)) continue;
      // Resolve relative to www/ (root-absolute) or to the file's dir
      const abs = ref.startsWith('/')
        ? path.join(WWW, ref)
        : path.resolve(path.dirname(file), ref);
      if (seen.has(abs)) continue;
      seen.add(abs);
      totalRefsChecked++;
      if (!fs.existsSync(abs)) {
        if (!brokenLinks.has(file)) brokenLinks.set(file, []);
        brokenLinks.get(file).push(ref);
      }
    }
  }
}

if (brokenLinks.size === 0) {
  pass(`all ${totalRefsChecked} relative refs across ${htmlFiles.length} HTML files resolve`);
} else {
  // Reports limited to first 3 examples per file to keep output sane
  for (const [file, refs] of brokenLinks) {
    const rel = path.relative(WWW, file);
    fail(`${rel} — ${refs.length} broken ref(s)`, refs.join(', '));
  }
}

// ── 4. Browser load — index.html via file:// ──────────────────────
console.log('\n══ 4. Browser load — www/index.html via file:// ══\n');
(async () => {
  let puppeteer;
  try { puppeteer = require('puppeteer'); }
  catch (_) {
    warn('puppeteer not installed — skipping browser-load check');
    finish();
    return;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', e => {
    if (e.type() !== 'error') return;
    const text = e.text();
    // file:// origin can't load absolute /paths — that's a test
    // limitation, not a real bug. Capacitor's capacitor:// origin
    // resolves these correctly. Skip these noise errors.
    if (/Failed to load resource: net::ERR_FILE_NOT_FOUND/.test(text)) return;
    errors.push(`console.error: ${text}`);
  });
  page.on('requestfailed', r => {
    const url = r.url();
    // Absolute-path refs (e.g. /manifest.json) resolve to filesystem
    // root under file://, not the www/ dir — those failures are
    // file:// limitations, not real bugs (Capacitor's
    // capacitor://localhost origin handles them correctly). Skip.
    if (!url.startsWith('file://')) return;
    const fileUrl = url.replace('file://', '');
    if (!fileUrl.startsWith(WWW)) return;
    errors.push(`requestfailed: ${url} (${r.failure().errorText})`);
  });

  try {
    await page.goto(`file://${path.join(WWW, 'index.html')}`,
                    { waitUntil: 'networkidle2', timeout: 20_000 });
    await new Promise(r => setTimeout(r, 1500));
  } catch (e) {
    fail(`page.goto threw: ${e.message}`);
  }

  // file:// origin can't access localStorage in some browsers, can't run
  // service workers, and blocks importmap — so console errors here are
  // expected. Only flag truly load-broken stuff.
  const realErrors = errors.filter(e =>
    !/serviceWorker|service worker|importmap|localStorage|SecurityError/i.test(e)
  );
  if (realErrors.length === 0) {
    pass(`index.html loaded via file:// without filesystem-load errors`);
    if (errors.length > 0) {
      console.log(`      ${DIM}(${errors.length} expected file:// limitations ignored)${RST}`);
    }
  } else {
    fail('index.html load reported real errors',
         realErrors.slice(0, 4).join(' | '));
  }

  await browser.close();
  finish();
})().catch(e => {
  console.error(`\n${R}Crash:${RST}`, e);
  process.exit(2);
});

function finish() {
  if (fails > 0) {
    console.log(`\n${R}FAIL — ${fails} check(s) failed${RST}\n`);
    process.exit(1);
  } else {
    console.log(`\n${G}iOS bundle ready for cap-sync to native projects.${RST}\n`);
  }
}
