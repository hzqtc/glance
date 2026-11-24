#!/usr/bin/env node
/**
 * Builds the frontend and Go dev API server, launches them on ephemeral local
 * ports (isolated from .env.local so private feeds/passcodes are never loaded),
 * and captures Retina 2x (2048x1536) JPEGs for every Glance dashboard page into
 * docs/screenshots/.
 *
 * Usage:
 *   npm run screenshots                      # build + capture all pages
 *   npm run screenshots -- weather ambient   # capture specific page(s)
 *   npm run screenshots -- --skip-build      # reuse existing dist/
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'screenshots');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'dashboard.config.json');

const VIEWPORT = { width: 1024, height: 768, deviceScaleFactor: 2 };
const JPEG_QUALITY = 90;

const DEFAULT_NEWS_FEEDS = JSON.stringify([
  { name: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { name: 'Bay Area', url: 'https://www.sfgate.com/bayarea/feed/Bay-Area-News-429.php' },
  { name: '中国要闻', url: 'https://www.chinanews.com.cn/rss/importnews.xml' },
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const PAGES = [
  {
    name: 'weather',
    slide: 0,
    query: '',
    readyExpr: `Boolean(
      document.querySelector('.hero-temp') &&
      document.querySelector('.atmos-metric-num') &&
      document.querySelectorAll('.city-card-temp').length >= 4
    )`,
    settleMs: 1600,
  },
  {
    name: 'stocks',
    slide: 1,
    query: '',
    readyExpr: `Boolean(
      document.querySelector('.stocks-hero-price') &&
      document.querySelector('.stocks-chart-card svg path') &&
      document.querySelectorAll('.stock-card').length >= 4
    )`,
    settleMs: 1200,
  },
  {
    name: 'calendar',
    slide: 2,
    query: '?demo=calendar',
    readyExpr: `Boolean(
      document.querySelector('.cal-month-title') &&
      document.querySelectorAll('.cal-event-title').length > 0 &&
      document.querySelector('.cal-trip-name')
    )`,
    settleMs: 800,
  },
  {
    name: 'world',
    slide: 3,
    query: '',
    readyExpr: `(() => {
      const pins = document.querySelectorAll('.world-map-svg .world-city-pin');
      const rates = Array.from(document.querySelectorAll('.world-fx-rate'));
      return pins.length >= 2 && rates.length >= 2 && rates.some((el) => /\\d/.test(el.textContent || ''));
    })()`,
    settleMs: 1200,
  },
  {
    name: 'news',
    slide: 4,
    query: '',
    readyExpr: `Boolean(
      document.querySelectorAll('.news-card').length >= 1 &&
      document.querySelectorAll('.news-item-title').length >= 5
    )`,
    settleMs: 800,
  },
  {
    name: 'photos',
    slide: 5,
    query: '?demo=photos',
    readyExpr: `(() => {
      const imgs = Array.from(document.querySelectorAll('.photos-frame img'));
      return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
    })()`,
    settleMs: 1200,
  },
  {
    name: 'ambient',
    slide: 0,
    query: '?demo=ambient',
    readyExpr: `Boolean(
      document.querySelector('.ambient-screen') &&
      document.querySelector('.ambient-dial') &&
      document.querySelector('.ambient-temp')
    )`,
    settleMs: 800,
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'Could not find Chrome or Chromium. Install Chrome or set CHROME_PATH.'
  );
}

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url} (${lastErr?.message || 'no response'})`);
}

function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    let opened = false;
    const pending = new Map();
    const listeners = new Map();

    const rejectAllPending = (err) => {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.rej(err);
      }
      pending.clear();
    };

    ws.addEventListener('open', () => {
      opened = true;
      resolve({
        send(method, params = {}, timeoutMs = 20000) {
          return new Promise((res, rej) => {
            if (ws.readyState !== WebSocket.OPEN) {
              rej(new Error(`CDP socket not open for ${method}`));
              return;
            }
            const id = nextId++;
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`Timed out waiting for CDP response to ${method}`));
            }, timeoutMs);
            pending.set(id, { res, rej, timer });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        once(eventName, timeoutMs = 15000) {
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const set = listeners.get(eventName);
              if (set) set.delete(handler);
              rej(new Error(`Timed out waiting for CDP event ${eventName}`));
            }, timeoutMs);
            const handler = (params) => {
              clearTimeout(timer);
              res(params);
            };
            if (!listeners.has(eventName)) listeners.set(eventName, new Set());
            listeners.get(eventName).add(handler);
          });
        },
        close() {
          try {
            ws.close();
          } catch {}
        },
      });
    });

    ws.addEventListener('error', (err) => {
      if (!opened) reject(err);
      rejectAllPending(new Error('CDP WebSocket error'));
    });
    ws.addEventListener('close', () => {
      rejectAllPending(new Error('CDP WebSocket closed unexpectedly'));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method && listeners.has(msg.method)) {
        const set = listeners.get(msg.method);
        listeners.delete(msg.method);
        for (const handler of set) {
          handler(msg.params);
        }
      }
    });
  });
}

function parseArgs(argv) {
  let skipBuild = false;
  const names = [];
  for (const arg of argv) {
    if (arg === '--skip-build') {
      skipBuild = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/screenshots.mjs [--skip-build] [weather stocks calendar world news photos ambient]'
      );
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      names.push(arg.toLowerCase());
    }
  }
  if (names.length === 0) {
    return { skipBuild, pages: PAGES };
  }
  const byName = new Map(PAGES.map((p) => [p.name, p]));
  const pages = [];
  for (const name of names) {
    const page = byName.get(name);
    if (!page) {
      throw new Error(
        `Unknown page "${name}". Valid pages: ${PAGES.map((p) => p.name).join(', ')}`
      );
    }
    pages.push(page);
  }
  return { skipBuild, pages };
}

function startStaticProxyServer(apiPort) {
  return http.createServer(async (req, res) => {
    const reqUrl = req.url || '/';
    const urlPath = reqUrl.split('?')[0];

    if (urlPath === '/_prime') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><title>prime</title>');
      return;
    }

    if (urlPath.startsWith('/api/')) {
      try {
        const upstream = await fetch(`http://127.0.0.1:${apiPort}${reqUrl}`, {
          method: req.method,
        });
        const headers = {};
        const ct = upstream.headers.get('content-type');
        if (ct) headers['Content-Type'] = ct;
        res.writeHead(upstream.status, headers);
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(String(err));
      }
      return;
    }

    const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    let filePath = path.resolve(DIST_DIR, relPath);
    if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function waitForPageReady(cdp, expr, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await cdp.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
      });
      if (res?.result?.value === true) {
        return true;
      }
    } catch {}
    await sleep(250);
  }
  return false;
}

async function main() {
  const { skipBuild, pages } = parseArgs(process.argv.slice(2));
  const chromePath = findChrome();

  if (!skipBuild || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.log('Building frontend (npm run build)...');
    execFileSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glance-shots-'));
  const apiBin = path.join(tmpDir, 'devserver');
  const tmpConfigPath = path.join(tmpDir, 'dashboard.config.json');
  const chromeProfileDir = path.join(tmpDir, 'chrome-profile');

  let apiProc;
  let chromeProc;
  let webServer;
  let cdp;

  const stopChild = (proc) => {
    if (!proc || proc.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        resolve();
      }, 2000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try { proc.kill('SIGTERM'); } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  };

  const cleanupSync = () => {
    try { cdp?.close(); } catch {}
    try { chromeProc?.kill('SIGTERM'); } catch {}
    try { apiProc?.kill('SIGTERM'); } catch {}
    try { webServer?.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };

  const cleanup = async () => {
    try { cdp?.close(); } catch {}
    try { webServer?.close(); } catch {}
    await Promise.all([stopChild(chromeProc), stopChild(apiProc)]);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };

  process.on('SIGINT', () => {
    cleanupSync();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanupSync();
    process.exit(143);
  });

  try {
    console.log('Building Go dev API server...');
    execFileSync('go', ['build', '-o', apiBin, './cmd/devserver'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });

    // Disable automatic night dimming/ambient so main dashboards stay bright
    // regardless of the local clock (?demo=ambient still forces ambient mode).
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cfg.nightMode = { ...(cfg.nightMode || {}), enabled: false };
    fs.writeFileSync(tmpConfigPath, JSON.stringify(cfg, null, 2));

    const apiPort = await getFreePort();
    const cdpPort = await getFreePort();

    // Run devserver from tmpDir so private .env.local secrets/passcode are not loaded.
    const apiEnv = {
      ...process.env,
      PORT: String(apiPort),
      GLANCE_DEV_CONFIG_PATH: tmpConfigPath,
      NEWS_FEEDS: process.env.NEWS_FEEDS || DEFAULT_NEWS_FEEDS,
    };
    delete apiEnv.GLANCE_PASSCODE;
    delete apiEnv.GLANCE_SESSION_SECRET;
    delete apiEnv.CALENDAR_ICS_URLS;
    delete apiEnv.PHOTOS_ALBUM_URL;
    delete apiEnv.PHOTOS_ALBUM_URLS;
    delete apiEnv.GEMINI_API_KEY;
    delete apiEnv.GEMINI_MODEL;

    apiProc = spawn(apiBin, [], {
      cwd: tmpDir,
      env: apiEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    apiProc.stderr.on('data', (chunk) => {
      process.stderr.write(`[api] ${chunk}`);
    });

    webServer = startStaticProxyServer(apiPort);
    await new Promise((resolve) => webServer.listen(0, '127.0.0.1', resolve));
    const webPort = webServer.address().port;
    const baseUrl = `http://127.0.0.1:${webPort}`;

    await waitForHttp(`http://127.0.0.1:${apiPort}/api/auth`, 15000);
    console.log(`Local servers ready (API :${apiPort}, Web :${webPort})`);

    const chromeArgs = [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--hide-scrollbars',
      `--user-data-dir=${chromeProfileDir}`,
    ];
    if (process.platform === 'linux') {
      chromeArgs.push('--no-sandbox', '--disable-dev-shm-usage');
    }
    chromeArgs.push('about:blank');

    let chromeStderr = '';
    chromeProc = spawn(chromePath, chromeArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    chromeProc.stderr.on('data', (chunk) => {
      if (chromeStderr.length < 4096) chromeStderr += String(chunk);
    });

    let targetsResp;
    try {
      targetsResp = await waitForHttp(`http://127.0.0.1:${cdpPort}/json/list`, 15000);
    } catch (err) {
      if (chromeStderr.trim()) {
        console.error(`[chrome stderr]\n${chromeStderr.trim()}`);
      }
      throw err;
    }
    const targets = await targetsResp.json();
    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    cdp = await connectCDP(pageTarget.webSocketDebuggerUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.deviceScaleFactor,
      mobile: false,
    });

    // Prime origin on a lightweight blank page so localStorage can select each slide before navigation.
    const primeLoad = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${baseUrl}/_prime` });
    await primeLoad;

    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const page of pages) {
      await cdp.send('Runtime.evaluate', {
        expression: `localStorage.setItem('glance:activeSlide:v1', ${JSON.stringify(String(page.slide))})`,
      });

      const sep = page.query ? '&' : '?';
      const targetUrl = `${baseUrl}/${page.query}${sep}_shot=${encodeURIComponent(page.name)}`;
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: targetUrl });
      await loaded;

      const ready = await waitForPageReady(cdp, page.readyExpr, 25000);
      if (!ready) {
        console.warn(`Warning: "${page.name}" timed out waiting for ready state; capturing anyway.`);
      }
      await sleep(page.settleMs);

      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: JPEG_QUALITY,
      });
      const outPath = path.join(OUT_DIR, `${page.name}.jpg`);
      fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
      const kb = Math.round(fs.statSync(outPath).size / 1024);
      console.log(`Captured ${path.relative(REPO_ROOT, outPath)} (${kb} KB)`);
    }
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
