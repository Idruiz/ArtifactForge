// server/utils/logger.ts
import fs from "fs/promises";
import path from "path";

export type LogType = "trace" | "step_start" | "step_end" | "delivery";

export interface LogEntry {
  id: string;
  taskId: string;
  type: LogType;
  message: string;
  timestamp: Date;
}

class Logger {
  private logsDir: string;
  private logCallbacks: ((entry: LogEntry) => void)[] = [];
  private ready: Promise<void>;

  constructor() {
    this.logsDir = path.join(process.cwd(), "logs");
    this.ready = this.ensureLogsDirectory();
  }

  private async ensureLogsDirectory() {
    try {
      await fs.mkdir(this.logsDir, { recursive: true });
    } catch {
      // ignore: concurrent creates are fine
    }
  }

  onLog(callback: (entry: LogEntry) => void) {
    this.logCallbacks.push(callback);
  }

  private safeName(s: string): string {
    // Keep it filesystem-safe but readable
    return (s || "task")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80);
  }

  async log(taskId: string, type: LogType, message: string): Promise<LogEntry> {
    await this.ready;

    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      taskId,
      type,
      message,
      timestamp: new Date(),
    };

    // Console
    const hhmmss = entry.timestamp.toISOString().slice(11, 19);
    console.log(`[${hhmmss}] [${type}] [${taskId}] ${message}`);

    // File
    const fileBase = `run_${this.safeName(taskId)}.log.txt`;
    const logPath = path.join(this.logsDir, fileBase);
    const line = `[${entry.timestamp.toISOString()}] [${type}] ${message}\n`;

    try {
      await fs.appendFile(logPath, line);
    } catch (err) {
      // last-ditch: try to recreate the dir and append again
      try {
        await this.ensureLogsDirectory();
        await fs.appendFile(logPath, line);
      } catch (err2) {
        console.error("Failed to write log file:", err2);
      }
    }

    // Stream to any listeners
    for (const cb of this.logCallbacks) {
      try { cb(entry); } catch { /* ignore listener errors */ }
    }

    return entry;
  }

  trace(taskId: string, message: string): Promise<LogEntry> {
    return this.log(taskId, "trace", message);
  }

  stepStart(taskId: string, stepName: string): Promise<LogEntry> {
    return this.log(taskId, "step_start", `Starting: ${stepName}`);
  }

  stepEnd(taskId: string, stepName: string, duration?: number): Promise<LogEntry> {
    const suffix = duration ? ` (${duration}ms)` : "";
    return this.log(taskId, "step_end", `Completed: ${stepName}${suffix}`);
  }

  delivery(taskId: string, artifact: string): Promise<LogEntry> {
    return this.log(taskId, "delivery", `✅ Artifacts emitted: ${artifact}`);
  }
}

export const logger = new Logger();
