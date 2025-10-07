// server.cjs — hardened agent-first server for Render
// Goals:
// - /           -> redirect to /admin/index.html?admin=1
// - /admin/*    -> serve agent UI (from repo /admin or /site/admin, whichever exists)
// - /site/*     -> serve optional marketing pages (never at root)
// - /health     -> 'ok'
// - /api/ping   -> { ok: true }
// - Extensionless paths -> agent index
// - Loud logs of what’s actually mounted

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// --- Resolve folders ---
const ROOT = __dirname;
const SITE = path.join(ROOT, 'site');
const ADMIN_ROOT = path.join(ROOT, 'admin');        // repo-root/admin
const ADMIN_IN_SITE = path.join(SITE, 'admin');     // site/admin

// Pick the first admin folder that actually exists
let ADMIN = null;
if (fs.existsSync(ADMIN_ROOT) && fs.existsSync(path.join(ADMIN_ROOT, 'index.html'))) {
  ADMIN = ADMIN_ROOT;
} else if (fs.existsSync(ADMIN_IN_SITE) && fs.existsSync(path.join(ADMIN_IN_SITE, 'index.html'))) {
  ADMIN = ADMIN_IN_SITE;
} else {
  // Last resort: still set to repo-root/admin so errors are obvious in logs
  ADMIN = ADMIN_ROOT;
}

// --- 1) ROOT -> agent (do this BEFORE any static mounts) ---
app.get('/', (_req, res) => res.redirect('/admin/index.html?admin=1'));

// --- 2) Mount the agent UI (whatever path we resolved above) ---
app.use('/admin', express.static(ADMIN, {
  // Serve files exactly; don’t list directories
  extensions: ['html']
}));

// Allow /admin (no trailing slash) to show index
app.get('/admin', (_req, res) => res.sendFile(path.join(ADMIN, 'index.html')));

// --- 3) Optional: marketing site ONLY under /site (never at root) ---
if (fs.existsSync(SITE)) {
  app.use('/site', express.static(SITE, { extensions: ['html'] }));
}

// --- 4) Health & diagnostics ---
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

// --- 5) Fallback: extensionless paths -> agent index (SPA/deep links) ---
app.get('*', (req, res, next) => {
  // If request targets a "file" with an extension, 404 it explicitly
  if (path.extname(req.path)) return res.status(404).send('Not found');
  // Otherwise, serve the agent index (works for pretty URLs)
  const idx = path.join(ADMIN, 'index.html');
  if (fs.existsSync(idx)) return res.sendFile(idx);
  // If somehow index is missing, be noisy
  return res.status(500).send('Agent index not found. Check /admin folder.');
});

// --- 6) Start server on Render's port ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nListening on ${PORT}`);
  console.log('Resolved paths:');
  console.log(`  ROOT         = ${ROOT}`);
  console.log(`  SITE         = ${SITE}  ${fs.existsSync(SITE) ? '(exists)' : '(missing)'}`);
  console.log(`  ADMIN_ROOT   = ${ADMIN_ROOT}  ${fs.existsSync(ADMIN_ROOT) ? '(exists)' : '(missing)'}`);
  console.log(`  ADMIN_IN_SITE= ${ADMIN_IN_SITE}  ${fs.existsSync(ADMIN_IN_SITE) ? '(exists)' : '(missing)'}`);
  console.log(`  >>> USING ADMIN = ${ADMIN}\n`);
  console.log('Routes:');
  console.log('  /            -> redirect to /admin/index.html?admin=1');
  console.log('  /admin/*     -> static from ADMIN');
  console.log('  /site/*      -> static from SITE (if exists)');
  console.log('  /health      -> ok');
  console.log('  /api/ping    -> { ok: true }');
});
