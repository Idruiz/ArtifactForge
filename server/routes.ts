// server/routes.ts
import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { nanoid } from "nanoid";
import fs from "fs/promises";
import path from "path";

import { agentService } from "./services/agent"; // <-- matches your repo name
import { logger } from "./utils/logger";
import { fileStorage } from "./utils/fileStorage";
import calendarProxyRouter from "./modules/calendarProxy/router";

interface WsMsg {
  type: "join" | "chat" | "restart" | "updateKeys";
  data?: any;
  sessionId?: string; // for join
}

interface WebSocketConnection extends WebSocket {
  sessionId?: string;
  isAlive?: boolean;
}

function safeJsonParse<T = any>(data: any): T | null {
  try {
    let str: string;
    if (typeof data === "string") {
      str = data;
    } else if (Buffer.isBuffer(data)) {
      str = data.toString("utf8");
    } else if (data instanceof ArrayBuffer) {
      str = Buffer.from(data).toString("utf8");
    } else if (Array.isArray(data)) {
      str = Buffer.concat(data).toString("utf8");
    } else {
      return null;
    }
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

function safeSend(ws: WebSocket, payload: any) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // ignore send errors
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // ─────────────────────────── WebSocket setup ───────────────────────────
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const sessionConnections = new Map<string, WebSocketConnection>();

  wss.on("connection", (ws: WebSocketConnection) => {
    ws.isAlive = true;

    ws.on("message", async (raw) => {
      const msg = safeJsonParse<WsMsg>(raw);
      if (!msg || !msg.type) {
        return safeSend(ws, { type: "error", data: { message: "Invalid message" } });
      }

      try {
        switch (msg.type) {
          case "join": {
            const sessionId = msg.sessionId || msg.data?.sessionId;
            if (!sessionId) {
              safeSend(ws, { type: "error", data: { message: "sessionId required for join" } });
              return;
            }
            ws.sessionId = sessionId;
            sessionConnections.set(sessionId, ws);

            // Attach agent callbacks for this session
            agentService.onStatusUpdate(sessionId, (status) => {
              safeSend(ws, { type: "status", data: status });
            });
            agentService.onMessage(sessionId, (payload) => {
              safeSend(ws, { type: "message", data: payload });
            });
            agentService.onArtifact(sessionId, (artifact) => {
              safeSend(ws, { type: "artifact", data: artifact });
            });
            break;
          }

          case "chat": {
            const { sessionId, content, persona, tone, contentAgentEnabled, apiKeys, conversationHistory } = msg.data || {};
            
            // Use environment variable as fallback if no API key provided
            const effectiveKeys = {
              openai: apiKeys?.openai || process.env.OPENAI_API_KEY || "",
              serpApi: apiKeys?.serpApi || process.env.SERP_API_KEY || "",
              unsplash: apiKeys?.unsplash || process.env.UNSPLASH_ACCESS_KEY || "",
            };
            
            if (!effectiveKeys.openai) {
              safeSend(ws, { type: "error", data: { message: "OpenAI API key is required. Please enter it in the API Keys modal or set OPENAI_API_KEY environment variable." } });
              return;
            }
            
            await agentService.startTask(
              sessionId || ws.sessionId || nanoid(),
              content,
              persona,
              tone,
              effectiveKeys,
              !!contentAgentEnabled,
              conversationHistory || [],
            );
            break;
          }

          case "restart": {
            const sid = msg.data?.sessionId || ws.sessionId;
            if (sid) agentService.restartAgent(sid);
            break;
          }

          case "updateKeys":
            // Keys are provided per-task in "chat" messages; nothing to persist here.
            break;

          default:
            safeSend(ws, { type: "error", data: { message: `Unknown type: ${msg.type}` } });
        }
      } catch (err: any) {
        console.error("WebSocket message error:", err);
        safeSend(ws, { type: "error", data: { message: err?.message || "ws error" } });
      }
    });

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("close", () => {
      if (ws.sessionId) {
        sessionConnections.delete(ws.sessionId);
      }
    });
  });

  // Heartbeat to keep connections alive
  const heartbeat = setInterval(() => {
    // wss.clients is Set<WebSocket>; cast inside the loop
    wss.clients.forEach((client) => {
      const c = client as WebSocketConnection;
      if (c.isAlive === false) {
        try {
          c.terminate();
        } catch {
          /* ignore */
        }
        return;
      }
      c.isAlive = false;
      try {
        c.ping();
      } catch {
        /* ignore */
      }
    });
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));

  // Stream logs to all sessions (simple fan-out)
  logger.onLog((entry) => {
    const payload = {
      type: "log",
      data: {
        id: entry.id,
        type: entry.type,
        message: entry.message,
        timestamp: entry.timestamp,
      },
    };
    sessionConnections.forEach((ws) => safeSend(ws, payload));
  });

  // ───────────────────────────── REST API ─────────────────────────────

  // Health
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, ts: new Date().toISOString() })
  );

  // Fetch a log file by taskId (logger writes run_<taskId>.log.txt)
  app.get("/api/logs/:taskId", async (req, res) => {
    try {
      const safe = String(req.params.taskId || "").replace(/[^a-zA-Z0-9._-]/g, "_");
      const file = `run_${safe}.log.txt`;
      const p = path.join(process.cwd(), "logs", file);
      const txt = await fs.readFile(p, "utf8");
      res.type("text/plain; charset=utf-8").send(txt);
    } catch {
      res.status(404).send("No logs for that taskId yet");
    }
  });

  // Latest artifact (filename only + URL + size)
  app.get("/api/latest", async (_req, res) => {
    try {
      const files = await fileStorage.listFiles();
      if (!files.length) return res.json({ message: "No artifacts generated yet" });

      const latestFile = files.sort().reverse()[0];
      const stats = await fileStorage.getFileStats(latestFile);

      res.json({
        filename: latestFile,
        url: fileStorage.getPublicUrl(latestFile),
        size: stats.size,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "latest failed" });
    }
  });

  // Serve artifact files
  app.get("/api/artifacts/:filename", async (req, res) => {
    try {
      const filename = decodeURIComponent(req.params.filename || "");
      const stats = await fileStorage.getFileStats(filename);
      if (!stats.exists) return res.status(404).json({ error: "File not found" });

      const fileBuffer = await fileStorage.readFile(filename);
      const ext = filename.split(".").pop()?.toLowerCase();

      const contentTypes: Record<string, string> = {
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        rtf:  "application/rtf",
        md:   "text/markdown; charset=utf-8",
        html: "text/html; charset=utf-8",
        txt:  "text/plain; charset=utf-8",
        csv:  "text/csv; charset=utf-8",
        svg:  "image/svg+xml",
        pdf:  "application/pdf",
      };
      const contentType = contentTypes[ext || ""] || "application/octet-stream";

      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(filename)}"`
      );
      res.setHeader("Content-Length", String(stats.size));
      res.send(fileBuffer);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "artifact failed" });
    }
  });

  // Simple programmatic entry point (bypasses UI)
  app.post("/api/agent", async (req, res) => {
    try {
      const { prompt, apiKeys, persona = "professional", tone = "formal" } = req.body || {};
      if (!prompt) return res.status(400).json({ error: "Prompt is required" });
      if (!apiKeys?.openai) return res.status(400).json({ error: "OpenAI API key is required" });

      const sessionId = nanoid();
      const taskId = await agentService.startTask(
        sessionId,
        prompt,
        persona,
        tone,
        apiKeys,
        true, // contentAgentEnabled
      );

      res.json({ message: "Task started", sessionId, taskId });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "agent failed" });
    }
  });

  // Calendar proxy routes (isolated, additive module)
  app.use("/calendar-proxy", calendarProxyRouter);

  // Calendar config endpoint (provides env vars to frontend)
  app.get("/api/calendar/config", (_req, res) => {
    res.json({
      webAppUrl: process.env.GAS_WEB_APP_URL || "",
      sharedToken: process.env.GAS_SHARED_TOKEN || "",
    });
  });

  return httpServer;
}
