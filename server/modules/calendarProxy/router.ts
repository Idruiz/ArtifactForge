import express, { Request, Response } from "express";
import { upsertConnector, getConnector } from "./db";
import { RegisterSchema, FreeSchema, ScheduleSchema } from "./schemas";
import { callGAS } from "./gasClient";
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

    const connector = getConnector(input.userId);
    if (!connector) {
      return res.status(404).json({ error: "User not registered. Please connect your calendar first." });
    }

    const payload = {
      sharedToken: connector.sharedToken,
      action: "getFreeSlots",
      date: input.date,
      durationMins: input.durationMins,
      tz: input.tz,
      workHours: input.workHours,
      coworkerICS: input.coworkerICS,
    };

    const result = await callGAS(connector.webAppUrl, payload);
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

    const connector = getConnector(input.userId);
    if (!connector) {
      return res.status(404).json({ error: "User not registered. Please connect your calendar first." });
    }

    const payload = {
      sharedToken: connector.sharedToken,
      action: "schedule",
      title: input.title,
      description: input.description,
      location: input.location,
      date: input.date,
      preferredStart: input.preferredStart,
      durationMins: input.durationMins,
      tz: input.tz,
      workHours: input.workHours,
      attendeeEmail: input.attendeeEmail,
      coworkerICS: input.coworkerICS,
    };

    const result = await callGAS(connector.webAppUrl, payload);
    res.json(result);
  } catch (error: any) {
    if (error instanceof ZodError) {
      return handleValidationError(error, res);
    }
    console.error("[CAL] Schedule error:", error);
    res.status(500).json({ error: error.message || "Failed to schedule event" });
  }
});

export default router;
