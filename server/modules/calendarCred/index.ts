import express from "express";
import Database from "better-sqlite3";
import path from "path";

const router = express.Router();
const dbPath = path.join(process.cwd(), "data", "calendar_credentials.db");
const db = new Database(dbPath);
db.exec(`
CREATE TABLE IF NOT EXISTS user_connector (
  user_id TEXT PRIMARY KEY,
  web_app_url TEXT NOT NULL,
  shared_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS colleagues (
  alias TEXT PRIMARY KEY,
  email TEXT,
  ics_url TEXT,
  updated_at INTEGER NOT NULL
);
`);

function upsertConnector(userId: string, webAppUrl: string, sharedToken: string) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO user_connector(user_id,web_app_url,shared_token,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      web_app_url=excluded.web_app_url,
      shared_token=excluded.shared_token,
      updated_at=excluded.updated_at
  `).run(userId, webAppUrl, sharedToken, now);
}
function readConnector(userId: string) {
  return db.prepare(`SELECT user_id, web_app_url, shared_token FROM user_connector WHERE user_id=?`).get(userId);
}
function upsertColleague(alias: string, email?: string, ics?: string) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO colleagues(alias,email,ics_url,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(alias) DO UPDATE SET
      email=excluded.email,
      ics_url=excluded.ics_url,
      updated_at=excluded.updated_at
  `).run(alias.toLowerCase(), email || null, ics || null, now);
}
function deleteColleague(alias: string) {
  db.prepare(`DELETE FROM colleagues WHERE alias=?`).run(alias.toLowerCase());
}
function listColleagues() {
  return db.prepare(`SELECT alias,email,ics_url,updated_at FROM colleagues ORDER BY alias`).all();
}

router.get("/state", (req, res) => {
  const userId = String(req.query.userId || "PRIMARY_USER");
  res.json({ userId, connector: readConnector(userId) || null, colleagues: listColleagues() });
});

router.post("/user", async (req, res) => {
  const { userId, webAppUrl, sharedToken } = req.body || {};
  if (!userId || !webAppUrl || !sharedToken) return res.status(400).json({ error: "userId, webAppUrl, sharedToken required" });
  upsertConnector(userId, webAppUrl, sharedToken);
  const origin = `${req.protocol}://${req.get("host")}`;
  const r = await fetch(`${origin}/calendar-proxy/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, webAppUrl, sharedToken })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(400).json({ error: "Register failed", detail: j });
  res.json({ ok: true, registered: true });
});

router.post("/colleague", (req, res) => {
  const { alias, email, icsUrl } = req.body || {};
  if (!alias) return res.status(400).json({ error: "alias required" });
  if (!email && !icsUrl) return res.status(400).json({ error: "email or icsUrl required" });
  upsertColleague(String(alias), email ? String(email) : undefined, icsUrl ? String(icsUrl) : undefined);
  res.json({ ok: true });
});

router.delete("/colleague/:alias", (req, res) => {
  const alias = String(req.params.alias || "").toLowerCase();
  if (!alias) return res.status(400).json({ error: "alias required" });
  deleteColleague(alias);
  res.json({ ok: true });
});

export default router;
