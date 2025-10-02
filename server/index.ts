import express, { Request, Response, NextFunction } from "express";
import axios from "axios";
import path from "path";
import fs from "fs";

import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const SITES_DIR = path.join(process.cwd(), "data", "sites");

// ────────── request-logging middleware ──────────
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJson: Record<string, any> | undefined;

  const originalJson = res.json;
  // @ts-expect-error: widen signature
  res.json = function (body: any, ...args: any[]) {
    capturedJson = body;
    // @ts-expect-error: preserve original
    return originalJson.apply(res, [body, ...args]);
  };

  res.on("finish", () => {
    const dur = Date.now() - start;
    if (path.startsWith("/api")) {
      let line = `${req.method} ${path} ${res.statusCode} in ${dur}ms`;
      if (capturedJson) line += ` :: ${JSON.stringify(capturedJson)}`;
      if (line.length > 400) line = line.slice(0, 399) + "…";
      log(line);
    }
  });

  next();
});

// ────────── bootstrap ──────────
(async () => {
  // Register API routes FIRST, before Vite
  const server = await registerRoutes(app);
  
  // ────────── Generated Sites Listing API ──────────
  app.get("/api/sites", async (_req, res) => {
    try {
      if (!fs.existsSync(SITES_DIR)) {
        return res.json([]);
      }
      const dirs = await fs.promises.readdir(SITES_DIR);
      const sites = await Promise.all(
        dirs.map(async (id) => {
          const manifestPath = path.join(SITES_DIR, id, "manifest.json");
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf-8"));
            return manifest;
          }
          return null;
        })
      );
      res.json(sites.filter(Boolean));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ────────── Serve Generated Static Sites (BEFORE Vite) ──────────
  app.get("/sites/:id/*", (req, res, next) => {
    const siteId = req.params.id;
    
    // Validate site ID
    if (!/^[a-zA-Z0-9_-]+$/.test(siteId)) {
      return res.status(400).send("Invalid site ID");
    }
    
    // Get requested path (everything after /sites/:id/)
    let requestedPath = req.params[0] || "";
    if (!requestedPath || requestedPath === "/") {
      requestedPath = "index.html";
    }
    
    // Resolve full file path
    const siteDir = path.join(SITES_DIR, siteId);
    const filePath = path.join(siteDir, requestedPath);
    
    // Security: ensure path is within site directory
    if (!filePath.startsWith(siteDir)) {
      return res.status(403).send("Forbidden");
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).send("File not found");
    }
    
    // Set cache control and send file (this completes response, Vite won't run)
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(filePath);
  });

  // ---------- OpenAI Text-to-Speech proxy ----------
  app.post("/api/tts", async (req: Request, res: Response) => {
    try {
      const { text, voice = "alloy" } = req.body || {};
      if (!text) return res.status(400).json({ error: "`text` field is required" });

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

      const r = await axios.post(
        "https://api.openai.com/v1/audio/speech",
        { model: "tts-1", input: text, voice },
        { responseType: "arraybuffer", headers: { Authorization: `Bearer ${apiKey}` } },
      );

      res.setHeader("Content-Type", "audio/mpeg");
      res.send(r.data);
    } catch (e: any) {
      console.error("[tts]", e?.response?.data || e?.message || e);
      res.status(500).json({ error: "TTS failed" });
    }
  });

  // Simple health check
  app.get("/healthz", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  // ─── global error handler ───
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || "Internal Server Error";
    console.error("[express-error]", message, err?.stack || "");
    res.status(status).json({ message });
    // DON'T throw here — it kills the process.
  });

  // Vite in dev -or- static files in prod
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ─── start HTTP server ───
  const port = parseInt(process.env.PORT || (process.env.K_SERVICE ? "8080" : "5000"), 10);
  server.listen({ port, host: "0.0.0.0", reusePort: true }, () =>
    log(`serving on port ${port}`),
  );
})();
