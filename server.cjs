// server.cjs - Replace entire file with this exact content
const express = require('express');
const path = require('path');
const app = express();

// Serve static files from /site
const siteDir = path.join(__dirname, 'site');
app.use(express.static(siteDir));

// Also allow /admin to serve files from site/admin (so /admin/index.html works)
app.use('/admin', express.static(path.join(siteDir, 'admin')));

// Health check
app.get('/health', (_req, res) => {
  return res.status(200).send('ok');
});

// Simple API ping
app.get('/api/ping', (_req, res) => {
  return res.json({ ok: true });
});

// Root should serve the site index
app.get('/', (_req, res) => {
  return res.sendFile(path.join(siteDir, 'index.html'));
});

// For "pretty" urls (single page apps), fallback to index.html for non-file requests
app.get('*', (req, res) => {
  // if the request looks like it's for a file (has an extension), return 404
  if (path.extname(req.path)) {
    return res.status(404).send('Not found');
  }
  return res.sendFile(path.join(siteDir, 'index.html'));
});

// Port from environment (Render provides this)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
