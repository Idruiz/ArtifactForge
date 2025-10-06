import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "calendar_proxy.db");
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS user_connectors (
  user_id TEXT PRIMARY KEY,
  web_app_url TEXT NOT NULL,
  shared_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

export interface UserConnector {
  webAppUrl: string;
  sharedToken: string;
}

export function upsertConnector(userId: string, webAppUrl: string, sharedToken: string): void {
  const now = Date.now();
  const update = db.prepare(
    "UPDATE user_connectors SET web_app_url=?, shared_token=?, updated_at=? WHERE user_id=?"
  ).run(webAppUrl, sharedToken, now, userId);

  if (update.changes === 0) {
    db.prepare(
      "INSERT INTO user_connectors(user_id, web_app_url, shared_token, created_at, updated_at) VALUES(?,?,?,?,?)"
    ).run(userId, webAppUrl, sharedToken, now, now);
  }
}

export function getConnector(userId: string): UserConnector | undefined {
  const row = db.prepare(
    "SELECT web_app_url as webAppUrl, shared_token as sharedToken FROM user_connectors WHERE user_id=?"
  ).get(userId) as UserConnector | undefined;

  return row;
}

export default db;
