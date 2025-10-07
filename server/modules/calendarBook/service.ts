import { storage } from "../../storage";

async function getConnector(userId: string): Promise<{ webAppUrl: string; sharedToken: string } | undefined> {
  return await storage.getCalendarConnector(userId);
}

async function getColleague(alias: string): Promise<{ email?: string; icsUrl?: string } | undefined> {
  const colleagues = await storage.listCalendarColleagues();
  const colleague = colleagues.find(c => c.alias.toLowerCase() === alias.toLowerCase());
  if (!colleague) return undefined;
  return {
    email: colleague.email || undefined,
    icsUrl: colleague.icsUrl || undefined,
  };
}

async function callGAS(url: string, payload: any) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const txt = await r.text();
  let data: any = null; try { data = JSON.parse(txt); } catch {}
  if (!r.ok) throw new Error(data?.error || txt || `GAS ${r.status}`);
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function scheduleViaProxy(userId: string, args: {
  title: string; date: string; preferredStart?: string | null; durationMins: number; tz: string;
  workHours?: { start: string; end: string }; attendeeAlias?: string;
}) {
  const c = await getConnector(userId);
  if (!c) throw new Error("No connector saved for this userId. Open Calendar Credentials and Save Connector.");
  const body: any = {
    action: "schedule",
    sharedToken: c.sharedToken,
    title: args.title, date: args.date,
    preferredStart: args.preferredStart || undefined,
    durationMins: args.durationMins, tz: args.tz,
    workHours: args.workHours || { start: "09:00", end: "18:00" }
  };
  if (args.attendeeAlias) {
    const hit = await getColleague(args.attendeeAlias);
    if (hit?.icsUrl) body.coworkerICS = hit.icsUrl;
    if (hit?.email) body.attendeeEmail = hit.email;
  }
  return await callGAS(c.webAppUrl, body);
}

export async function freeViaProxy(userId: string, args: {
  date: string; durationMins: number; tz: string; workHours?: { start: string; end: string }; attendeeAlias?: string;
}) {
  const c = await getConnector(userId);
  if (!c) throw new Error("No connector saved for this userId.");
  const body: any = {
    action: "getFreeSlots",
    sharedToken: c.sharedToken,
    date: args.date, durationMins: args.durationMins, tz: args.tz,
    workHours: args.workHours || { start: "09:00", end: "18:00" }
  };
  if (args.attendeeAlias) {
    const hit = await getColleague(args.attendeeAlias);
    if (hit?.icsUrl) body.coworkerICS = hit.icsUrl;
  }
  return await callGAS(c.webAppUrl, body);
}
