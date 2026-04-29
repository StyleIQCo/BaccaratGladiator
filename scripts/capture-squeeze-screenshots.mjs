#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'book-assets');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.webm', 'video/webm'],
  ['.mp4', 'video/mp4'],
  ['.json', 'application/json; charset=utf-8'],
]);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function serveWorkspace() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let requested = decodeURIComponent(url.pathname);
      if (requested === '/') requested = '/baccarat-scoreboard.html';
      const filePath = path.resolve(root, '.' + requested);
      if (!filePath.startsWith(root) || !existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream' });
      createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(error && error.stack || error));
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function readDevToolsPort(profileDir) {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 80; i++) {
    try {
      const raw = await readFile(portFile, 'utf8');
      const [port] = raw.trim().split(/\s+/);
      if (port) return Number(port);
    } catch {}
    await wait(125);
  }
  throw new Error('Chrome did not expose a DevTools port.');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ''}`));
    else resolve(msg.result || {});
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    opened,
    close: () => ws.close(),
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
}

async function cdpEvaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result;
}

async function capture(client, name) {
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: {
      x: 330,
      y: 150,
      width: 780,
      height: 760,
      scale: 1,
    },
  });
  const filePath = path.join(outDir, name);
  await writeFile(filePath, Buffer.from(shot.data, 'base64'));
  return filePath;
}

async function main() {
  if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}`);
  await mkdir(outDir, { recursive: true });
  const server = await serveWorkspace();
  const port = server.address().port;
  const profileDir = path.join('/tmp', `bg-squeeze-capture-${Date.now()}`);
  await mkdir(profileDir, { recursive: true });

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--window-size=1440,1000',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  chrome.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    const debugPort = await readDevToolsPort(profileDir);
    const tabs = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json());
    const target = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!target) throw new Error('No Chrome page target found.');
    const client = connect(target.webSocketDebuggerUrl);
    await client.opened;

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        try {
          localStorage.setItem('bg_age_gate_21_v1', 'ok');
          localStorage.setItem('bg_onboarded_v2', '1');
          localStorage.setItem('squeezeEnabled', 'true');
          localStorage.setItem('bg_promo_unlimited', '1');
          sessionStorage.setItem('tourn-dismissed', '1');
          sessionStorage.setItem('pwa_banner_dismissed', '1');
        } catch (e) {}
      `,
    });

    await client.send('Page.navigate', {
      url: `http://127.0.0.1:${port}/baccarat-scoreboard.html?skip_splash=1&capture_squeeze=1`,
    });
    await wait(1800);

    await cdpEvaluate(client, `(() => {
      document.documentElement.setAttribute('data-skip-splash', '1');
      document.body.classList.add('streamer-mode');
      for (const id of [
        'splash-overlay','splash-flash','age-overlay','age-gate','auth-overlay',
        'onboard-overlay','promo-entry-overlay','daily-game-modal','pwa-banner',
        'review-prompt','upgrade-overlay','persona-overlay','tourn-banner'
      ]) {
        const el = document.getElementById(id);
        if (el) {
          el.classList.remove('open');
          el.classList.add('hide');
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.style.pointerEvents = 'none';
        }
      }
      if (typeof setMode === 'function') setMode('ez');
      window.squeezeEnabled = true;
      window.speedMode = false;
      window.autoPlayRemaining = 0;
      window.botPersonaLocked = true;
      window.guestTrialStarted = true;
      window.authLocked = false;
      window.freeHandsUsed = 0;
      const old = document.getElementById('capture-card');
      if (old) old.remove();
      const card = makeCardEl({ rank: '9', suit: '♥' }, 'capture-card', true, false);
      card.style.position = 'fixed';
      card.style.left = '-9999px';
      card.style.top = '-9999px';
      document.body.appendChild(card);
      openSqueezeTheater(card, 'capture-card');
      return 'ready';
    })()`);

    await wait(600);
    const files = [];
    files.push(await capture(client, 'squeeze-01-face-down.png'));
    await cdpEvaluate(client, 'advanceSqueezePhase()');
    await wait(450);
    files.push(await capture(client, 'squeeze-02-one-line.png'));
    await cdpEvaluate(client, 'advanceSqueezePhase()');
    await wait(450);
    files.push(await capture(client, 'squeeze-03-two-line.png'));
    await cdpEvaluate(client, 'advanceSqueezePhase()');
    await wait(450);
    files.push(await capture(client, 'squeeze-04-dots.png'));
    await cdpEvaluate(client, 'advanceSqueezePhase()');
    await wait(250);
    files.push(await capture(client, 'squeeze-05-full-reveal.png'));
    client.close();
    console.log(files.map(file => path.relative(root, file)).join('\n'));
  } catch (error) {
    if (stderr.trim()) console.error(stderr.trim());
    throw error;
  } finally {
    server.close();
    chrome.kill('SIGTERM');
    await wait(200);
    await rm(profileDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
