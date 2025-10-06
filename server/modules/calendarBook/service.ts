import Database from "better-sqlite3";
const db = new Database("calendar_credentials.db");

function getConnector(userId: string): { webAppUrl: string; sharedToken: string } | undefined {
  return db.prepare(`SELECT web_app_url AS webAppUrl, shared_token AS sharedToken FROM user_connector WHERE user_id=?`).get(userId) as any;
}
function getColleague(alias: string): { email?: string; ics_url?: string } | undefined {
  return db.prepare(`SELECT email, ics_url FROM colleagues WHERE alias=?`).get(alias.toLowerCase()) as any;
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
  const c = getConnector(userId);
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
    const hit = getColleague(args.attendeeAlias);
    if (hit?.ics_url) body.coworkerICS = hit.ics_url;
    if (hit?.email) body.attendeeEmail = hit.email;
  }
  return await callGAS(c.webAppUrl, body);
}

export async function freeViaProxy(userId: string, args: {
  date: string; durationMins: number; tz: string; workHours?: { start: string; end: string }; attendeeAlias?: string;
}) {
  const c = getConnector(userId);
  if (!c) throw new Error("No connector saved for this userId.");
  const body: any = {
    action: "getFreeSlots",
    sharedToken: c.sharedToken,
    date: args.date, durationMins: args.durationMins, tz: args.tz,
    workHours: args.workHours || { start: "09:00", end: "18:00" }
  };
  if (args.attendeeAlias) {
    const hit = getColleague(args.attendeeAlias);
    if (hit?.ics_url) body.coworkerICS = hit.ics_url;
  }
  return await callGAS(c.webAppUrl, body);
}
