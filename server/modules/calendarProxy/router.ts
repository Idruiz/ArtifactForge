import express, { Request, Response } from "express";
import { upsertConnector, getConnector, upsertAlias, getAlias, listAliases } from "./db";
import { RegisterSchema, FreeSchema, ScheduleSchema, CommandSchema, AliasUpsertSchema } from "./schemas";
import { scheduleEvent, getFreeSlots } from "./calendarService";
import { parseCommand } from "./nlp";
import { ZodError } from "zod";

const router = express.Router();

function handleValidationError(error: ZodError, res: Response) {
  const errors = error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
  return res.status(400).json({ error: "Validation failed", details: errors });
}

router.post("/register", async (req: Request, res: Response) => {
  try {
    console.log("[CAL] POST /calendar-proxy/register");
    const input = RegisterSchema.parse(req.body);

    upsertConnector(input.userId, input.webAppUrl, input.sharedToken);

    res.json({
      success: true,
      message: "Calendar connector registered successfully",
      userId: input.userId,
    });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return handleValidationError(error, res);
    }
    console.error("[CAL] Register error:", error);
    res.status(500).json({ error: error.message || "Registration failed" });
  }
});

router.post("/free", async (req: Request, res: Response) => {
  try {
    console.log("[CAL] POST /calendar-proxy/free");
    const input = FreeSchema.parse(req.body);
    const result = await getFreeSlots(input);
    res.json(result);
  } catch (error: any) {
    if (error instanceof ZodError) {
      return handleValidationError(error, res);
    }
    console.error("[CAL] Free slots error:", error);
    res.status(500).json({ error: error.message || "Failed to get free slots" });
  }
});

router.post("/schedule", async (req: Request, res: Response) => {
  try {
    console.log("[CAL] POST /calendar-proxy/schedule");
    const input = ScheduleSchema.parse(req.body);
    const result = await scheduleEvent(input);
    res.json(result);
  } catch (error: any) {
    if (error instanceof ZodError) {
      return handleValidationError(error, res);
    }
    console.error("[CAL] Schedule error:", error);
    res.status(500).json({ error: error.message || "Failed to schedule event" });
  }
});

router.post("/alias/upsert", async (req: Request, res: Response) => {
  try {
    console.log("[CAL] POST /calendar-proxy/alias/upsert");
    const input = AliasUpsertSchema.parse(req.body);
    upsertAlias(input.alias, input.email, input.icsUrl);
    res.json({ success: true, alias: input.alias });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return handleValidationError(error, res);
    }
    console.error("[CAL] Alias upsert error:", error);
    res.status(500).json({ error: error.message || "Failed to save alias" });
  }
});

router.get("/alias/list", async (_req: Request, res: Response) => {
  try {
    console.log("[CAL] GET /calendar-proxy/alias/list");
    const aliases = listAliases();
    res.json({ aliases });
  } catch (error: any) {
    console.error("[CAL] Alias list error:", error);
    res.status(500).json({ error: error.message || "Failed to list aliases" });
  }
});

router.post("/command", async (req: Request, res: Response) => {
  try {
    console.log("[CAL] POST /calendar-proxy/command");
    const input = CommandSchema.parse(req.body);
    
    const parsed = await parseCommand(input.text);
    if (!parsed) {
      return res.status(400).json({ error: "Could not understand command. Try: 'book a 30 min meeting with colleague at 2pm today'" });
    }

    console.log("[CAL] Parsed command:", parsed);

    // Resolve attendee alias if provided
    let attendeeEmail: string | undefined;
    let coworkerICS: string | undefined;
    if (parsed.attendeeAlias) {
      const aliasData = getAlias(parsed.attendeeAlias);
      if (aliasData) {
        attendeeEmail = aliasData.email;
        coworkerICS = aliasData.icsUrl;
      }
    }

    if (parsed.intent === "find_free") {
      // Return the request params for finding free slots
      return res.json({
        intent: "find_free",
        params: {
          userId: input.userId,
          date: parsed.date,
          durationMins: parsed.durationMins,
          tz: input.tz,
          workHours: input.workHours,
          coworkerICS
        },
        message: "Use the params to call /calendar-proxy/free or auto-book first available slot"
      });
    }

    // intent === "schedule" - schedule immediately
    const result = await scheduleEvent({
      userId: input.userId,
      title: parsed.title,
      description: "",
      location: "",
      date: parsed.date,
      preferredStart: parsed.preferredHHmm,
      durationMins: parsed.durationMins,
      tz: input.tz,
      workHours: input.workHours,
      attendeeEmail,
      coworkerICS
    });

    res.json({
      intent: "schedule",
      success: true,
      event: result
    });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return handleValidationError(error, res);
    }
    console.error("[CAL] Command error:", error);
    res.status(500).json({ error: error.message || "Failed to process command" });
  }
});

export default router;
