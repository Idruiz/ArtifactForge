import * as chrono from "chrono-node";

export type Parsed =
  | { intent: "schedule"; title: string; date: string; hhmm?: string | null; dur: number; alias?: string }
  | { intent: "find_free"; date: string; dur: number; alias?: string };

const DEF_TITLE = "Meeting";
const DEF_DUR = 30;

function d2(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function t2(d: Date) { return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

function titleFrom(s: string) {
  const m = s.match(/\b(called|titled|for)\s+([^,]{3,80})/i) || s.match(/(?:create|schedule|book)\s+(?:a\s+)?([^,]{3,80})/i);
  let t = m?.[2] ?? m?.[1] ?? "";
  t = (t || "").replace(/\b(meeting|event)\b/i, "").trim();
  return t || DEF_TITLE;
}
function durFrom(s: string) {
  const m = s.match(/\b(\d+)\s*(min|mins|minutes|hr|hrs|hour|hours)\b/i);
  if (m) return /hr|hour/i.test(m[2]) ? +m[1]*60 : +m[1];
  if (/\bhalf\s*hour\b/i.test(s)) return 30;
  if (/\bquarter\s*hour\b/i.test(s)) return 15;
  return DEF_DUR;
}
function aliasFrom(s: string) {
  const q = s.match(/"([^"]+)"/); if (q) return q[1].trim();
  const w = s.match(/\bwith\s+([a-z0-9._\-@ ]{2,60})/i); if (w) return w[1].trim();
  return undefined;
}

export function parseCommand(text: string, now = new Date()): Parsed {
  const s = text.trim();
  const res = chrono.parse(s, now);
  let date = d2(now);
  let hhmm: string | null | undefined = undefined;
  if (res.length) {
    const r = res[0];
    const st = r.start?.date();
    if (st) {
      date = d2(st);
      if (r.start.isCertain("hour") || r.start.isCertain("minute")) hhmm = t2(st);
    }
  }
  const dur = durFrom(s);
  const alias = aliasFrom(s);
  const title = titleFrom(s);
  const wantsFind = /\b(find|free|availability|slot|when)\b/i.test(s) && !hhmm;
  if (wantsFind) return { intent: "find_free", date, dur, alias };
  return { intent: "schedule", title, date, hhmm, dur, alias };
}
