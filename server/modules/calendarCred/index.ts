import express from "express";
import { storage } from "../../storage";

const router = express.Router();

router.get("/state", async (req, res) => {
  try {
    const userId = String(req.query.userId || "PRIMARY_USER");
    const connector = await storage.getCalendarConnector(userId);
    const colleagues = await storage.listCalendarColleagues();
    res.json({ 
      userId, 
      connector: connector ? {
        user_id: connector.userId,
        web_app_url: connector.webAppUrl,
        shared_token: connector.sharedToken
      } : null, 
      colleagues: colleagues.map(c => ({
        alias: c.alias,
        email: c.email,
        ics_url: c.icsUrl
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/user", async (req, res) => {
  try {
    const { userId, webAppUrl, sharedToken } = req.body || {};
    if (!userId || !webAppUrl || !sharedToken) {
      return res.status(400).json({ error: "userId, webAppUrl, sharedToken required" });
    }
    
    await storage.upsertCalendarConnector(userId, webAppUrl, sharedToken);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/colleague", async (req, res) => {
  try {
    const { alias, email, icsUrl } = req.body || {};
    if (!alias) return res.status(400).json({ error: "alias required" });
    if (!email && !icsUrl) return res.status(400).json({ error: "email or icsUrl required" });
    
    await storage.upsertCalendarColleague(String(alias), email ? String(email) : undefined, icsUrl ? String(icsUrl) : undefined);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/colleague/:alias", async (req, res) => {
  try {
    const alias = String(req.params.alias || "").toLowerCase();
    if (!alias) return res.status(400).json({ error: "alias required" });
    
    await storage.deleteCalendarColleague(alias);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
