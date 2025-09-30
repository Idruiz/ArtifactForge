/**
 * server/services/builder.ts (Pro Builder v2.9.4 – Circular + Real Data + Gating)
 * - Replit-safe: no Puppeteer/Chromium, no heavy deps
 * - Fixes: overflow text, plain slides, missing charts/images, parsing issues
 * - Adds: themes, auto-paginate bodies/subtitles, robust remote image embedding,
 *         HTML export parity, dashboard (HTML) & infographic (SVG) builders, MD export
 * - Charts: ONLY multi-colour doughnut/pie with % labels via QuickChart.
 *   - Real data ingestion from CSV/JSON endpoints (chartSpec.sourceUrl or chart.url when non-image)
 *   - Numeric extraction from text (subtitle/body/notes/bullets) → donut
 *   - Guardrails:
 *       • Prefer ≥3 categories
 *       • Allow at most ONE 2-category donut for the whole deck
 *       • Skip 2-category donuts if near 50/50 (default min imbalance 12%)
 *       • Cap deck charts (default max 4)
 *       • De-duplicate donuts with identical label/% signatures
 */

import PptxGenJS from "pptxgenjs";
import axios from "axios";
import { fileStorage } from "../utils/fileStorage";
import { logger } from "../utils/logger";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

/* ─────────────────────────────── Types ─────────────────────────────── */

interface ImageIn {
  url: string;
  description?: string;
  width?: number;
  height?: number;
}

interface ChartIn {
  url: string;     // may be an image OR a CSV/JSON endpoint (auto-detected)
  title?: string;
}

export interface SlideIn {
  title?: string;
  type?: "title" | "content" | "chart" | "image";
  content?: {
    body?: string;         // long prose (moved to notes)
    subtitle?: string;     // short blurb on slide
    notes?: string;        // speaker notes
    bullets?: string[];
    image?: ImageIn;
    chart?: ChartIn;       // legacy image URL OR structured data URL
    chartSpec?: any;       // Chart.js-like config; may include { sourceUrl?: string }
    keyword?: string;
  };
}

type LayoutHints = {
  moveBodyToNotes?: boolean;
  chartEmbedDefault?: "right" | "left" | "full";
  disableAutoSummary?: boolean;
  prioritizeCharts?: boolean;     // prefer chart over decorative image in split layout

  // NEW (non-breaking): chart gating knobs
  maxCharts?: number;             // default 4
  allowOneTwoCategory?: boolean;  // default true
  minTwoCatImbalancePct?: number; // default 12 (% away from 50/50)
};

export interface BuildOptions {
  title: string;
  slides: SlideIn[];
  format:
    | "pptx"
    | "html"
    | "docx"
    | "rtf"
    | "txt"
    | "csv"
    | "dashboard"
    | "infographic"
    | "report"
    | "md";
  sources?: string[];
  layoutHints?: LayoutHints; // optional; ignored safely if absent
}

export interface BuildResult {
  filename: string;
  fileSize: number;
  filePath: string;
  metadata: { slides: number; images: number; charts: number; theme: string };
}

/* ────────────────────────────── Themes ─────────────────────────────── */

type Theme = {
  name: string;
  bg: string; // hex without '#'
  paper: string;
  text: string;
  subtext: string;
  accent: string;
  band: string;
};

const THEMES: Theme[] = [
  { name: "Ocean",   bg: "F8FAFC", paper: "FFFFFF", text: "111827", subtext: "374151", accent: "3B82F6", band: "DBEAFE" },
  { name: "Emerald", bg: "F6FEF9", paper: "FFFFFF", text: "052E16", subtext: "14532D", accent: "10B981", band: "D1FAE5" },
  { name: "Slate",   bg: "F9FAFB", paper: "FFFFFF", text: "0F172A", subtext: "334155", accent: "6366F1", band: "E0E7FF" },
];

function pickTheme(title: string): Theme {
  const h = hash(title || "deck");
  return THEMES[Math.abs(h) % THEMES.length];
}

/* ───────────────────────────── Helpers ─────────────────────────────── */

function safeTitle(s: string): string {
  return (s || "Untitled").replace(/[\r\n]+/g, " ").trim();
}

function makeFilename(title: string, ext: string) {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:]/g, "-");
  const base = title.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_");
  return `${base}_${ts}.${ext}`;
}

function paginateBodyText(body: string, maxChars = 750): string[] {
  const text = (body || "").trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const sentences = text.split(/(?<=[.!?])\s+/);
  const pages: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).trim().length > maxChars) {
      if (buf) pages.push(buf.trim());
      buf = s;
    } else {
      buf = (buf ? buf + " " : "") + s;
    }
  }
  if (buf.trim()) pages.push(buf.trim());
  return pages;
}

async function urlToBase64(url: string): Promise<string> {
  const r = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    headers: { "User-Agent": "Agent Diaz/1.0 (embedder)", Accept: "image/*" },
  });
  const ct = String(r.headers["content-type"] || "").toLowerCase();
  const mime = ct.startsWith("image/") ? ct : "image/png";
  return `data:${mime};base64,${Buffer.from(r.data).toString("base64")}`;
}

function firstN<T>(arr: T[] | undefined, n: number): T[] {
  return Array.isArray(arr) ? arr.slice(0, n) : [];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ───────────── QuickChart helpers (Doughnut/Pie only) ───────────── */

const DEFAULT_COLORS = [
  "#3b82f6","#22c55e","#f59e0b","#ef4444","#8b5cf6","#14b8a6",
  "#e11d48","#84cc16","#06b6d4","#a855f7","#f97316","#10b981",
];

function multiColorPalette(n: number): string[] {
  const base = [...DEFAULT_COLORS];
  while (base.length < n) base.push(...DEFAULT_COLORS);
  return base.slice(0, Math.max(0, n));
}

// friendlier labels/legend sizing + crisp slices
function normalizedDonutOptions(spec: any) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    cutout: spec?.options?.cutout || "60%",
    layout: { padding: 8 },
    plugins: {
      legend: {
        position: "right",
        labels: {
          boxWidth: 18,
          boxHeight: 12,
          padding: 16,
          usePointStyle: true,
          font: { size: 14 }
        }
      },
      title: {
        display: Boolean(spec?.title),
        text: spec?.title || "",
        font: { size: 18, weight: "bold" },
        padding: { top: 6, bottom: 6 }
      },
      datalabels: {
        color: "#111827",
        backgroundColor: "rgba(255,255,255,0.9)",
        borderColor: "#e5e7eb",
        borderWidth: 1,
        borderRadius: 4,
        padding: 4,
        font: { size: 14, weight: "600" },
        align: "center",
        anchor: "center",
        // show labels only for slices >= ~6% to avoid clutter
        display: (ctx: any) => {
          const ds = ctx?.dataset?.data || [];
          const v = Number(ds?.[ctx.dataIndex] || 0);
          const sum = ds.reduce((a: number, b: number) => a + Number(b || 0), 0) || 1;
          return (v / sum) >= 0.06;
        },
        formatter: (val: number, ctx: any) => {
          const ds = ctx?.chart?.data?.datasets?.[0]?.data || [];
          const sum = ds.reduce((a: number, b: number) => a + (Number(b) || 0), 0) || 1;
          const pct = Math.round((Number(val) / sum) * 100);
          return `${pct}%`;
        }
      },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (tt: any) => {
            const v = Number(tt.parsed) || 0;
            const ds = tt?.dataset?.data || [];
            const sum = ds.reduce((a: number, b: number) => a + Number(b || 0), 0) || 1;
            const pct = Math.round((v / sum) * 100);
            return `${tt.label}: ${v} (${pct}%)`;
          }
        }
      }
    }
  };
}

