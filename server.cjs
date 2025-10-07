// server.cjs — FINAL HARDENED: SPA at root, assets cached, /admin + /site,
// WebSocket on /ws (proxy-safe), SSE fallback on /sse, strict fallbacks, health,
// graceful shutdown, optional CORS, safe JSON limits.

const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const ROOT = __dirname;
app.set('trust proxy', 1); // honor X-Forwarded-* from Render/NGINX

// ---------- Config (tweak via env if needed) ----------
const PORT = process.env.PORT || 3000;
const MAX_JSON = process.env.MAX_JSON || '2mb';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''; // e.g., "https://artifactforge.onrender.com"
const WS_MAX_PAYLOAD = Number(process.env.WS_MAX_PAYLOAD || 2 * 1024 * 1024); // 2MB
const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS || 30000);

// ---------- Find built SPA (FIRST match wins) ----------
const CANDIDATE_DIRS = [
  path.join(ROOT, 'dist', 'public'),
  path.join(ROOT, 'public'),
  path.join(ROOT, 'dist'),
  path.join(ROOT, 'client', 'dist', 'public'),
  path.join(ROOT, 'client', 'dist'),
  path.join(ROOT, 'site', 'agent'),
  path.join(ROOT, 'agent'),
  path.join(ROOT, 'admin') // last resort
];
const CANDIDATE_INDEX = ['index.html', 'agent.html', 'chat.html'];

let AGENT_DIR = null, AGENT_INDEX = null;
for (const d of CANDIDATE_DIRS) {
  if (!fs.existsSync(d)) continue;
  for (const f of CANDIDATE_INDEX) {
    if (fs.existsSync(path.join(d, f))) { AGENT_DIR = d; AGENT_INDEX = f; break; }
  }
  if (AGENT_DIR) break;
}
if (!AGENT_DIR) { AGENT_DIR = path.join(ROOT, 'admin'); AGENT_INDEX = 'index.html'; }

const SITE_DIR = path.join(ROOT, 'site');
const CMS_DIR  = path.join(ROOT, 'admin');

console.log('\n[BOOT] Path probe results:');
for (const d of CANDIDATE_DIRS) console.log('  -', d, fs.existsSync(d) ? '(exists)' : '(missing)');
console.log('  -> SELECTED AGENT_DIR   =', AGENT_DIR);
console.log('  -> SELECTED AGENT_INDEX =', AGENT_INDEX);

// ---------- Minimal security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  // Strict-Transport-Security is provided by Render/edge; no need to set here.
  next();
});

// ---------- Optional CORS (off by default) ----------
if (ALLOWED_ORIGIN) {
  app.use((req, res, next) => {
    if (req.headers.origin === ALLOWED_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });
}

// ---------- Parsers ----------
app.use(express.json({ limit: MAX_JSON }));

// ---------- Health & readiness ----------
const startTs = Date.now();
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/ready', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), started: startTs, now: Date.now() });
});
app.get('/api/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- Static SPA at ROOT ----------
app.use(express.static(AGENT_DIR, { extensions: ['html'], etag: true }));

// No-cache for the SPA HTML entry so users always get fresh bundles
function sendSpaIndex(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(AGENT_DIR, AGENT_INDEX));
}

app.get('/', (_req, res) => sendSpaIndex(res));

// Map /assets -> <AGENT_DIR>/assets (long cache)
const agentAssetsDir = path.join(AGENT_DIR, 'assets');
if (fs.existsSync(agentAssetsDir)) {
  app.use('/assets', express.static(agentAssetsDir, {
    immutable: true,
    maxAge: '31536000', // 1 year (seconds)
    etag: true,
  }));
}

// ---------- Keep CMS and marketing (never at root) ----------
if (fs.existsSync(CMS_DIR)) {
  app.use('/admin', express.static(CMS_DIR, { extensions: ['html'] }));
  app.get('/admin', (_req, res) => res.sendFile(path.join(CMS_DIR, 'index.html')));
}
if (fs.existsSync(SITE_DIR)) {
  app.use('/site', express.static(SITE_DIR, { extensions: ['html'] }));
}

// ---------- SSE fallback on /sse (for environments where WS might fail) ----------
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'hello', ok: true, ts: Date.now() })}\n\n`);

  const id = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'pulse', ts: Date.now() })}\n\n`);
  }, 30000);

  req.on('close', () => clearInterval(id));
});

// ---------- SPA fallback for any non-file path (except reserved prefixes) ----------
app.get('*', (req, res, next) => {
  const p = req.path;
  if (
    p.startsWith('/admin') || p.startsWith('/site') ||
    p === '/health' || p === '/ready' ||
    p.startsWith('/api/') || p === '/ws' || p === '/sse'
  ) return next();
  if (path.extname(p)) return next(); // let static 404 actual missing files
  return sendSpaIndex(res);
});

// ---------- HTTP server (needed for WS sharing same port) ----------
const server = http.createServer(app);

// ---------- WebSocket server (proxy-proof) ----------
const wss = new WebSocket.Server({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

function heartbeat() { this.isAlive = true; }

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  console.log('[WS] connected from', req.socket.remoteAddress);
  safeSend(ws, { type: 'hello', ok: true, ts: Date.now() });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      msg = { type: 'text', data: String(raw) };
    }

    // Guard against floods/backpressure
    if (ws.bufferedAmount > 5 * 1024 * 1024) { // 5MB pending? drop message
      return;
    }

    switch (msg.type) {
      case 'ping':
        return safeSend(ws, { type: 'pong', ts: Date.now() });
      case 'status':
        return safeSend(ws, { type: 'status', ok: true, uptime: process.uptime(), ts: Date.now() });
      case 'echo':
        return safeSend(ws, { type: 'echo', data: msg.data ?? null, ts: Date.now() });
      default:
        return safeSend(ws, { type: 'ack', seenType: msg.type ?? 'unknown', ts: Date.now() });
    }
  });

  ws.on('close', () => console.log('[WS] closed'));
  ws.on('error', (e) => console.log('[WS] error', e.message));
});

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

// Accept upgrades ONLY for /ws (exact or trailing slash); drop others immediately
server.on('upgrade', (req, socket, head) => {
  const url = (req.url || '').split('?')[0];
  if (url === '/ws' || url === '/ws/') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// Keep WS connections alive (helps on free-tier idle timeouts)
const hb = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, WS_HEARTBEAT_MS);
wss.on('close', () => clearInterval(hb));

// ---------- Start & graceful shutdown ----------
server.listen(PORT, () => {
  console.log(`\nListening on ${PORT}`);
  console.log('HTTP: /  /assets/*  /admin/*  /site/*  /health  /ready  /api/ping');
  console.log('WS:   wss://<host>/ws  (upgrade handler active)');
  console.log('SSE:  GET /sse (text/event-stream)');
});

function shutdown(sig) {
  console.log(`\n[SHUTDOWN] ${sig} received — closing...`);
  server.close(() => process.exit(0));
  wss.clients.forEach(ws => ws.terminate());
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
