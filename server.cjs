// server.cjs — FINAL (#9): SPA at ROOT, assets ok, SPA fallback, keep /admin and /site
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const ROOT = __dirname;

// Prefer your Vite build output first. FIRST match wins.
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

// Resolve SPA root + entry file
let AGENT_DIR = null, AGENT_INDEX = null;
for (const d of CANDIDATE_DIRS) {
  if (!fs.existsSync(d)) continue;
  for (const f of CANDIDATE_INDEX) {
    if (fs.existsSync(path.join(d, f))) { AGENT_DIR = d; AGENT_INDEX = f; break; }
  }
  if (AGENT_DIR) break;
}
// Fallback to admin if nothing else
if (!AGENT_DIR) { AGENT_DIR = path.join(ROOT, 'admin'); AGENT_INDEX = 'index.html'; }

const SITE_DIR = path.join(ROOT, 'site');
const CMS_DIR  = path.join(ROOT, 'admin');

// ---------- Loud boot logs ----------
console.log('\n[BOOT] Path probe results:');
for (const d of CANDIDATE_DIRS) console.log('  -', d, fs.existsSync(d) ? '(exists)' : '(missing)');
console.log('  -> SELECTED AGENT_DIR   =', AGENT_DIR);
console.log('  -> SELECTED AGENT_INDEX =', AGENT_INDEX);
console.log('  -> SITE_DIR =', SITE_DIR, fs.existsSync(SITE_DIR) ? '(exists)' : '(missing)');
console.log('  -> CMS_DIR  =', CMS_DIR,  fs.existsSync(CMS_DIR)  ? '(exists)' : '(missing)');

// ---------- Health first (never shadowed) ----------
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

// ---------- Serve SPA at ROOT ----------
app.use(express.static(AGENT_DIR, { extensions: ['html'] }));

// Map /assets -> <AGENT_DIR>/assets (covers absolute asset URLs)
const agentAssetsDir = path.join(AGENT_DIR, 'assets');
if (fs.existsSync(agentAssetsDir)) {
  app.use('/assets', express.static(agentAssetsDir, { immutable: true, maxAge: '1y' }));
}

// Root always returns SPA entry (works even if entry isn’t literally index.html)
app.get('/', (_req, res) => res.sendFile(path.join(AGENT_DIR, AGENT_INDEX)));

// ---------- Keep CMS and site ----------
if (fs.existsSync(CMS_DIR)) {
  app.use('/admin', express.static(CMS_DIR, { extensions: ['html'] }));
  app.get('/admin', (_req, res) => res.sendFile(path.join(CMS_DIR, 'index.html')));
}
if (fs.existsSync(SITE_DIR)) {
  app.use('/site', express.static(SITE_DIR, { extensions: ['html'] }));
}

// ---------- SPA fallback at ROOT ----------
// Any non-file path that isn’t /admin, /site, /api, /health returns the SPA.
// This kills client-router 404s on refresh or deep links.
app.get('*', (req, res, next) => {
  const p = req.path;
  if (
    p.startsWith('/admin') ||
    p.startsWith('/site')  ||
    p === '/health'       ||
    p.startsWith('/api/')
  ) return next();

  // If it looks like a file (/foo/bar.js), let static 404 naturally.
  if (path.extname(p)) return next();

  // Otherwise serve the SPA entry.
  return res.sendFile(path.join(AGENT_DIR, 'index.html'));
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nListening on ${PORT}`);
  console.log('Routes:');
  console.log('  /            -> agent SPA (ROOT)');
  console.log('  /assets/*    -> built assets (cached)');
  console.log('  /admin/*     -> CMS (if present)');
  console.log('  /site/*      -> marketing (if present)');
  console.log('  /health, /api/ping');
});