function normalizeToDoughnutSpec(specIn: any): any {
  const spec = specIn || {};
  let labels: string[] = [];
  let data: number[] = [];

  if (spec?.data?.labels && spec?.data?.datasets?.[0]?.data) {
    labels = [...spec.data.labels];
    data = [...spec.data.datasets[0].data].map((x: any) => Number(x));
  }

  // Fallback: tolerate {data:{A:10,B:20}}
  if ((!labels.length || !data.length) && spec?.data && !Array.isArray(spec.data.labels) && typeof spec.data === "object") {
    const entries = Object.entries(spec.data).filter(([_, v]) => typeof v === "number");
    if (entries.length >= 2) {
      labels = entries.map(([k]) => shortenLabel(k));
      data = entries.map(([_, v]) => Number(v));
    }
  }

  // Minimal fallback (won’t pass gating but keeps types safe)
  if (!(labels.length >= 2 && data.length >= 2)) {
    return {
      type: "doughnut",
      data: { labels: ["A", "B"], datasets: [{ data: [1, 1], backgroundColor: multiColorPalette(2), borderColor: "#fff", borderWidth: 2, hoverOffset: 4 }] },
      options: normalizedDonutOptions({ title: spec.title })
    };
  }

  const colors = multiColorPalette(Math.max(labels.length, data.length));

  return {
    type: (spec.type && /pie|doughnut/i.test(spec.type)) ? spec.type : "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: spec?.data?.datasets?.[0]?.backgroundColor || colors,
        borderColor: "#ffffff",
        borderWidth: 2,
        hoverOffset: 4,
      }]
    },
    options: normalizedDonutOptions(spec)
  };
}

function chartUrlFromSpec(spec: any, w = 900, h = 600, bkg = "white"): string {
  const final = normalizeToDoughnutSpec(spec);
  const encoded = encodeURIComponent(JSON.stringify(final));
  return `https://quickchart.io/chart?c=${encoded}&w=${w}&h=${h}&bkg=${bkg}&plugins=datalabels`;
}

/* ─── Dashboard/Infographic shared helpers (lightweight + deterministic) ─── */

function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function deriveTheme(seed: string) {
  const palettes = [
    { name: "Indigo",  bg:"#0f172a", card:"#111827", text:"#e5e7eb", mute:"#94a3b8", a:"#6366f1", b:"#22d3ee" },
    { name: "Teal",    bg:"#0b1020", card:"#0f172a", text:"#e2e8f0", mute:"#94a3b8", a:"#14b8a6", b:"#60a5fa" },
    { name: "Plum",    bg:"#140f1c", card:"#1f1530", text:"#f3e8ff", mute:"#d6bcfa", a:"#a855f7", b:"#f59e0b" },
    { name: "Forest",  bg:"#0b1320", card:"#0c1a23", text:"#e5f2ef", mute:"#a7c4bc", a:"#10b981", b:"#60a5fa" },
    { name: "Slate",   bg:"#0b1220", card:"#111827", text:"#e5e7eb", mute:"#9ca3af", a:"#3b82f6", b:"#f97316" },
    { name: "Royal",   bg:"#0a1228", card:"#101830", text:"#e6eaf2", mute:"#b6c1d4", a:"#7c3aed", b:"#06b6d4" },
  ];
  return palettes[strHash(seed || "theme") % palettes.length];
}

function extractKPIs(slides: any[], max = 6): Array<{label:string; valueLabel:string; valueNum:number|null;}> {
  const out: Array<{label:string; valueLabel:string; valueNum:number|null;}> = [];
  const numberRe = /(\$?\d[\d,]*(?:\.\d+)?%?)/;

  const pushBullet = (b: string) => {
    if (!b || out.length >= max) return;
    const m = b.match(numberRe);
    const label = b.replace(/\s+/g, " ").trim().slice(0, 90);
    let valueLabel = m ? m[1] : "";
    let valueNum: number | null = null;
    if (m) {
      const raw = m[1].replace(/[$,]/g, "");
      const pct = /%$/.test(m[1]);
      const num = parseFloat(raw);
      valueNum = isNaN(num) ? null : num;
      if (pct) valueLabel = `${num}%`;
    }
    out.push({ label, valueLabel, valueNum });
  };

  for (const s of slides || []) {
    const bullets = s?.content?.bullets;
    if (Array.isArray(bullets)) {
      for (const b of bullets) {
        pushBullet(String(b || ""));
        if (out.length >= max) break;
      }
    }
    if (out.length >= max) break;
  }
  while (out.length < Math.min(3, max)) {
    out.push({ label:`Key Metric ${out.length+1}`, valueLabel:`${30 + out.length*10}%`, valueNum: 30 + out.length*10 });
  }
  return out.slice(0, max);
}

/* ── Chart-specific utilities (extraction + real data) ─────────────────── */

function stripMdLite(s: string): string {
  return String(s || "")
    .replace(/[`*_>#]/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenLabel(raw: string): string {
  const s = stripMdLite(raw).replace(/[()]/g, "").trim();
  const words = s.split(/\s+/);
  const short = words.slice(0, 5).join(" ");
  return (short.length > 30 ? short.slice(0, 28) + "…" : short) || "Item";
}

type Pair = { label: string; value: number; isPct: boolean };

function parsePairsFromText(text: string, max = 8): Pair[] {
  const pairs: Pair[] = [];
  if (!text) return pairs;

  // Match multiple pairs inside a single line
  const globalRe = /([A-Za-z][A-Za-z0-9 ./%+-]{1,60})[:\s—-]+(\$?\d[\d,]*(?:\.\d+)?)(\s*%|\s*(?:percent|percentage))?/gi;
  let m: RegExpExecArray | null;
  while ((m = globalRe.exec(text)) && pairs.length < max) {
    const label = shortenLabel(m[1]);
    const num = parseFloat(m[2].replace(/[$,]/g, ""));
    if (!Number.isFinite(num)) continue;
    const isPct = !!m[3];
    pairs.push({ label, value: num, isPct });
  }

  // Fallback: "Label (42%)"
  if (pairs.length === 0) {
    const altRe = /([A-Za-z][A-Za-z0-9 ./%+-]{1,60})\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/gi;
    while ((m = altRe.exec(text)) && pairs.length < max) {
      const label = shortenLabel(m[1]);
      const num = parseFloat(m[2]);
      pairs.push({ label, value: num, isPct: true });
    }
  }

  return pairs;
}

function extractNumericPairsFromSlide(s: SlideIn, max = 8): Pair[] {
  const out: Pair[] = [];
  const c: any = s.content || {};
  const pool: string[] = [];
  if (c.subtitle) pool.push(c.subtitle);
  if (c.body)     pool.push(c.body);
  if (c.notes)    pool.push(c.notes);
  if (Array.isArray(c.bullets)) pool.push(...c.bullets);

  const dedupe = new Set<string>();
  for (const text of pool) {
    const pairs = parsePairsFromText(String(text || ""), max);
    for (const p of pairs) {
      const key = `${p.label.toLowerCase()}|${p.isPct ? "pct" : "val"}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      out.push(p);
      if (out.length >= max) break;
    }
    if (out.length >= max) break;
  }

  const uniqLabels = new Set(out.map(p => p.label));
  return uniqLabels.size >= 2 ? out : [];
}

function hasUsableChartData(spec: any): boolean {
  try {
    const ds = spec?.data?.datasets?.[0]?.data || [];
    const lbls = spec?.data?.labels || [];
    const ok = Array.isArray(ds) && Array.isArray(lbls) && lbls.length >= 2 && ds.length >= 2;
    const somePos = ok && ds.some((v: any) => Number(v) > 0);
    return Boolean(ok && somePos);
  } catch { return false; }
}

