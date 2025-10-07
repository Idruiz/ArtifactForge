import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export function openDb(filename: string) {
  const root = process.env.DB_DIR || "/home/runner/workspace/data";
  fs.mkdirSync(root, { recursive: true });
  return new Database(path.join(root, filename));
}
