import express from "express";
import { parseCommand } from "./nlp.js";
import { scheduleViaProxy, freeViaProxy } from "./service.js";

const router = express.Router();

router.post("/command", async (req, res) => {
  try {
    const { userId, text, tz = "America/Vancouver", workHours } = req.body || {};
    if (!userId || !text) return res.status(400).json({ error: "userId and text required" });

    const p = parseCommand(text);
    if (p.intent === "find_free") {
      const f = await freeViaProxy(userId, { date: p.date, durationMins: p.dur, tz, workHours, attendeeAlias: p.alias });
      return res.json({ intent: "find_free", date: p.date, durationMins: p.dur, tz, windows: f.free?.slice(0, 5) || [] });
    }

    const out = await scheduleViaProxy(userId, {
      title: p.title, date: p.date, preferredStart: p.hhmm || null,
      durationMins: p.dur, tz, workHours, attendeeAlias: p.alias
    });
    return res.json(out);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/schedule", async (req, res) => {
  try {
    const { userId, title, date, preferredStart, durationMins = 30, tz = "America/Vancouver", workHours, attendeeAlias } = req.body || {};
    if (!userId || !title || !date) return res.status(400).json({ error: "userId, title, date required" });
    const out = await scheduleViaProxy(userId, { title, date, preferredStart: preferredStart || null, durationMins, tz, workHours, attendeeAlias });
    res.json(out);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