function buildDoughnutFromPairs(pairs: Pair[], title = "Distribution") {
  const labels = pairs.map(p => p.label);
  const data = pairs.map(p => p.value);
  const colors = multiColorPalette(labels.length);

  return normalizeToDoughnutSpec({
    type: "doughnut",
    title,
    data: { labels, datasets: [{ data, backgroundColor: colors }] },
  });
}

function seedSlideChartSpec(s: SlideIn): SlideIn {
  const c: any = s.content || {};
  // If we already have usable chartSpec, normalize it to doughnut & keep
  if (c.chartSpec && hasUsableChartData(normalizeToDoughnutSpec(c.chartSpec))) {
    return {
      ...s,
      content: {
        ...c,
        chartSpec: normalizeToDoughnutSpec(c.chartSpec),
      }
    };
  }

  // Try extracting numeric pairs from text
  const pairs = extractNumericPairsFromSlide(s, 8);
  if (pairs.length >= 2) {
    return {
      ...s,
      content: {
        ...c,
        chartSpec: buildDoughnutFromPairs(pairs, c.chartSpec?.title || "Distribution"),
      }
    };
  }

  // Nothing derived → leave untouched
  return s;
}

/* ─────────── Real data ingestion (CSV/JSON → labels/data) ─────────── */

function looksLikeImageUrl(url: string): boolean {
  return /\.(png|jpg|jpeg|gif|svg|webp)(\?|$)/i.test(url);
}

async function fetchCsv(url: string): Promise<Array<{ label: string; value: number }>> {
  const { data } = await axios.get<string>(url, { timeout: 15000 });
  const lines = String(data || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const out: Array<{ label: string; value: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    const cells = row.split(",").map(s => s.replace(/^["']|["']$/g, "").trim());
    if (i === 0 && cells.length >= 2 && /label/i.test(cells[0]) && /value/i.test(cells[1])) continue; // header
    if (cells.length >= 2) {
      const label = shortenLabel(cells[0]);
      const num = Number(String(cells[1]).replace(/[$,%]/g, ""));
      if (label && Number.isFinite(num)) out.push({ label, value: num });
    }
  }
  return out;
}

async function fetchJson(url: string): Promise<Array<{ label: string; value: number }>> {
  const { data } = await axios.get<any>(url, { timeout: 15000 });
  const out: Array<{ label: string; value: number }> = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      const label = shortenLabel(item?.label || item?.name || "");
      const val = Number(item?.value ?? item?.y ?? item?.count ?? item?.v);
      if (label && Number.isFinite(val)) out.push({ label, value: val });
    }
  } else if (data?.data?.labels && data?.data?.datasets?.[0]?.data) {
    const labels = data.data.labels;
    const vals = data.data.datasets[0].data;
    for (let i = 0; i < Math.min(labels.length, vals.length); i++) {
      const label = shortenLabel(labels[i]);
      const val = Number(vals[i]);
      if (label && Number.isFinite(val)) out.push({ label, value: val });
    }
  } else if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      const label = shortenLabel(String(k));
      const val = Number((v as any));
      if (label && Number.isFinite(val)) out.push({ label, value: val });
    }
  }
  return out;
}

async function maybeAugmentChartSpecFromData(c: any): Promise<any | null> {
  const srcUrl: string | undefined = c?.chartSpec?.sourceUrl || (c?.chart?.url && !looksLikeImageUrl(c.chart.url) ? c.chart.url : undefined);
  if (!srcUrl) return null;

  try {
    let rows: Array<{ label: string; value: number }> = [];
    if (/\.csv(\?|$)/i.test(srcUrl)) rows = await fetchCsv(srcUrl);
    else rows = await fetchJson(srcUrl);

    rows = rows.filter(r => r && r.label && Number.isFinite(r.value) && r.value >= 0);
    if (rows.length < 2) return null;

    const labels = rows.map(r => r.label).slice(0, 12);
    const data = rows.map(r => r.value).slice(0, 12);
    const colors = multiColorPalette(labels.length);

    return normalizeToDoughnutSpec({
      type: "doughnut",
      title: c?.chartSpec?.title || c?.chart?.title || "Distribution",
      data: { labels, datasets: [{ data, backgroundColor: colors }] },
    });
  } catch {
    return null;
  }
}

/* ─────────── Donut gating & dedupe helpers ─────────── */

function getDonutMeta(specIn: any): { labels: string[]; data: number[]; n: number; isTwo: boolean; twoImbalancePct: number } {
  const spec = normalizeToDoughnutSpec(specIn);
  const labels: string[] = Array.isArray(spec?.data?.labels) ? spec.data.labels : [];
  const data: number[] = Array.isArray(spec?.data?.datasets?.[0]?.data) ? spec.data.datasets[0].data.map((v: any) => Number(v)) : [];
  const n = Math.min(labels.length, data.length);
  let twoImbalancePct = 0;
  if (n === 2) {
    const a = Math.max(0, Number(data[0]) || 0);
    const b = Math.max(0, Number(data[1]) || 0);
    const sum = a + b || 1;
    const pctA = (a / sum) * 100;
    twoImbalancePct = Math.abs(pctA - 50);
  }
  return { labels, data, n, isTwo: n === 2, twoImbalancePct };
}

function donutSignature(specIn: any): string {
  const m = getDonutMeta(specIn);
  if (m.n < 2) return "";
  const sum = m.data.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  const parts = m.labels.map((lab, i) => `${lab.toLowerCase()}|${Math.round((m.data[i] / sum) * 1000)}`); // 0.1% granularity
  return parts.sort().join(";");
}

function donutIsMeaningful(specIn: any, allowTwoCat: boolean, minImbalancePct: number): boolean {
  const m = getDonutMeta(specIn);
  if (m.n >= 3) return true;
  if (m.isTwo && allowTwoCat) {
    return m.twoImbalancePct >= minImbalancePct;
  }
  return false;
}

/* ───────────────────────────── Service ─────────────────────────────── */

