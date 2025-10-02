const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "site"), {
  extensions: ["html"],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
    }
  }
}));

app.use('/admin', express.static(path.join(__dirname, "admin")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "LAUNCH.html"));
});

app.get("/site", (_req, res) => {
  res.redirect("/site/index.html");
});

app.listen(PORT, () => {
  console.log(`✓ Website running at http://localhost:${PORT}`);
  console.log(`  LAUNCH page: http://localhost:${PORT}/`);
  console.log(`  Home: http://localhost:${PORT}/site/index.html`);
  console.log(`  Admin: http://localhost:${PORT}/admin/index.html?admin=1`);
});
