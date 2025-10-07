import { openDb } from "../../lib/db.js";

const db = openDb("calendar_proxy.db");

db.exec(`
CREATE TABLE IF NOT EXISTS user_connectors (
  user_id TEXT PRIMARY KEY,
  web_app_url TEXT NOT NULL,
  shared_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS aliases (
  alias TEXT PRIMARY KEY,
  email TEXT,
  ics_url TEXT,
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

export interface Alias {
  alias: string;
  email?: string;
  icsUrl?: string;
  updatedAt: number;
}

export function upsertAlias(alias: string, email?: string, icsUrl?: string): void {
  const now = Date.now();
  const stmt = db.prepare(
    "INSERT INTO aliases(alias, email, ics_url, updated_at) VALUES(?,?,?,?) ON CONFLICT(alias) DO UPDATE SET email=excluded.email, ics_url=excluded.ics_url, updated_at=excluded.updated_at"
  );
  stmt.run(alias.toLowerCase(), email || null, icsUrl || null, now);
}

export function getAlias(alias: string): { email?: string; icsUrl?: string } | null {
  const row = db.prepare("SELECT email, ics_url as icsUrl FROM aliases WHERE alias=?").get(alias.toLowerCase()) as { email?: string | null; icsUrl?: string | null } | undefined;
  if (!row) return null;
  return {
    email: row.email || undefined,
    icsUrl: row.icsUrl || undefined
  };
}

export function listAliases(): Alias[] {
  return db.prepare("SELECT alias, email, ics_url as icsUrl, updated_at as updatedAt FROM aliases ORDER BY alias").all() as any[];
}

export default db;
