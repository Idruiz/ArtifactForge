// server.cjs — final hardened server (agent-first, SPA-safe, assets fixed)
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const ROOT = __dirname;

// FIRST match wins — built app first
const CANDIDATE_DIRS = [
  path.join(ROOT, 'dist', 'public'),      // Vite output (your logs show this exists)
  path.join(ROOT, 'public'),
  path.join(ROOT, 'dist'),
  path.join(ROOT, 'client', 'dist', 'public'),
  path.join(ROOT, 'client', 'dist'),
  path.join(ROOT, 'site', 'agent'),
  path.join(ROOT, 'agent'),
  path.join(ROOT, 'site', 'admin'),
  path.join(ROOT, 'admin')                // CMS LAST
];

const CANDIDATE_INDEX = ['index.html', 'agent.html', 'chat.html'];

// Resolve agent dir + index
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

// ---- Loud boot logs
console.log('\n[BOOT] Path probe results:');
for (const d of CANDIDATE_DIRS) console.log('  -', d, fs.existsSync(d) ? '(exists)' : '(missing)');
console.log('  -> SELECTED AGENT_DIR   =', AGENT_DIR);
console.log('  -> SELECTED AGENT_INDEX =', AGENT_INDEX);
console.log('  -> SITE_DIR =', SITE_DIR, fs.existsSync(SITE_DIR) ? '(exists)' : '(missing)');
console.log('  -> CMS_DIR  =', CMS_DIR,  fs.existsSync(CMS_DIR)  ? '(exists)' : '(missing)');

// ---- Health first (never shadowed)
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

// ---- Agent static + assets
app.use('/agent', express.static(AGENT_DIR, { extensions: ['html'] }));

// Map /assets/* so absolute asset URLs from the build work
const agentAssetsDir = path.join(AGENT_DIR, 'assets');
if (fs.existsSync(agentAssetsDir)) {
  app.use('/assets', express.static(agentAssetsDir, { immutable: true, maxAge: '1y' }));
}

// Normalize /agent/index.html -> /agent/
app.get('/agent/index.html', (_req, res) => res.redirect('/agent/'));

// SPA fallback for any /agent/* route without a file extension
app.get('/agent/*', (req, res, next) => {
  if (path.extname(req.path)) return next(); // let static 404 real missing files
  return res.sendFile(path.join(AGENT_DIR, 'index.html'));
});

// ---- Root -> agent base (NOT index.html) to satisfy client router
app.get('/', (_req, res) => res.redirect('/agent/'));

// ---- CMS under /admin (if present)
if (fs.existsSync(CMS_DIR)) {
  app.use('/admin', express.static(CMS_DIR, { extensions: ['html'] }));
  app.get('/admin', (_req, res) => res.sendFile(path.join(CMS_DIR, 'index.html')));
}

// ---- Marketing only under /site (never root)
if (fs.existsSync(SITE_DIR)) app.use('/site', express.static(SITE_DIR, { extensions: ['html'] }));

// ---- All other requests: plain 404
app.use((_req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nListening on ${PORT}`);
  console.log('Routes:');
  console.log('  /            -> /agent/');
  console.log('  /agent/*     -> agent SPA (with /assets mapped)');
  console.log('  /admin/*     -> CMS (if present)');
  console.log('  /site/*      -> marketing (if present)');
  console.log('  /health, /api/ping');
});
