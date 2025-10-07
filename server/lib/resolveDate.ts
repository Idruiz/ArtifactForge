// Robust phrase -> YYYY-MM-DD in a given IANA timezone (no deps)
const WD = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

function pad(n:number){ return n<10 ? `0${n}` : `${n}`; }
function ymd(d: Date){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

// "today" in tz (drop time)
export function todayInTz(tz: string): Date {
  const p = new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const y = Number(p.find(x=>x.type==="year")?.value);
  const m = Number(p.find(x=>x.type==="month")?.value);
  const d = Number(p.find(x=>x.type==="day")?.value);
  return new Date(y, m-1, d, 0, 0, 0, 0);
}

function addDays(d: Date, n: number){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function nextWeekday(base: Date, i: number){ const diff = (7 + i - base.getDay()) % 7 || 7; return addDays(base, diff); }

/** Parse things like:
 *  "today", "tomorrow", "tmrw", "tmr"
 *  "next tuesday", "on fri", "this friday"
 *  "oct 7", "october 7th", "2025-10-07"
 */
export function resolveDatePhrase(phrase: string, tz = "America/Los_Angeles"): string | null {
  if (!phrase) return null;
  const base = todayInTz(tz);
  const s = ` ${phrase.toLowerCase().trim()} `        // pad for regex
    .replace(/\btomm?or?row\b/g, "tomorrow")
    .replace(/\btmrw?\b/g, "tomorrow")
    .replace(/\btoday\b/g, "today")
    .replace(/\bthis\s+(\w+)\b/g, "$1");

  // ISO yyyy-mm-dd
  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  // relative days
  if (s.includes(" today "))   return ymd(base);
  if (s.includes(" tomorrow "))return ymd(addDays(base,1));

  // weekdays (next occurrence)
  for (let i=0;i<WD.length;i++){
    if (s.includes(` ${WD[i]} `) || s.includes(` on ${WD[i]} `) || s.includes(` next ${WD[i]} `)) {
      return ymd(nextWeekday(base, i));
    }
  }

  // month day (optionally with comma/year)
  const monthIdx = MONTHS.findIndex(m => s.includes(` ${m} `));
  if (monthIdx >= 0) {
    // get day number (e.g., "7", "7th", "07")
    const dm = s.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
    if (dm) {
      const day = Number(dm[1]);
      // year if present, else choose current or next year if already passed
      const ym = s.match(/\b(20\d{2})\b/);
      const year = ym ? Number(ym[1]) : base.getFullYear();
      let candidate = new Date(year, monthIdx, day, 0, 0, 0, 0);
      if (!ym && candidate < base) candidate = new Date(year+1, monthIdx, day, 0, 0, 0, 0);
      return ymd(candidate);
    }
  }

  // fallback: try Date.parse with current year if month name present without year
  const any = Date.parse(phrase);
  if (!isNaN(any)) {
    const d = todayInTz(tz); // anchor to tz year if needed
    const dt = new Date(any);
    if (phrase.match(/[A-Za-z]/) && !phrase.match(/\b20\d{2}\b/)) dt.setFullYear(d.getFullYear());
    // if already past in this year, roll to next
    if (dt < base) dt.setFullYear(d.getFullYear()+1);
    return ymd(dt);
  }

  return null; // let caller fall back
}
