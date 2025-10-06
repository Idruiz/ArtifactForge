import { getConnector } from "./db";
import { callGAS } from "./gasClient";

export interface ScheduleParams {
  userId: string;
  title: string;
  description?: string;
  location?: string;
  date: string;
  preferredStart?: string;
  durationMins: number;
  tz?: string;
  workHours?: { start: string; end: string };
  attendeeEmail?: string;
  coworkerICS?: string;
}

export interface FreeParams {
  userId: string;
  date: string;
  durationMins: number;
  tz?: string;
  workHours?: { start: string; end: string };
  coworkerICS?: string;
}

export async function scheduleEvent(params: ScheduleParams): Promise<any> {
  const connector = getConnector(params.userId);
  if (!connector) {
    throw new Error("User not registered. Please connect your calendar first.");
  }

  const payload = {
    sharedToken: connector.sharedToken,
    action: "schedule",
    title: params.title,
    description: params.description || "",
    location: params.location || "",
    date: params.date,
    preferredStart: params.preferredStart,
    durationMins: params.durationMins,
    tz: params.tz || "America/Los_Angeles",
    workHours: params.workHours,
    attendeeEmail: params.attendeeEmail,
    coworkerICS: params.coworkerICS,
  };

  return await callGAS(connector.webAppUrl, payload);
}

export async function getFreeSlots(params: FreeParams): Promise<any> {
  const connector = getConnector(params.userId);
  if (!connector) {
    throw new Error("User not registered. Please connect your calendar first.");
  }

  const payload = {
    sharedToken: connector.sharedToken,
    action: "getFreeSlots",
    date: params.date,
    durationMins: params.durationMins,
    tz: params.tz || "America/Los_Angeles",
    workHours: params.workHours,
    coworkerICS: params.coworkerICS,
  };

  return await callGAS(connector.webAppUrl, payload);
}
