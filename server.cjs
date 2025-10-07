// server.cjs — final: serve agent UI by default on Render
const express = require('express');
const path = require('path');

const app = express();

// --- Paths ---
const rootDir = __dirname;
const siteDir = path.join(rootDir, 'site');     // static marketing pages (optional)
const adminDir = path.join(rootDir, 'admin');   // YOUR AGENT UI lives here

// --- Static mounts ---
// Serve /admin/* from the repo-root /admin folder (your agent UI)
app.use('/admin', express.static(adminDir));

// Also serve the site (if you ever need it); root and /site both work
app.use(express.static(siteDir));
app.use('/site', express.static(siteDir));

// --- Health + diagnostics ---
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

// --- Default route: go straight to the agent UI ---
app.get('/', (_req, res) =>
  res.redirect('/admin/index.html?admin=1')
);

// Optional: keep LAUNCH.html reachable if you use it
app.get('/LAUNCH.html', (_req, res) => {
  res.sendFile(path.join(rootDir, 'LAUNCH.html'), err => {
    if (err) res.status(404).send('Not found');
  });
});

// Fallback: if it's a "pretty" path without extension, send the agent UI
app.get('*', (req, res, next) => {
  if (!path.extname(req.path)) {
    return res.sendFile(path.join(adminDir, 'index.html'), (err) => {
      if (err) next();
    });
  }
  return res.status(404).send('Not found');
});

// --- Port (Render provides PORT) ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
  console.log('Mounts:');
  console.log(`  /admin -> ${adminDir}`);
  console.log(`  /     -> redirect to /admin/index.html?admin=1`);
  console.log(`  /site & / -> ${siteDir} (if files exist)`);
});
