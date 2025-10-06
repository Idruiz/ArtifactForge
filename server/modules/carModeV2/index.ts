import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
if (!OPENAI_API_KEY) console.warn("[CARV2] OPENAI_API_KEY missing — STT will 500.");

// ====== tiny circuit breaker ======
let failCount = 0;
let openedUntil = 0;
const OPEN_THRESHOLD = 4;           // 4 consecutive fails
const OPEN_MS = 60_000;             // 1 min pause

function breakerOpen() {
  if (Date.now() < openedUntil) return true;
  return false;
}
function breakerTrip() {
  failCount++;
  if (failCount >= OPEN_THRESHOLD) {
    openedUntil = Date.now() + OPEN_MS;
    failCount = 0;
    console.error("[CARV2] breaker OPEN for 60s");
  }
}
function breakerSuccess() {
  failCount = 0;
}

// ====== budget guard ======
const MAX_MINUTES_PER_SESSION = Number(process.env.CARV2_MAX_MIN || 5); // hard cap
const MAX_REQ_PER_MIN = Number(process.env.CARV2_MAX_REQ_PM || 8);
let tick = Math.floor(Date.now() / 60_000);
let reqThisMin = 0;

function rateOK() {
  const nowTick = Math.floor(Date.now() / 60_000);
  if (nowTick !== tick) { tick = nowTick; reqThisMin = 0; }
  if (reqThisMin >= MAX_REQ_PER_MIN) return false;
  reqThisMin++;
  return true;
}

// ====== util: write buffer to tmp wav/webm for OpenAI ======
function tmpPath(ext: string) {
  const id = crypto.randomBytes(8).toString("hex");
  return path.join("/tmp", `carv2_${id}.${ext}`);
}

// ====== /stt ======
router.post("/stt",
  upload.single("audio"),
  async (req, res) => {
    try {
      if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set" });
      if (breakerOpen()) return res.status(429).json({ error: "ASR cooldown (circuit open). Try shortly." });
      if (!rateOK()) return res.status(429).json({ error: "Rate limited for this minute" });

      const { sessionSeconds = "0" } = req.body ?? {};
      if (Number(sessionSeconds) / 60 > MAX_MINUTES_PER_SESSION) {
        return res.status(402).json({ error: "Session budget exceeded" });
      }

      const buf = req.file?.buffer;
      const mime = req.file?.mimetype || "audio/webm";
      if (!buf) return res.status(400).json({ error: "no audio" });

      // save to disk; OpenAI SDK accepts streams/Blob too, but disk is simplest here
      const ext = mime.includes("wav") ? "wav" : (mime.includes("ogg") ? "ogg" : "webm");
      const p = tmpPath(ext);
      fs.writeFileSync(p, buf);

      // call OpenAI Whisper
      const form = new FormData();
      // @ts-ignore – Node18 has global Blob/FormData
      form.append("file", new Blob([fs.readFileSync(p)]), `audio.${ext}`);
      form.append("model", "whisper-1");
      // optional: "language", "temperature"

      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: form as any
      });

      fs.unlink(p, () => {});

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        breakerTrip();
        return res.status(502).json({ error: "ASR failure", detail: txt });
      }

      const data = await r.json();
      breakerSuccess();
      return res.json({ text: data.text ?? "" });
    } catch (e: any) {
      breakerTrip();
      return res.status(500).json({ error: e.message });
    }
  }
);

export default router;
