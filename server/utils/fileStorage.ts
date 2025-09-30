// server/utils/fileStorage.ts
import * as fssync from "fs";
import fs from "fs/promises";
import path from "path";

class FileStorage {
  private artifactsDir: string;
  private ready: Promise<void>;

  constructor() {
    this.artifactsDir = path.join(process.cwd(), "artifacts");
    this.ready = this.ensureArtifactsDirectory();
  }

  private async ensureArtifactsDirectory() {
    try {
      await fs.mkdir(this.artifactsDir, { recursive: true });
    } catch {
      // ignore if already exists / concurrent create
    }
  }

  // prevent ../../ traversal and enforce writing only under artifactsDir
  private safePath(filename: string): string {
    const base = path.resolve(this.artifactsDir);
    const target = path.resolve(this.artifactsDir, filename);
    if (!target.startsWith(base + path.sep)) {
      throw new Error("Invalid filename path");
    }
    return target;
  }

  async saveFile(filename: string, data: Buffer): Promise<string> {
    await this.ready;
    const filePath = this.safePath(filename);
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async getFileStats(
    filename: string,
  ): Promise<{ size: number; exists: boolean }> {
    await this.ready;
    const filePath = this.safePath(filename);
    try {
      const stats = await fs.stat(filePath);
      return { size: stats.size, exists: true };
    } catch {
      return { size: 0, exists: false };
    }
  }

  getPublicUrl(filename: string): string {
    // Express route should serve this (see snippet below)
    return `/api/artifacts/${encodeURIComponent(filename)}`;
  }

  getFilePath(filename: string): string {
    return this.safePath(filename);
  }

  async readFile(filename: string): Promise<Buffer> {
    await this.ready;
    const filePath = this.safePath(filename);
    return await fs.readFile(filePath);
  }

  async deleteFile(filename: string): Promise<void> {
    await this.ready;
    const filePath = this.safePath(filename);
    try {
      await fs.unlink(filePath);
    } catch {
      /* ignore missing */
    }
  }

  async listFiles(): Promise<string[]> {
    await this.ready;
    try {
      return await fs.readdir(this.artifactsDir);
    } catch {
      return [];
    }
  }
}

export const fileStorage = new FileStorage();
