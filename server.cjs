// server.cjs — final minimal server for Render
const express = require('express');
const path = require('path');

const app = express();

// ---- Paths ----
const rootDir = __dirname;
const siteDir = path.join(rootDir, 'site');
const adminDir = path.join(siteDir, 'admin');

// 1) Serve /site at ROOT (so "/" -> site/index.html)
app.use(express.static(siteDir));

// 2) Also explicitly mount /site/* (so both styles work)
app.use('/site', express.static(siteDir));

// 3) Admin assets (/admin/index.html?admin=1)
app.use('/admin', express.static(adminDir));

// 4) Health + Ping
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

// 5) Root -> index.html (works even if someone broke the static order)
app.get('/', (_req, res) => {
  res.sendFile(path.join(siteDir, 'index.html'));
});

// 6) Try LAUNCH.html (if you kept that as an entry page)
app.get('/LAUNCH.html', (_req, res) => {
  res.sendFile(path.join(rootDir, 'LAUNCH.html'), err => {
    if (err) res.status(404).send('Not found');
  });
});

// 7) Fallback: if no dot/extension, send index.html (multi-page friendly)
app.get('*', (req, res, next) => {
  if (!path.extname(req.path)) {
    return res.sendFile(path.join(siteDir, 'index.html'), (err) => {
      if (err) next();
    });
  }
  return res.status(404).send('Not found');
});

// Port (Render sets PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
  console.log('Mounts:');
  console.log(`  Root -> ${siteDir}`);
  console.log(`  /site -> ${siteDir}`);
  console.log(`  /admin -> ${adminDir}`);
});