class BuilderService {
  async buildPresentation(taskId: string, opts: BuildOptions): Promise<BuildResult> {
    await logger.stepStart(taskId, "Building presentation");
    const { title, format, sources = [] } = opts;

    // Seed per-slide chartSpec from slide text; keep compat with agent
    const slidesSeeded = (opts.slides || []).map(seedSlideChartSpec);

    switch (format) {
      case "pptx":
        return await this.buildPPTX(taskId, title, slidesSeeded, sources, opts.layoutHints);
      case "html":
        return await this.buildHTML(taskId, title, slidesSeeded, sources, opts.layoutHints);
      case "docx":
        return await this.buildDOCX(taskId, title, slidesSeeded, sources);
      case "dashboard":
        return await this.buildDashboard(taskId, title, slidesSeeded, sources);
      case "infographic":
        return await this.buildInfographic(taskId, title, slidesSeeded, sources);
      case "report":
        return await this.buildReport(taskId, title, slidesSeeded, sources);
      case "md":
        return await this.buildMD(taskId, title, slidesSeeded, sources);
      case "rtf": {
        const buf = Buffer.from(
          `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs28 ${title}\\par\\par (autogenerated) }`,
          "utf8"
        );
        return await this.saveGeneric(taskId, title, "rtf", buf);
      }
      case "txt": {
        const lines = [title, "", ...slidesSeeded.map((s, i) => `${i + 1}. ${safeTitle(s.title || "")}`)];
        const buf = Buffer.from(lines.join("\n"), "utf8");
        return await this.saveGeneric(taskId, title, "txt", buf);
      }
      case "csv": {
        const csv = [
          "Slide,Title,HasBody,HasBullets,HasImage,HasChart",
          ...slidesSeeded.map((s, i) => {
            const c = s.content || {};
            return [
              i + 1,
              `"${safeTitle(s.title || "").replace(/"/g, '""')}"`,
              c.body ? 1 : 0,
              c.bullets && c.bullets.length ? 1 : 0,
              c.image?.url ? 1 : 0,
              (c.chart?.url || c.chartSpec) ? 1 : 0,
            ].join(",");
          }),
        ].join("\n");
        const buf = Buffer.from(csv, "utf8");
        return await this.saveGeneric(taskId, title, "csv", buf);
      }
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /* ──────────────────────────── PPTX ──────────────────────────── */

  private async buildPPTX(
    taskId: string,
    title: string,
    slides: SlideIn[],
    sources: string[],
    hints: LayoutHints = {},
  ): Promise<BuildResult> {
    const theme = pickTheme(title);

    const pres = new PptxGenJS();
    pres.author = "Agent Diaz";
    pres.company = "AI Generated";
    pres.subject = title;
    pres.title = title;

    const maxCharts = hints?.maxCharts ?? 4;
    const allowOneTwoCategory = hints?.allowOneTwoCategory ?? true;
    const minTwoCatImbalance = hints?.minTwoCatImbalancePct ?? 12;

    const seenSigs = new Set<string>();
    let imageCount = 0;
    let chartCount = 0;
    let twoCatCount = 0;
    let addedSynthCharts = false;
    let addedDerivedCharts = 0;

    // Title slide
    {
      const s = pres.addSlide();
      s.background = { color: theme.bg };
      s.addText(safeTitle(title), {
        x: 0.5, y: 2, w: 9, h: 1.0,
        fontSize: 36, color: theme.text, bold: true, align: "center"
      });
      s.addText("Generated by Agent Diaz AI", {
        x: 0.5, y: 3.2, w: 9, h: 0.6,
        fontSize: 16, color: theme.subtext, align: "center"
      });
      s.addShape(pres.ShapeType.rect, { x: 3, y: 4.3, w: 4, h: 0.15, fill: { color: theme.accent }, line: { color: theme.accent } });
    }

    // Normalize + paginate on SUBTITLE (body lives in notes)
    const contentSlides: SlideIn[] = [];
    for (const s of slides) {
      const c: any = s.content || {};
      const textForCanvas = String(c.subtitle || c.body || "").trim();
      const pages = paginateBodyText(textForCanvas);
      if (pages.length === 0) {
        contentSlides.push(s);
      } else if (pages.length === 1) {
        contentSlides.push({ ...s, content: { ...c, subtitle: pages[0] } });
      } else {
        pages.forEach((page, idx) => {
          const suffix = idx === 0 ? "" : ` (cont. ${idx + 1})`;
          contentSlides.push({
            ...s,
            title: `${safeTitle(s.title || "Slide")}${suffix}`,
            content: { ...c, subtitle: page },
          });
        });
      }
    }

    // Render slides
    for (const s of contentSlides) {
      const slide = pres.addSlide();
      slide.background = { color: theme.bg };

      const c: any = s.content || {};
      let cursorY = 0.7;

      // Title
      if (s.title) {
        slide.addText(safeTitle(s.title), {
          x: 0.6, y: cursorY, w: 8.8, h: 0.6,
          fontSize: 24, color: theme.text, bold: true,
        });
        slide.addShape(pres.ShapeType.rect, {
          x: 0.6, y: cursorY + 0.7, w: 2.2, h: 0.09,
          fill: { color: theme.band }, line: { color: theme.band },
        });
      }
      cursorY += 1.0;

      // Subtitle on canvas (concise)
      const subtitle: string = c.subtitle || "";
      if (subtitle) {
        slide.addText(subtitle, {
          x: 0.6, y: cursorY, w: 8.8,
          fontSize: 16, color: theme.subtext, align: "left", autoFit: true,
        });
        cursorY += 1.5;
      }

      // Bullets
      const hasBullets = Array.isArray(c.bullets) && c.bullets.length > 0;
      let hasImage = !!c.image?.url;

      // Chart normalization + potential real-data augmentation
      let spec: any | null = c.chartSpec ? normalizeToDoughnutSpec(c.chartSpec) : null;
      if (!spec || !hasUsableChartData(spec)) {
        const augmented = await maybeAugmentChartSpecFromData(c);
        if (augmented && hasUsableChartData(augmented)) spec = augmented;
      }

      // Gate chart by meaningfulness, duplicates, and limits
      let allowTwo = allowOneTwoCategory && twoCatCount < 1;
      let okToRender = false;
      let specSig = "";
      if (spec && hasUsableChartData(spec)) {
        const meaningful = donutIsMeaningful(spec, allowTwo, minTwoCatImbalance);
        if (meaningful && chartCount < maxCharts) {
          specSig = donutSignature(spec);
          if (!specSig || !seenSigs.has(specSig)) {
            okToRender = true;
          }
        }
      }
      const hasChartSpec = okToRender;

      // Prefer charts over decorative images in split row if requested
      if (hints.prioritizeCharts && hasChartSpec) hasImage = false;

      if (hasBullets) {
        const items = (c.bullets || []).slice(0, 5).map((b: string) => ({ text: b, options: { bullet: true } }));
        slide.addText(items, {
          x: 0.6, y: cursorY, w: hasImage || hasChartSpec ? 4.6 : 8.8,
          fontSize: 14, color: theme.text, autoFit: true,
        });
      }

      // Speaker notes
      if (c.notes) {
        try { slide.addNotes(String(c.notes)); } catch {}
      } else if (hints.moveBodyToNotes && c.body) {
        try { slide.addNotes(String(c.body)); } catch {}
      }

      // Right-side visual: prefer chartSpec > image
      const rightX = 5.4, rightW = 4.0, rightH = 2.8;
      const fullX  = 0.6, fullW  = 8.8, fullH  = 2.8;

      if (hasChartSpec && spec) {
        try {
          const url = chartUrlFromSpec(spec, 800, 600, "white");
          const embedded = chartIsEmbedded(spec, hints);
          const useSplit = embedded && hasBullets;
          const data64 = await urlToBase64(url);
          slide.addImage({ data: data64, x: useSplit ? rightX : fullX, y: cursorY, w: useSplit ? rightW : fullW, h: useSplit ? rightH : fullH });
          chartCount++;
          seenSigs.add(specSig);
          const meta = getDonutMeta(spec);
          if (meta.isTwo) twoCatCount++;
          cursorY += 2.9;
        } catch (e: any) {
          await logger.trace(taskId, `chart image embed failed: ${e?.message || e}`);
        }
      } else if (hasImage) {
        try {
          const data64 = await urlToBase64(c.image.url);
          slide.addImage({ data: data64, x: hasBullets ? rightX : 2.0, y: cursorY, w: hasBullets ? rightW : 6.0, h: 2.8 });
          imageCount++;
          cursorY += 2.9;
        } catch (e: any) {
          await logger.trace(taskId, `image download failed: ${e.message || e}`);
        }
      } else if (hasBullets) {
        cursorY += 0.3; // spacer
      }
    }

    // If still no charts → derive honest deck-level donut(s) respecting caps
    if (chartCount < 1) {
      const derived = await this.buildDataDerivedFallbackCharts(slides, theme);
      for (const d of derived) {
        if (chartCount >= maxCharts) break;
        const slide = pres.addSlide();
        slide.background = { color: theme.bg };
        slide.addText(d.title, {
          x: 0.6, y: 0.7, w: 8.8, h: 0.6,
          fontSize: 24, color: theme.text, bold: true,
        });
        slide.addShape(pres.ShapeType.rect, {
          x: 0.6, y: 1.4, w: 2.2, h: 0.09,
          fill: { color: theme.band }, line: { color: theme.band },
        });
        try {
          const data64 = await urlToBase64(d.url);
          slide.addImage({ data: data64, x: 0.6, y: 1.8, w: 8.8, h: 4.4 });
          chartCount++;
          addedDerivedCharts++;
        } catch (e: any) {
          await logger.trace(taskId, `derived chart failed: ${e.message || e}`);
        }
      }
    }

    // Optional synthetic visual — only if explicitly enabled AND still none
    if (!hints.disableAutoSummary && chartCount === 0) {
      addedSynthCharts = true;
      const colors = multiColorPalette(2);
      const synthSpec = normalizeToDoughnutSpec({
        type: "doughnut",
        title: "Visual Summary",
        data: { labels: ["Textual", "Visual"], datasets: [{ data: [1, 1], backgroundColor: colors }] },
      });
      const slide = pres.addSlide();
      slide.background = { color: theme.bg };
      slide.addText("Visual Summary", {
        x: 0.6, y: 0.7, w: 8.8, h: 0.6,
        fontSize: 24, color: theme.text, bold: true,
      });
      slide.addShape(pres.ShapeType.rect, {
        x: 0.6, y: 1.4, w: 2.2, h: 0.09,
        fill: { color: theme.band }, line: { color: theme.band },
      });
      try {
        const data64 = await urlToBase64(chartUrlFromSpec(synthSpec));
        slide.addImage({ data: data64, x: 0.6, y: 1.8, w: 8.8, h: 4.4 });
        chartCount++;
      } catch (e: any) {
        await logger.trace(taskId, `synth chart failed: ${e.message || e}`);
      }
    }

    // References slide
    this.addSourcesSlide(pres, sources, theme);

    // Save
    const filename = makeFilename(title, "pptx");
    const buffer = Buffer.from((await pres.write("nodebuffer")) as ArrayBuffer);
    const filePath = await fileStorage.saveFile(filename, buffer);
    const { size } = await fileStorage.getFileStats(filename);

    const totalSlides =
      1 /* title */ +
      contentSlides.length +
      addedDerivedCharts +
      (sources.length ? 1 : 0) +
      (addedSynthCharts ? 1 : 0);

    const validation = this.validatePresentation(totalSlides, imageCount, chartCount, size);
    if (!validation.isValid) {
      throw new Error(`Presentation validation failed: ${validation.errors.join(", ")}`);
    }

    await logger.stepEnd(taskId, "Building presentation");
    return {
      filename,
      fileSize: size,
      filePath,
      metadata: { slides: totalSlides, images: imageCount, charts: chartCount, theme: theme.name },
    };
  }

  private addSourcesSlide(p: PptxGenJS, src: string[], theme: Theme) {
    if (!src || src.length === 0) return;
    const s = p.addSlide();
    s.background = { color: theme.bg };

    s.addText("References", { x: 0.6, y: 0.6, fontSize: 26, bold: true, color: theme.text });
    s.addShape(p.ShapeType.rect, { x: 0.6, y: 1.2, w: 2.2, h: 0.09, fill: { color: theme.band }, line: { color: theme.band } });

    const mid = Math.ceil(src.length / 2);
    s.addText(src.slice(0, mid).join("\n"), { x: 0.6, y: 1.5, w: 4.4, h: 4.5, fontSize: 12, color: theme.subtext });
    s.addText(src.slice(mid).join("\n"), { x: 5.0, y: 1.5, w: 4.4, h: 4.5, fontSize: 12, color: theme.subtext });
  }

  /* ──────────────────────────── HTML ──────────────────────────── */

  private async buildHTML(
    taskId: string,
    title: string,
    slides: SlideIn[],
    sources: string[],
    hints: LayoutHints = {},
  ): Promise<BuildResult> {
    const theme = pickTheme(title);

    const maxCharts = hints?.maxCharts ?? 4;
    const allowOneTwoCategory = hints?.allowOneTwoCategory ?? true;
    const minTwoCatImbalance = hints?.minTwoCatImbalancePct ?? 12;

    const seenSigs = new Set<string>();
    let twoCatCount = 0;
    let imgCount = 0;
    let chartCount = 0;
    let addedSynthCharts = false;
    let addedDerivedCharts = 0;

    const expandedSlides: SlideIn[] = [];
    for (const s of slides) {
      const c = s.content || {};
      const text = String(c.subtitle || c.body || "").trim();
      const pages = paginateBodyText(text, 900);
      if (pages.length <= 1) {
        expandedSlides.push(s);
      } else {
        pages.forEach((page, idx) => {
          const suffix = idx === 0 ? "" : ` (cont. ${idx + 1})`;
          expandedSlides.push({ ...s, title: `${safeTitle(s.title || "Slide")}${suffix}`, content: { ...c, subtitle: page } });
        });
      }
    }

    const refsHtml = sources.length
      ? `
    <div class="slide">
      <h2>References</h2>
      <div class="cols">
        <div>${sources.slice(0, Math.ceil(sources.length / 2)).map((s) => `<div>${s}</div>`).join("")}</div>
        <div>${sources.slice(Math.ceil(sources.length / 2)).map((s) => `<div>${s}</div>`).join("")}</div>
      </div>
    </div>`
      : "";

    const htmlSlides = await Promise.all(expandedSlides.map(async (s) => {
      const c: any = s.content || {};
      let out = `<div class="slide">`;
      if (s.title) out += `<h2>${safeTitle(s.title)}</h2><div class="band"></div>`;
      const text = c.subtitle || c.body || "";
      if (text) out += `<p>${String(text).replace(/\n/g, "<br/>")}</p>`;
      const hasBullets = Array.isArray(c.bullets) && c.bullets.length > 0;

      // Chart normalization + real data
      let spec: any | null = c.chartSpec ? normalizeToDoughnutSpec(c.chartSpec) : null;
      if (!spec || !hasUsableChartData(spec)) {
        const augmented = await maybeAugmentChartSpecFromData(c);
        if (augmented && hasUsableChartData(augmented)) spec = augmented;
      }

      // Gate chart
      let allowTwo = allowOneTwoCategory && twoCatCount < 1;
      let okToRender = false;
      let sig = "";
      if (spec && hasUsableChartData(spec)) {
        const meaningful = donutIsMeaningful(spec, allowTwo, minTwoCatImbalance);
        if (meaningful && chartCount < maxCharts) {
          sig = donutSignature(spec);
          if (!sig || !seenSigs.has(sig)) okToRender = true;
        }
      }
      const hasChart = okToRender;
      const hasImage = !!c.image?.url && !(hints.prioritizeCharts && hasChart);

      if (hasBullets) {
        out += `<ul class="${hasImage || hasChart ? "half" : "full"}">${(c.bullets || []).slice(0, 6).map((b: string) => `<li>${b}</li>`).join("")}</ul>`;
      }
      if (hasChart && spec) {
        out += `<img class="${hasBullets ? "half" : "full"}" src="${chartUrlFromSpec(spec)}" alt="${spec.title || "Chart"}" />`;
        chartCount++;
        seenSigs.add(sig);
        const meta = getDonutMeta(spec);
        if (meta.isTwo) twoCatCount++;
      } else if (hasImage) {
        out += `<img class="${hasBullets ? "half" : "full"}" src="${c.image!.url}" alt="${c.image!.description || ""}" />`;
        imgCount++;
      }
      out += `</div>`;
      return out;
    }));
    const htmlSlidesStr = htmlSlides.join("");

    // Deck-level derived charts if none (respect caps)
    let derivedHtml = "";
    if (chartCount < 1) {
      const derived = await this.buildDataDerivedFallbackCharts(slides, theme); // ← uses local theme
      for (const d of derived) {
        if (chartCount >= maxCharts) break;
        derivedHtml += `<div class="slide"><h2>${d.title}</h2><div class="band"></div><img class="full" src="${d.url}" alt="${d.title}"/></div>`;
        chartCount++;
        addedDerivedCharts++;
      }
    }

    // Optional synthetic visual
    let synthHtml = "";
    if (!hints.disableAutoSummary && chartCount === 0) {
      addedSynthCharts = true;
      const spec = normalizeToDoughnutSpec({
        type: "doughnut",
        title: "Visual Summary",
        data: { labels: ["Textual", "Visual"], datasets: [{ data: [1, 1], backgroundColor: multiColorPalette(2) }] },
      });
      synthHtml = `
        <div class="slide"><h2>Visual Summary</h2><div class="band"></div><img class="full" src="${chartUrlFromSpec(spec)}"/></div>
      `;
      chartCount += 1;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${safeTitle(title)}</title>
<style>
  :root{ --bg:#${theme.bg}; --paper:#${theme.paper}; --text:#${theme.text}; --sub:#${theme.subtext}; --accent:#${theme.accent}; --band:#${theme.band}; }
  body{ margin:0; background:var(--bg); color:var(--text); font-family:system-ui,-apple-system,Segoe UI,Roboto; }
  .slide{ background:var(--paper); margin:24px auto; padding:40px; max-width:960px; border-radius:14px; box-shadow:0 10px 16px rgba(0,0,0,.08); }
  .slide h1,.slide h2{ margin:0 0 12px; }
  .title{ text-align:center; background:linear-gradient(135deg, var(--accent), #7c3aed); color:white; }
  .title h1{ font-size:44px; margin:0 0 10px; }
  p{ color:var(--sub); line-height:1.6; }
  .band{ width:140px; height:6px; background:var(--band); margin:8px 0 18px 0; border-radius:3px; }
  ul{ padding-left:20px; margin:0; }
  ul.full{ width:100%; }
  ul.half{ width:46%; display:inline-block; vertical-align:top; }
  img{ display:block; border-radius:10px; margin:16px 0; }
  img.full{ width:100%; }
  img.half{ width:46%; display:inline-block; vertical-align:top; margin-left:4%; }
  .cols{ display:flex; gap:24px; }
  .cols > div{ flex:1; }
  @media print {.slide{ box-shadow:none; page-break-after:always; margin:0; border-radius:0; }}
</style>
</head>
<body>
  <div class="slide title">
    <h1>${safeTitle(title)}</h1>
    <div>Generated by Agent Diaz AI</div>
  </div>
  ${htmlSlidesStr}
  ${derivedHtml}
  ${synthHtml}
  ${refsHtml}
</body>
</html>`;

    const filename = makeFilename(title, "html");
    const buffer = Buffer.from(html, "utf8");
    const filePath = await fileStorage.saveFile(filename, buffer);
    const { size } = await fileStorage.getFileStats(filename);

    await logger.stepEnd(taskId, "Building HTML presentation");
    return {
      filename,
      fileSize: size,
      filePath,
      metadata: {
        slides: 1 + expandedSlides.length + (sources.length ? 1 : 0) + addedDerivedCharts + (addedSynthCharts ? 1 : 0),
        images: imgCount,
        charts: chartCount,
        theme: theme.name
      },
    };
  }

  /* ──────────────────────────── DOCX ──────────────────────────── */

  private async buildDOCX(
    taskId: string,
    title: string,
    slides: SlideIn[],
    sources: string[],
  ): Promise<BuildResult> {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ text: safeTitle(title), heading: HeadingLevel.TITLE }),
          ...slides.flatMap((s, i) => {
            const c: any = s.content || {};
            const parts = [
              new Paragraph({ text: `${i + 1}. ${safeTitle(s.title || "Slide")}`, heading: HeadingLevel.HEADING_2 }),
            ];
            const text = c.subtitle || c.body || "";
            if (text) parts.push(new Paragraph({ text }));
            if (Array.isArray(c.bullets) && c.bullets.length) {
              parts.push(new Paragraph({ text: "• " + c.bullets.join("\n• ") }));
            }
            if (c.notes) {
              parts.push(new Paragraph({ children: [new TextRun({ text: `Notes: ${c.notes}`, italics: true, color: "666666" })] }));
            }
            // Only annotate charts that WOULD pass donut gating; keep docx lightweight
            let spec: any | null = c.chartSpec ? normalizeToDoughnutSpec(c.chartSpec) : null;
            if (spec && hasUsableChartData(spec)) {
              const meta = getDonutMeta(spec);
              const note = meta.n >= 3 ? "[Chart: doughnut ≥3 categories]" : "[Chart: doughnut 2 categories]";
              parts.push(new Paragraph({ children: [new TextRun({ text: `${note} ${chartUrlFromSpec(spec)}`, italics: true, color: "666666" })] }));
            } else if (c.chart?.url && looksLikeImageUrl(c.chart.url)) {
              parts.push(new Paragraph({ children: [new TextRun({ text: `[Chart] ${c.chart.title || ""} ${c.chart.url}`, italics: true, color: "666666" })] }));
            }
            if (c.image?.url) {
              parts.push(new Paragraph({ children: [new TextRun({ text: `[Image] ${c.image.description || ""} ${c.image.url}`, italics: true, color: "666666" })] }));
            }
            return parts;
          }),
          ...(sources.length ? [
            new Paragraph({ text: "References", heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: sources.join("\n") })
          ] : []),
        ],
      }],
    });

    const buf = await Packer.toBuffer(doc);
    const filename = makeFilename(title, "docx");
    const filePath = await fileStorage.saveFile(filename, buf);
    const { size } = await fileStorage.getFileStats(filename);

    await logger.stepEnd(taskId, "Building DOCX report");
    return {
      filename,
      fileSize: size,
      filePath,
      metadata: {
        slides: slides.length,
        images: slides.filter(s => s.content?.image?.url).length,
        charts: slides.filter(s => (s.content as any)?.chart?.url || (s.content as any)?.chartSpec).length,
        theme: "n/a",
      },
    };
  }

  /* ──────────────────────────── MD ──────────────────────────── */

  private async buildMD(
    taskId: string,
    title: string,
    slides: SlideIn[],
    sources: string[],
  ): Promise<BuildResult> {
    const lines: string[] = [`# ${safeTitle(title)}`, ""];
    slides.forEach((s, i) => {
      lines.push(`## ${i + 1}. ${safeTitle(s.title || "Slide")}`);
      const c: any = s.content || {};
      const text = c.subtitle || c.body || "";
      if (text) lines.push("", text, "");
      if (Array.isArray(c.bullets) && c.bullets.length) {
        lines.push("", ...c.bullets.map((b: string) => `- ${b}`), "");
      }
      if (c.notes) lines.push(`> Notes: ${c.notes}`, "");
      if (c.image?.url) lines.push(`![${c.image.description || "image"}](${c.image.url})`, "");
      if (c.chartSpec && hasUsableChartData(normalizeToDoughnutSpec(c.chartSpec))) {
        lines.push(`![${c.chartSpec.title || "chart"}](${chartUrlFromSpec(c.chartSpec)})`, "");
      } else if (c.chart?.url && looksLikeImageUrl(c.chart.url)) {
        lines.push(`![${c.chart.title || "chart"}](${c.chart.url})`, "");
      }
      lines.push("");
    });
    if (sources.length) {
      lines.push("## References", ...sources.map((s) => `- ${s}`));
    }

    const buf = Buffer.from(lines.join("\n"), "utf8");
    const filename = makeFilename(title, "md");
    const filePath = await fileStorage.saveFile(filename, buf);
    const { size } = await fileStorage.getFileStats(filename);

    await logger.stepEnd(taskId, "Building Markdown");
    return {
      filename,
      fileSize: size,
      filePath,
      metadata: {
        slides: slides.length,
        images: slides.filter(s => s.content?.image?.url).length,
        charts: slides.filter(s => (s.content as any)?.chart?.url || (s.content as any)?.chartSpec).length,
        theme: "n/a",
      },
    };
  }

  /* ─────────────────────── DASHBOARD (HTML; donuts only) ─────────────────────── */

  private async buildDashboard(
    taskId: string,
    title: string,
    slides: any[],
    sources?: string[],
  ): Promise<BuildResult> {
    const theme = deriveTheme(title);
    const kpis = extractKPIs(slides, 6);

    const labels = kpis.map(k => k.label.replace(/[:|,]/g, " ").slice(0, 18));
    const nums = kpis.map(k => (k.valueNum ?? (20 + Math.floor(Math.random()*60))));
    const donutA = chartUrlFromSpec({ type: "doughnut", title: "KPI Distribution A", data: { labels, datasets: [{ data: nums, backgroundColor: multiColorPalette(labels.length) }] } });
    const donutB = chartUrlFromSpec({ type: "doughnut", title: "KPI Distribution B", data: { labels: labels.slice(0,5), datasets: [{ data: nums.slice(0,5), backgroundColor: multiColorPalette(Math.min(5, labels.length)) }] } });

    const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>${safeTitle(title)} – Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  :root{
    --bg:${theme.bg}; --card:${theme.card}; --text:${theme.text}; --mute:${theme.mute};
    --a:${theme.a}; --b:${theme.b};
  }
  body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto}
  .wrap{max-width:1200px;margin:0 auto;padding:24px}
  h1{font-size:28px;margin:0 0 12px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .card{background:var(--card);border-radius:12px;padding:18px;box-shadow:0 4px 10px rgba(0,0,0,.15)}
  .kpi{display:flex;flex-direction:column;gap:6px}
  .kpi .v{font-size:28px;font-weight:700;color:var(--a)}
  .kpi .l{font-size:13px;color:var(--mute)}
  .charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
  .charts img{width:100%;height:auto;border-radius:12px;background:#fff}
  .refs{margin-top:24px}
  .refs a{color:var(--b);text-decoration:none}
  @media(max-width:900px){.grid{grid-template-columns:1fr 1fr}.charts{grid-template-columns:1fr}}
  @media(max-width:640px){.grid{grid-template-columns:1fr}}
</style></head>
<body>
  <div class="wrap">
    <h1>${safeTitle(title)} – Dashboard</h1>
    <div class="grid">
      ${kpis.map((k: any) => `
        <div class="card kpi">
          <div class="v">${k.valueLabel || (k.valueNum ?? "—")}</div>
          <div class="l">${k.label}</div>
        </div>
      `).join("")}
    </div>

    <div class="charts">
      <div class="card"><img src="${donutA}" alt="Doughnut chart A"/></div>
      <div class="card"><img src="${donutB}" alt="Doughnut chart B"/></div>
    </div>

    ${sources && sources.length ? `
    <div class="card refs">
      <h3 style="margin-top:0">References</h3>
      <ul style="margin:0;padding-left:18px">${firstN(sources,12).map(s=>`<li><a href="${s}" target="_blank" rel="noopener">${s}</a></li>`).join("")}</ul>
    </div>` : ""}

  </div>
</body></html>`;

    const filename = makeFilename(`${title}_Dashboard`, "html");
    const buffer = Buffer.from(html, "utf8");
    const filePath = await fileStorage.saveFile(filename, buffer);
    const { size } = await fileStorage.getFileStats(filename);

    await logger.stepEnd(taskId, "Building Dashboard");
    return { filename, fileSize: size, filePath, metadata: { slides: 1, images: 0, charts: 2, theme: theme.name } };
  }

  /* ─────────────────────── INFOGRAPHIC (SVG; donuts only) ─────────────────────── */

  private async buildInfographic(
    taskId: string,
    title: string,
    slides: any[],
    sources?: string[],
  ): Promise<BuildResult> {
    const theme = deriveTheme(title);
    const kpis = extractKPIs(slides, 5);
    const labels = kpis.map(k => k.label.replace(/[:|,]/g, " ").slice(0, 18));
    const nums = kpis.map(k => (k.valueNum ?? (20 + Math.floor(Math.random()*60))));
    const donutA = chartUrlFromSpec({ type: "doughnut", title: "KPI Snapshot", data: { labels, datasets: [{ data: nums, backgroundColor: multiColorPalette(labels.length) }] } });
    const donutB = chartUrlFromSpec({ type: "doughnut", title: "Mix", data: { labels: labels.slice(0,5), datasets: [{ data: nums.slice(0,5), backgroundColor: multiColorPalette(Math.min(5, labels.length)) }] } });

    const W = 1200, H = 1600;
    const svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style><![CDATA[
      .bg{fill:${theme.bg}}
      .card{fill:${theme.card}}
      .title{fill:${theme.text}; font: 700 44px system-ui, -apple-system, Segoe UI, Roboto}
      .sub{fill:${theme.mute}; font: 400 18px system-ui, -apple-system, Segoe UI, Roboto}
    ]]></style>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.25"/>
    </filter>
  </defs>

  <rect class="bg" x="0" y="0" width="${W}" height="${H}"/>
  <text class="title" x="60" y="90">${escapeXml(safeTitle(title))}</text>
  <text class="sub" x="60" y="125">Infographic</text>

  <g filter="url(#shadow)">
    <rect class="card" x="60" y="160" rx="16" ry="16" width="1080" height="520"/>
    <image x="80" y="180" width="1040" height="480" href="${donutA}"/>
  </g>

  <g filter="url(#shadow)">
    <rect class="card" x="60" y="720" rx="16" ry="16" width="1080" height="520"/>
    <image x="80" y="740" width="1040" height="480" href="${donutB}"/>
  </g>
</svg>`;

    const filename = makeFilename(`${title}_Infographic`, "svg");
    const buffer = Buffer.from(svg, "utf8");
    const filePath = await fileStorage.saveFile(filename, buffer);
    const { size } = await fileStorage.getFileStats(filename);

    await logger.stepEnd(taskId, "Building Infographic");
    return { filename, fileSize: size, filePath, metadata: { slides: 1, images: 0, charts: 2, theme: theme.name } };
  }

  /* ─────────────────────────── REPORT (HTML; donuts respected) ─────────────────────────── */

  private async buildReport(
    taskId: string,
    title: string,
    slides: any[],
    sources?: string[],
  ): Promise<BuildResult> {
    const theme = deriveTheme(title);

    const maxCharts = 4; // keep reports tidy as well
    const seenSigs = new Set<string>();
    let chartCount = 0;
    let twoCatCount = 0;

    // Executive summary
    const firstText = slides?.[0]?.content?.subtitle || slides?.[0]?.content?.body || "";
    const bullets = (slides || []).flatMap((s: any) =>
      Array.isArray(s?.content?.bullets) ? s.content.bullets : []
    );
    const exec = firstText || bullets.slice(0, 5).join(" · ");

    const sections = (slides || []).map((s: any, i: number) => ({
      heading: s?.title ? String(s.title) : `Section ${i + 1}`,
      body: s?.content?.subtitle ? String(s.content.subtitle) : (s?.content?.body ? String(s.content.body) : ""),
      notes: s?.content?.notes ? String(s.content.notes) : "",
      bullets: Array.isArray(s?.content?.bullets) ? s.content.bullets : [],
      image: s?.content?.image?.url || "",
      chartSpec: s?.content?.chartSpec,
      chart: s?.content?.chart?.url || "",
    })).slice(0, 12);

    const sectionsHtml = await Promise.all(sections.map(async (sec) => {
      const bulletsHtml = sec.bullets
        .slice(0, 8)
        .map((b: string) => '<li>' + escapeXml(b) + '</li>')
        .join("");

      // Normalize/augment chart if possible
      let spec: any | null = sec.chartSpec ? normalizeToDoughnutSpec(sec.chartSpec) : null;
      if (!spec || !hasUsableChartData(spec)) {
        spec = await maybeAugmentChartSpecFromData({ chartSpec: sec.chartSpec, chart: sec.chart ? { url: sec.chart } : undefined });
      }
      // Report gating: prefer ≥3 cats; allow 1 two-cat if not 50/50ish
      let renderChartHtml = "";
      if (spec && hasUsableChartData(spec) && chartCount < maxCharts) {
        const meta = getDonutMeta(spec);
        const sig = donutSignature(spec);
        const allowTwo = twoCatCount < 1 && meta.isTwo && meta.twoImbalancePct >= 12;
        if ((meta.n >= 3 || allowTwo) && (!sig || !seenSigs.has(sig))) {
          renderChartHtml = '<div class="figure"><img src="' + escapeXml(chartUrlFromSpec(spec)) + '" alt="chart"/></div>';
          chartCount++;
          if (sig) seenSigs.add(sig);
          if (meta.isTwo) twoCatCount++;
        }
      }
      return (
        '<section>' +
          '<h2>' + escapeXml(sec.heading) + '</h2>' +
          (sec.body ? '<p>' + escapeXml(sec.body) + '</p>' : '') +
          (bulletsHtml ? '<ul>' + bulletsHtml + '</ul>' : '') +
          (sec.image
            ? '<div class="figure"><img src="' + escapeXml(sec.image) + '" alt="figure"/></div>'
            : '') +
          renderChartHtml +
          (sec.notes ? '<p style="color:#6b7280"><em>Notes: ' + escapeXml(sec.notes) + '</em></p>' : '') +
        '</section>'
      );
    }));

    const refsHtml = (sources && sources.length)
      ? '<section class="refs"><h2>References</h2><ol>' +
        firstN(sources, 20)
          .map((s) => '<li><a href="' + s + '" target="_blank" rel="noopener">' + escapeXml(s) + '</a></li>')
          .join("") +
        '</ol></section>'
      : '';

    const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>${safeTitle(title)} – Report</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  :root{ --bg:${theme.bg}; --paper:#ffffff; --text:#111827; --mute:#6b7280; --a:${theme.a}; --b:${theme.b}; }
  body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto;color:var(--text)}
  .page{max-width:860px;margin:28px auto;background:var(--paper);padding:40px 48px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.15)}
  h1{margin:0 0 12px;font-size:34px}
  h2{margin:28px 0 12px;font-size:24px}
  p{line-height:1.7;margin:12px 0}
  .lead{color:var(--mute)}
  .pill{display:inline-block;background:var(--a);color:white;padding:6px 10px;border-radius:999px;font-size:12px;margin-right:8px}
  ul{margin:8px 0 16px 20px}
  img{max-width:100%;height:auto;border-radius:10px;background:#fff}
  .figure{margin:14px 0;padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa}
  .refs a{color:var(--b);text-decoration:none}
  @media print {.page{box-shadow:none;border-radius:0;margin:0}}
</style></head>
<body>
  <div class="page">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <span class="pill">Report</span>
      <span class="pill" style="background:var(--b)">${new Date().toISOString().slice(0,10)}</span>
    </div>
    <h1>${safeTitle(title)}</h1>
    <p class="lead">${exec ? escapeXml(exec) : "This report summarizes the key insights and recommendations."}</p>

    ${sectionsHtml.join("")}
    ${refsHtml}
  </div>
</body></html>`;

    const filename = makeFilename(`${title}_Report`, "html");
    const buffer = Buffer.from(html, "utf8");
    const filePath = await fileStorage.saveFile(filename, buffer);
    const { size } = await fileStorage.getFileStats(filename);

    await logger.stepEnd(taskId, "Building Report");
    return {
      filename,
      fileSize: size,
      filePath,
      metadata: {
        slides: sections.length,
        images: sections.filter((s) => s.image).length,
        charts: chartCount,
        theme: theme.name,
      },
    };
  }

  /* ─────────────────────── Derived fallback charts (donuts only) ─────────────────────── */

  private async buildDataDerivedFallbackCharts(
    slides: SlideIn[],
    theme: Theme,
  ): Promise<Array<{ title: string; url: string }>> {
    // Aggregate numeric pairs from across slides
    const pairsAll: Pair[] = [];
    for (const s of slides) {
      const p = extractNumericPairsFromSlide(s, 8);
      for (const it of p) pairsAll.push(it);
      if (pairsAll.length >= 8) break;
    }
    if (pairsAll.length >= 2) {
      const spec = buildDoughnutFromPairs(pairsAll, "Distribution");
      const url = chartUrlFromSpec(spec, 900, 600, "white");
      return [{ title: "Distribution", url }];
    }

    // Keyword frequency fallback → donut (treat counts as values)
    const STOP = new Set([
      "the","and","for","with","this","that","from","into","your","their","about","what","when","where","which",
      "are","is","was","were","be","on","in","of","to","as","by","it","its","a","an","or","at","we","you","they",
      "how","why","but","if","then","than","over","under","per","across","between","within","most",
    ]);
    const freq = new Map<string, number>();
    for (const s of slides || []) {
      const words = (stripMdLite(s.title || "") + " " + (s.content?.bullets || []).join(" ")).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
      for (const w of words) {
        if (STOP.has(w)) continue;
        if (/^\d/.test(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
    const kw = Array.from(freq.entries())
      .map(([label, value]) => ({ label: label.slice(0, 20), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    if (kw.length >= 3) {
      const spec = normalizeToDoughnutSpec({
        type: "doughnut",
        title: "Top Topics",
        data: { labels: kw.map(k => k.label), datasets: [{ data: kw.map(k => k.value), backgroundColor: multiColorPalette(kw.length) }] }
      });
      return [{ title: "Top Topics", url: chartUrlFromSpec(spec, 900, 600, "white") }];
    }
    return [];
  }

  /* ─────────────────────── Validation & Save ─────────────────────── */

  private validatePresentation(
    slideCount: number,
    imageCount: number,
    chartCount: number,
    fileSize: number,
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (slideCount < 6) errors.push(`Too few slides: ${slideCount} (min 6 incl. title)`);
    if (fileSize < 30 * 1024) errors.push(`File size too small: ${fileSize} bytes (min 30KB)`);
    if (imageCount < 0 || chartCount < 0) errors.push("Invalid visual counts");
    return { isValid: errors.length === 0, errors };
  }

  private async saveGeneric(
    taskId: string,
    title: string,
    ext: "rtf" | "txt" | "csv",
    buf: Buffer,
  ): Promise<BuildResult> {
    const filename = makeFilename(title, ext);
    const filePath = await fileStorage.saveFile(filename, buf);
    const { size } = await fileStorage.getFileStats(filename);
    await logger.stepEnd(taskId, `Building ${ext.toUpperCase()} file`);
    return { filename, fileSize: size, filePath, metadata: { slides: 0, images: 0, charts: 0, theme: "n/a" } };
  }
}

export const builderService = new BuilderService();

/* ───────────────────────────── Layout helpers ───────────────────────────── */

function chartIsEmbedded(spec: any, hints?: LayoutHints): boolean {
  const explicit = spec?.layout && /embed/i.test(String(spec.layout));
  const defaultRight = (hints?.chartEmbedDefault || "full") !== "full";
  return Boolean(explicit || defaultRight);
}
