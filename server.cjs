// server.cjs — auto-detect agent UI (prefer dist/public, then public)
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const ROOT = __dirname;

// Candidate agent roots (FIRST match wins)
const CANDIDATE_DIRS = [
  path.join(ROOT, 'dist', 'public'),      // <-- your Vite build (seen in logs)
  path.join(ROOT, 'public'),              // repo-root/public
  path.join(ROOT, 'dist'),                // sometimes SPA lands directly in dist/
  path.join(ROOT, 'client', 'dist', 'public'),
  path.join(ROOT, 'client', 'dist'),
  path.join(ROOT, 'site', 'agent'),
  path.join(ROOT, 'agent'),
  path.join(ROOT, 'site', 'admin'),
  path.join(ROOT, 'admin')                // CMS LAST
];

// Candidate index filenames
const CANDIDATE_INDEX = ['index.html', 'agent.html', 'chat.html'];

// Resolve AGENT_DIR + AGENT_INDEX
let AGENT_DIR = null;
let AGENT_INDEX = null;
for (const d of CANDIDATE_DIRS) {
  if (!fs.existsSync(d)) continue;
  for (const f of CANDIDATE_INDEX) {
    if (fs.existsSync(path.join(d, f))) { AGENT_DIR = d; AGENT_INDEX = f; break; }
  }
  if (AGENT_DIR) break;
}
// Fallback (loud)
if (!AGENT_DIR) { AGENT_DIR = path.join(ROOT, 'admin'); AGENT_INDEX = 'index.html'; }

const SITE_DIR = path.join(ROOT, 'site');
const CMS_DIR  = path.join(ROOT, 'admin');

// --- Logs so we KNOW what got mounted ---
console.log('\n[BOOT] Path probe results:');
for (const d of CANDIDATE_DIRS) console.log('  -', d, fs.existsSync(d) ? '(exists)' : '(missing)');
console.log('  -> SELECTED AGENT_DIR =', AGENT_DIR);
console.log('  -> SELECTED AGENT_INDEX =', AGENT_INDEX);
console.log('  -> SITE_DIR =', SITE_DIR, fs.existsSync(SITE_DIR) ? '(exists)' : '(missing)');
console.log('  -> CMS_DIR  =', CMS_DIR,  fs.existsSync(CMS_DIR)  ? '(exists)' : '(missing)');

// 1) Mount the agent at /agent
app.use('/agent', express.static(AGENT_DIR));

// 2) Root redirects to the agent
app.get('/', (_req, res) => res.redirect(`/agent/${AGENT_INDEX}`));

// 3) Keep CMS at /admin (if present)
if (fs.existsSync(CMS_DIR)) {
  app.use('/admin', express.static(CMS_DIR, { extensions: ['html'] }));
  app.get('/admin', (_req, res) => res.sendFile(path.join(CMS_DIR, 'index.html')));
}

// 4) Marketing site only under /site
if (fs.existsSync(SITE_DIR)) app.use('/site', express.static(SITE_DIR, { extensions: ['html'] }));

// 5) Health + ping
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

// 6) Fallback: extensionless -> agent index
app.get('*', (req, res) => {
  if (!path.extname(req.path)) {
    const idx = path.join(AGENT_DIR, AGENT_INDEX);
    if (fs.existsSync(idx)) return res.sendFile(idx);
  }
  return res.status(404).send('Not found');
});

// 7) Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nListening on ${PORT}`);
  console.log('Routes:');
  console.log(`  /           -> /agent/${AGENT_INDEX}`);
  console.log('  /agent/*    -> agent UI (auto-detected)');
  console.log('  /admin/*    -> CMS (if present)');
  console.log('  /site/*     -> marketing (if present)');
  console.log('  /health     -> ok,  /api/ping -> {ok:true}\n');
});
