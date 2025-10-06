import * as chrono from "chrono-node";

export type ParsedCommand =
  | { intent: "schedule"; title: string; date: string; preferredHHmm?: string; durationMins: number; attendeeAlias?: string }
  | { intent: "find_free"; date: string; durationMins: number; attendeeAlias?: string };

const DFLT_TITLE = "Meeting";
const DUR_DEFAULT = 30;

function clampDuration(mins?: number) {
  if (!mins || !Number.isFinite(mins)) return DUR_DEFAULT;
  return Math.max(10, Math.min(240, Math.round(mins)));
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function toHHmm(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function parseCommand(text: string, now = new Date()): ParsedCommand | null {
  const s = text.trim().toLowerCase();

  // Rough intent classification
  const wantsFind =
    /(^|\b)(find|look|search)\b.*\b(free|available)\b/.test(s) ||
    /\bwhen\b.*\b(free|available)\b/.test(s);

  // Duration extraction
  let durationMins: number | undefined;
  const durMatch =
    s.match(/\b(\d+)\s*(min|mins|minutes)\b/) ||
    s.match(/\b(\d+)\s*(hr|hrs|hour|hours)\b/);
  if (durMatch) {
    const n = Number(durMatch[1]);
    const unit = durMatch[2];
    durationMins = /hr/.test(unit) ? n * 60 : n;
  } else if (/\bhalf\s*hour\b/.test(s) || /\b30\s*min\b/.test(s)) {
    durationMins = 30;
  }

  // Title extraction (very simple heuristic: words after "called|titled|for" or default)
  let title = DFLT_TITLE;
  const titleMatch = s.match(/\b(called|titled|for)\s+([^,]{3,80})/);
  if (titleMatch) {
    title = titleMatch[2].trim();
  } else if (s.startsWith("create ") || s.startsWith("schedule ")) {
    // e.g., "create a team meeting ..."
    const m = s.match(/create|schedule\s+(a\s+)?([^,]{3,80})/);
    if (m && m[2]) title = m[2].replace(/\b(meeting|event)\b/i, "").trim() || DFLT_TITLE;
  }

  // Attendee alias: quoted or after "with"
  let attendeeAlias: string | undefined;
  const quoted = s.match(/"([^"]+)"/);
  if (quoted) attendeeAlias = quoted[1].trim();
  if (!attendeeAlias) {
    const withMatch = s.match(/\bwith\s+([a-z0-9._\-@ ]{2,60})/);
    if (withMatch) attendeeAlias = withMatch[1].trim();
  }

  // Date/time via chrono
  const results = chrono.parse(s, now);
  let dateISO = toISODate(now);
  let hhmm: string | undefined;
  if (results.length) {
    const r = results[0];
    const start = r.start?.date();
    if (start) {
      dateISO = toISODate(start);
      // If user gave a time, lock it; else leave undefined (we'll search free slots)
      if (r.start.isCertain("hour") || r.start.isCertain("minute")) {
        hhmm = toHHmm(start);
      }
    }
  }

  durationMins = clampDuration(durationMins);

  if (wantsFind || (!hhmm && /find|free|slot|availability/.test(s))) {
    return { intent: "find_free", date: dateISO, durationMins, attendeeAlias };
  }

  // default: schedule
  return {
    intent: "schedule",
    title: title || DFLT_TITLE,
    date: dateISO,
    preferredHHmm: hhmm,
    durationMins,
    attendeeAlias
  };
}
