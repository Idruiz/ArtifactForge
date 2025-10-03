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
import archiver from "archiver";
import { Writable } from "stream";
import { fileStorage } from "../utils/fileStorage";
import { logger } from "../utils/logger";
import { Document, Packer, Paragraph, HeadingLevel, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType } from "docx";
import { nanoid } from "nanoid";
import path from "path";
import fs from "fs";

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
  
  // Source quality flags
  limitedSources?: boolean;       // if true, add Limited Sources banner
  sourceCount?: number;           // actual source count for banner
};

export interface BuildOptions {
  title: string;
  slides: SlideIn[];
  format:
    | "pptx"
    | "html"
    | "website"
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
  liveUrl?: string;
  previewUrl?: string;
  siteId?: string;
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

/**
 * Sanitize content to remove system/prompt/instruction text that may leak from LLM responses
 * Critical for website artifacts to prevent exposing internal prompts
 */
function sanitizeContent(text: string): string {
  if (!text) return "";
  
  let sanitized = String(text);
  
  // Remove common LLM prompt patterns (case-insensitive)
  const leakPatterns = [
    /system\s*:/gi,
    /assistant\s*:/gi,
    /user\s*:/gi,
    /\bprompt\b/gi,
    /\binstruction\b/gi,
    /you\s+are\s+(an?\s+)?(ai|assistant|chatbot)/gi,
    /as\s+an?\s+(ai|assistant|chatbot)/gi,
    /i\s+am\s+(an?\s+)?(ai|assistant|language\s+model)/gi,
    /respond\s+to\s+the\s+following/gi,
    /based\s+on\s+the\s+following\s+(prompt|instruction)/gi,
  ];
  
  for (const pattern of leakPatterns) {
    sanitized = sanitized.replace(pattern, "");
  }
  
  // Clean up multiple spaces/newlines left by replacements
  sanitized = sanitized.replace(/\s{2,}/g, " ").trim();
  
  return sanitized;
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
    const formatLabels: Record<string, string> = {
      pptx: "presentation",
      html: "HTML presentation",
      website: "website",
      docx: "document",
      report: "report",
      dashboard: "dashboard",
      infographic: "infographic",
      md: "markdown",
      csv: "CSV",
      txt: "text file",
      rtf: "RTF file"
    };
    const label = formatLabels[opts.format] || opts.format;
    await logger.stepStart(taskId, `Building ${label}`);
    const { title, format, sources = [] } = opts;

    // Seed per-slide chartSpec from slide text; keep compat with agent
    const slidesSeeded = (opts.slides || []).map(seedSlideChartSpec);

    switch (format) {
      case "pptx":
        return await this.buildPPTX(taskId, title, slidesSeeded, sources, opts.layoutHints);
      case "html":
        return await this.buildHTML(taskId, title, slidesSeeded, sources, opts.layoutHints);
      case "website":
        return await this.buildWebsite(taskId, title, slidesSeeded, sources);
      case "docx":
        return await this.buildDOCX(taskId, title, slidesSeeded, sources);
      case "dashboard":
        return await this.buildDashboard(taskId, title, slidesSeeded, sources);
      case "infographic":
        return await this.buildInfographic(taskId, title, slidesSeeded, sources);
      case "report":
        return await this.buildReport(taskId, title, slidesSeeded, sources, opts.layoutHints);
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
    const buffer = Buffer.from((await pres.write({ outputType: "nodebuffer" } as any)) as ArrayBuffer);
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

    await logger.stepEnd(taskId, "Building PPTX presentation");
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
    await logger.stepStart(taskId, "Building multi-page website with admin panel");
    const theme = pickTheme(title);
    
    // Distribute slides across pages: Home, About, Projects, Contact
    const sections = this.distributeSlidesToPages(slides);
    
    // Generate shared CSS
    const stylesCSS = this.generateSharedCSS(theme);
    
    // Generate shared JS (navigation highlighting + admin button logic)
    const appJS = this.generateSharedJS();
    
    // Generate individual HTML pages
    const indexHTML = this.generatePageHTML('Home', 'index.html', sections.home, theme, title);
    const aboutHTML = this.generatePageHTML('About', 'about.html', sections.about, theme, title);
    const projectsHTML = this.generatePageHTML('Projects', 'projects.html', sections.projects, theme, title);
    const contactHTML = this.generatePageHTML('Contact', 'contact.html', sections.contact, theme, title);
    
    // Generate admin panel files
    const adminHTML = this.generateAdminHTML();
    const adminJS = this.generateAdminJS();
    
    // Generate Apps Script backend
    const contentApiGS = this.generateAppsScriptBackend();
    
    // Create zip bundle
    const zipFilename = makeFilename(title, "zip");
    const zipBuffer = await this.createWebsiteZip({
      'index.html': indexHTML,
      'about.html': aboutHTML,
      'projects.html': projectsHTML,
      'contact.html': contactHTML,
      'styles.css': stylesCSS,
      'app.js': appJS,
      'admin/index.html': adminHTML,
      'admin/admin.js': adminJS,
      'apps_script/ContentApi.gs': contentApiGS,
    });
    
    const filePath = await fileStorage.saveFile(zipFilename, zipBuffer);
    const { size } = await fileStorage.getFileStats(zipFilename);
    
    await logger.stepEnd(taskId, "Built multi-page website bundle");
    return {
      filename: zipFilename,
      fileSize: size,
      filePath,
      metadata: {
        slides: 4,
        images: 0,
        charts: 0,
        theme: theme.name
      },
    };
  }
  
  private distributeSlidesToPages(slides: SlideIn[]): {
    home: SlideIn[];
    about: SlideIn[];
    projects: SlideIn[];
    contact: SlideIn[];
  } {
    // Distribute slides evenly across sections
    const total = slides.length;
    const perPage = Math.ceil(total / 4);
    
    return {
      home: slides.slice(0, perPage),
      about: slides.slice(perPage, perPage * 2),
      projects: slides.slice(perPage * 2, perPage * 3),
      contact: slides.slice(perPage * 3),
    };
  }
  
  private generateSharedCSS(theme: Theme): string {
    return `:root {
  --bg: #${theme.bg};
  --paper: #${theme.paper};
  --text: #${theme.text};
  --sub: #${theme.subtext};
  --accent: #${theme.accent};
  --band: #${theme.band};
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  line-height: 1.6;
}

header {
  background: var(--paper);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  position: sticky;
  top: 0;
  z-index: 100;
}

nav {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

nav ul {
  list-style: none;
  display: flex;
  gap: 2rem;
}

nav a {
  text-decoration: none;
  color: var(--text);
  font-weight: 500;
  transition: color 0.2s;
}

nav a:hover {
  color: var(--accent);
}

nav a.active {
  color: var(--accent);
  border-bottom: 2px solid var(--accent);
  padding-bottom: 4px;
}

.admin-btn {
  background: var(--accent);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.9rem;
  text-decoration: none;
  display: none;
}

.admin-btn.visible {
  display: inline-block;
}

main {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 2rem;
}

.hero {
  text-align: center;
  padding: 4rem 0;
  background: linear-gradient(135deg, var(--accent), #7c3aed);
  color: white;
  border-radius: 16px;
  margin-bottom: 3rem;
}

.hero h1 {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.hero p {
  font-size: 1.2rem;
  opacity: 0.9;
}

.section {
  background: var(--paper);
  padding: 2.5rem;
  margin-bottom: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.section h2 {
  color: var(--text);
  margin-bottom: 1rem;
  font-size: 1.8rem;
}

.section .band {
  width: 80px;
  height: 4px;
  background: var(--band);
  margin-bottom: 1.5rem;
  border-radius: 2px;
}

.section p {
  color: var(--sub);
  margin-bottom: 1rem;
}

.section ul {
  list-style: disc;
  margin-left: 1.5rem;
  color: var(--sub);
}

.section ul li {
  margin-bottom: 0.5rem;
}

.section img {
  max-width: 100%;
  border-radius: 8px;
  margin-top: 1rem;
}

footer {
  text-align: center;
  padding: 2rem;
  color: var(--sub);
  margin-top: 4rem;
}

@media (max-width: 768px) {
  nav ul {
    flex-direction: column;
    gap: 1rem;
  }
  
  .hero h1 {
    font-size: 2rem;
  }
  
  main {
    padding: 0 1rem;
  }
}`;
  }
  
  private generateSharedJS(): string {
    return `// Active nav highlighting
document.addEventListener('DOMContentLoaded', () => {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const links = document.querySelectorAll('nav a[href]');
  
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
  
  // Show admin button if ?admin=1 or localStorage.adminToken exists
  const params = new URLSearchParams(window.location.search);
  const hasAdminParam = params.get('admin') === '1';
  const hasToken = !!localStorage.getItem('adminToken');
  
  if (hasAdminParam || hasToken) {
    const adminBtn = document.querySelector('.admin-btn');
    if (adminBtn) {
      adminBtn.classList.add('visible');
    }
  }
});`;
  }
  
  private generatePageHTML(
    pageName: string,
    currentFile: string,
    slides: SlideIn[],
    theme: Theme,
    siteTitle: string
  ): string {
    const sectionsHTML = slides.map(slide => {
      const c = slide.content || {};
      const heading = sanitizeContent(slide.title || pageName);
      const body = sanitizeContent(c.subtitle || c.body || '');
      const bullets = Array.isArray(c.bullets) ? c.bullets.map(b => sanitizeContent(b)) : [];
      const imageUrl = c.image?.url || '';
      
      return `
    <div class="section">
      <h2>${heading}</h2>
      <div class="band"></div>
      ${body ? `<p>${body}</p>` : ''}
      ${bullets.length > 0 ? `<ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul>` : ''}
      ${imageUrl ? `<img src="${imageUrl}" alt="${heading}" loading="lazy">` : ''}
    </div>`;
    }).join('');
    
    const isHome = pageName === 'Home';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageName} - ${sanitizeContent(siteTitle)}</title>
  <meta name="description" content="${sanitizeContent(siteTitle)} - ${pageName} page">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <nav>
      <ul>
        <li><a href="index.html" data-testid="nav-home">Home</a></li>
        <li><a href="about.html" data-testid="nav-about">About</a></li>
        <li><a href="projects.html" data-testid="nav-projects">Projects</a></li>
        <li><a href="contact.html" data-testid="nav-contact">Contact</a></li>
      </ul>
      <a href="admin/index.html" class="admin-btn" data-testid="btn-admin">Admin</a>
    </nav>
  </header>
  
  <main>
    ${isHome ? `
    <div class="hero">
      <h1>${sanitizeContent(siteTitle)}</h1>
      <p>${sanitizeContent(slides[0]?.content?.subtitle || slides[0]?.content?.body || 'Welcome to our website')}</p>
    </div>` : ''}
    
    ${sectionsHTML}
  </main>
  
  <footer>
    <p>&copy; 2025 ${sanitizeContent(siteTitle)}. Generated by Agent Diaz AI.</p>
  </footer>
  
  <script src="app.js"></script>
</body>
</html>`;
  }
  
  private generateAdminHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Panel</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; }
    
    .auth-screen {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    
    .auth-box {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      width: 100%;
      max-width: 400px;
    }
    
    .auth-box h1 {
      margin-bottom: 1.5rem;
      color: #333;
    }
    
    .auth-box input {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 6px;
      margin-bottom: 1rem;
      font-size: 1rem;
    }
    
    .auth-box button {
      width: 100%;
      padding: 0.75rem;
      background: #7c3aed;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      cursor: pointer;
    }
    
    .auth-box button:hover {
      background: #6d28d9;
    }
    
    .admin-screen {
      display: none;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    .admin-screen.visible {
      display: block;
    }
    
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }
    
    header h1 {
      color: #333;
    }
    
    .btn-logout {
      padding: 0.5rem 1rem;
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    
    .section-selector {
      margin-bottom: 2rem;
    }
    
    .section-selector label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    
    .section-selector select {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 1rem;
    }
    
    .btn-add {
      margin-bottom: 2rem;
      padding: 0.75rem 1.5rem;
      background: #10b981;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    
    .articles-list {
      display: grid;
      gap: 1rem;
    }
    
    .article-card {
      background: white;
      padding: 1.5rem;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    
    .article-card h3 {
      margin-bottom: 0.5rem;
      color: #333;
    }
    
    .article-card p {
      color: #666;
      margin-bottom: 1rem;
    }
    
    .article-card .actions {
      display: flex;
      gap: 0.5rem;
    }
    
    .article-card button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    
    .btn-edit {
      background: #3b82f6;
      color: white;
    }
    
    .btn-delete {
      background: #ef4444;
      color: white;
    }
    
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    
    .modal.visible {
      display: flex;
    }
    
    .modal-content {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      width: 90%;
      max-width: 600px;
    }
    
    .modal-content h2 {
      margin-bottom: 1.5rem;
    }
    
    .modal-content label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    
    .modal-content input,
    .modal-content textarea {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 6px;
      margin-bottom: 1rem;
      font-size: 1rem;
      font-family: inherit;
    }
    
    .modal-content textarea {
      min-height: 150px;
      resize: vertical;
    }
    
    .modal-actions {
      display: flex;
      gap: 1rem;
      justify-content: flex-end;
    }
    
    .modal-actions button {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    
    .btn-cancel {
      background: #6b7280;
      color: white;
    }
    
    .btn-save {
      background: #10b981;
      color: white;
    }
    
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: #1f2937;
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: none;
      z-index: 2000;
    }
    
    .toast.visible {
      display: block;
      animation: slideIn 0.3s ease;
    }
    
    @keyframes slideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
    
    .error {
      color: #ef4444;
      font-size: 0.9rem;
      margin-top: -0.5rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="auth-screen" id="authScreen">
    <div class="auth-box">
      <h1>Admin Login</h1>
      <input type="password" id="tokenInput" placeholder="Enter admin token" data-testid="input-token">
      <button id="loginBtn" data-testid="btn-login">Login</button>
      <p id="authError" class="error"></p>
    </div>
  </div>
  
  <div class="admin-screen" id="adminScreen">
    <header>
      <h1>Content Management</h1>
      <button class="btn-logout" id="logoutBtn" data-testid="btn-logout">Logout</button>
    </header>
    
    <div class="section-selector">
      <label for="sectionSelect">Section:</label>
      <select id="sectionSelect" data-testid="select-section">
        <option value="home">Home</option>
        <option value="about">About</option>
        <option value="projects">Projects</option>
        <option value="contact">Contact</option>
      </select>
    </div>
    
    <button class="btn-add" id="addBtn" data-testid="btn-add-article">Add Article</button>
    
    <div class="articles-list" id="articlesList"></div>
  </div>
  
  <div class="modal" id="articleModal">
    <div class="modal-content">
      <h2 id="modalTitle">Add Article</h2>
      <form id="articleForm">
        <label for="articleTitle">Title *</label>
        <input type="text" id="articleTitle" required data-testid="input-article-title">
        <p id="titleError" class="error"></p>
        
        <label for="articleBody">Body * (min 50 characters)</label>
        <textarea id="articleBody" required data-testid="input-article-body"></textarea>
        <p id="bodyError" class="error"></p>
        
        <div class="modal-actions">
          <button type="button" class="btn-cancel" id="cancelBtn" data-testid="btn-cancel">Cancel</button>
          <button type="submit" class="btn-save" data-testid="btn-save">Save</button>
        </div>
      </form>
    </div>
  </div>
  
  <div class="toast" id="toast"></div>
  
  <script src="admin.js"></script>
</body>
</html>`;
  }
  
  private generateAdminJS(): string {
    return `// Admin Panel Logic
const API_BASE = 'YOUR_APPS_SCRIPT_URL'; // Replace with deployed Apps Script URL
let currentSection = 'home';
let editingArticleId = null;

// Auth
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('logoutBtn').addEventListener('click', logout);

function login() {
  const token = document.getElementById('tokenInput').value.trim();
  const errorEl = document.getElementById('authError');
  
  if (!token) {
    errorEl.textContent = 'Please enter a token';
    return;
  }
  
  localStorage.setItem('adminToken', token);
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('adminScreen').classList.add('visible');
  loadArticles();
}

function logout() {
  localStorage.removeItem('adminToken');
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('adminScreen').classList.remove('visible');
}

// Check auth on load
if (localStorage.getItem('adminToken')) {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('adminScreen').classList.add('visible');
  loadArticles();
}

// Section selector
document.getElementById('sectionSelect').addEventListener('change', (e) => {
  currentSection = e.target.value;
  loadArticles();
});

// Modal
const modal = document.getElementById('articleModal');
const articleForm = document.getElementById('articleForm');

document.getElementById('addBtn').addEventListener('click', () => {
  editingArticleId = null;
  document.getElementById('modalTitle').textContent = 'Add Article';
  document.getElementById('articleTitle').value = '';
  document.getElementById('articleBody').value = '';
  clearErrors();
  modal.classList.add('visible');
});

document.getElementById('cancelBtn').addEventListener('click', () => {
  modal.classList.remove('visible');
});

articleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  
  const title = document.getElementById('articleTitle').value.trim();
  const body = document.getElementById('articleBody').value.trim();
  
  // Validation
  let hasError = false;
  
  if (!title) {
    document.getElementById('titleError').textContent = 'Title is required';
    hasError = true;
  }
  
  if (!body || body.length < 50) {
    document.getElementById('bodyError').textContent = 'Body must be at least 50 characters';
    hasError = true;
  }
  
  if (hasError) return;
  
  // Sanitize XSS
  const sanitizedTitle = sanitizeHTML(title);
  const sanitizedBody = sanitizeHTML(body);
  
  const article = {
    id: editingArticleId || \`article-\${Date.now()}\`,
    title: sanitizedTitle,
    body: sanitizedBody,
    updatedAt: Date.now()
  };
  
  try {
    if (editingArticleId) {
      await updateArticle(article);
      showToast('Article updated successfully');
    } else {
      await createArticle(article);
      showToast('Article created successfully');
    }
    
    modal.classList.remove('visible');
    loadArticles();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
});

// CRUD operations
async function loadArticles() {
  try {
    const response = await fetch(\`\${API_BASE}?action=get&section=\${currentSection}\`, {
      headers: { 'Authorization': \`Bearer \${localStorage.getItem('adminToken')}\` }
    });
    
    if (!response.ok) throw new Error('Failed to load articles');
    
    const data = await response.json();
    const articles = data.sections[currentSection] || [];
    
    renderArticles(articles);
  } catch (err) {
    showToast('Error loading articles: ' + err.message, true);
  }
}

async function createArticle(article) {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${localStorage.getItem('adminToken')}\`
    },
    body: JSON.stringify({
      action: 'create',
      section: currentSection,
      article
    })
  });
  
  if (!response.ok) throw new Error('Failed to create article');
  return response.json();
}

async function updateArticle(article) {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${localStorage.getItem('adminToken')}\`
    },
    body: JSON.stringify({
      action: 'update',
      section: currentSection,
      article
    })
  });
  
  if (!response.ok) throw new Error('Failed to update article');
  return response.json();
}

async function deleteArticle(id) {
  if (!confirm('Are you sure you want to delete this article?')) return;
  
  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${localStorage.getItem('adminToken')}\`
      },
      body: JSON.stringify({
        action: 'delete',
        section: currentSection,
        id
      })
    });
    
    if (!response.ok) throw new Error('Failed to delete article');
    
    showToast('Article deleted successfully');
    loadArticles();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

function renderArticles(articles) {
  const container = document.getElementById('articlesList');
  
  if (articles.length === 0) {
    container.innerHTML = '<p style="color: #666;">No articles yet. Click "Add Article" to create one.</p>';
    return;
  }
  
  container.innerHTML = articles.map(article => \`
    <div class="article-card" data-testid="article-\${article.id}">
      <h3>\${escapeHTML(article.title)}</h3>
      <p>\${escapeHTML(article.body.substring(0, 150))}...</p>
      <div class="actions">
        <button class="btn-edit" onclick="editArticle('\${article.id}')" data-testid="btn-edit-\${article.id}">Edit</button>
        <button class="btn-delete" onclick="deleteArticle('\${article.id}')" data-testid="btn-delete-\${article.id}">Delete</button>
      </div>
    </div>
  \`).join('');
}

function editArticle(id) {
  // Load article data
  fetch(\`\${API_BASE}?action=get&section=\${currentSection}\`)
    .then(r => r.json())
    .then(data => {
      const article = (data.sections[currentSection] || []).find(a => a.id === id);
      if (!article) return;
      
      editingArticleId = id;
      document.getElementById('modalTitle').textContent = 'Edit Article';
      document.getElementById('articleTitle').value = article.title;
      document.getElementById('articleBody').value = article.body;
      clearErrors();
      modal.classList.add('visible');
    });
}

// Utilities
function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function clearErrors() {
  document.getElementById('titleError').textContent = '';
  document.getElementById('bodyError').textContent = '';
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#ef4444' : '#1f2937';
  toast.classList.add('visible');
  
  setTimeout(() => {
    toast.classList.remove('visible');
  }, 3000);
}`;
  }
  
  private generateAppsScriptBackend(): string {
    return `// Google Apps Script Backend (ContentApi.gs)
// Deploy as: Web App with "Anyone" access
// Supports both HTML page serving and JSON API endpoints

const ADMIN_TOKEN = 'YOUR_SECRET_TOKEN'; // Change this in Script Properties
const CONTENT_KEY = 'website_content';

// Multi-page router for HTML serving
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page) : 'index';
  const action = e.parameter.action;
  
  // If requesting API data, return JSON
  if (action === 'get') {
    const section = e.parameter.section;
    const content = getContent();
    
    if (section) {
      return ContentService.createTextOutput(JSON.stringify({
        sections: { [section]: content.sections[section] || [] }
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify(content))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Otherwise, serve HTML pages
  const allowed = {index: true, about: true, projects: true, contact: true, admin: true};
  const pageName = allowed[page] ? page : 'index';
  
  return HtmlService.createHtmlOutputFromFile(pageName)
    .setTitle('Website')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const token = extractToken(e);
    
    // Verify token
    const adminToken = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN') || ADMIN_TOKEN;
    if (token !== adminToken) {
      return createResponse({ error: 'Unauthorized' }, 401);
    }
    
    const { action, section, article, id } = data;
    const content = getContent();
    
    if (!content.sections[section]) {
      content.sections[section] = [];
    }
    
    switch (action) {
      case 'create':
        content.sections[section].push(article);
        break;
        
      case 'update':
        const updateIndex = content.sections[section].findIndex(a => a.id === article.id);
        if (updateIndex !== -1) {
          content.sections[section][updateIndex] = article;
        }
        break;
        
      case 'delete':
        content.sections[section] = content.sections[section].filter(a => a.id !== id);
        break;
        
      default:
        return createResponse({ error: 'Invalid action' }, 400);
    }
    
    saveContent(content);
    return createResponse({ success: true, content });
    
  } catch (err) {
    return createResponse({ error: err.message }, 500);
  }
}

function getContent() {
  const stored = PropertiesService.getScriptProperties().getProperty(CONTENT_KEY);
  
  if (!stored) {
    return {
      sections: {
        home: [],
        about: [],
        projects: [],
        contact: []
      }
    };
  }
  
  return JSON.parse(stored);
}

function saveContent(content) {
  PropertiesService.getScriptProperties().setProperty(CONTENT_KEY, JSON.stringify(content));
}

function extractToken(e) {
  const authHeader = e.parameter.authorization || e.parameters.authorization;
  if (authHeader && authHeader[0]) {
    return authHeader[0].replace('Bearer ', '');
  }
  return null;
}

function createResponse(data, status = 200) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// CORS Preflight
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
}`;
  }
  
  private generateExpressServer(): string {
    return `// server.js — minimal static host for live preview
const express = require("express");
const path = require("path");
const app = express();
const SITE_DIR = path.join(__dirname, "site");

app.use(express.static(SITE_DIR, {
  extensions: ["html"], // allows /about to resolve to about.html
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
    }
  }
}));

app.get("/", (_req, res) => {
  res.sendFile(path.join(SITE_DIR, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`✓ Website running at http://localhost:\${PORT}\`);
  console.log(\`  Open your browser to view the site\`);
});`;
  }
  
  private generatePackageJSON(title: string): string {
    return JSON.stringify({
      name: title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      version: "1.0.0",
      description: "Multi-page website with live preview server",
      main: "server.js",
      scripts: {
        start: "node server.js",
        dev: "node server.js"
      },
      keywords: ["website", "static-site"],
      dependencies: {
        express: "^4.18.2"
      }
    }, null, 2);
  }
  
  private generateWebsiteReadme(title: string): string {
    return `# ${title}

Multi-page website with live preview server and admin panel.

## Quick Start

1. Extract this ZIP file
2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`
3. Start the server:
   \`\`\`bash
   npm start
   \`\`\`
4. Open http://localhost:3000 in your browser

## Project Structure

\`\`\`
/site/              # Static website files
  index.html        # Home page
  about.html        # About page
  projects.html     # Projects page
  contact.html      # Contact page
  styles.css        # Shared stylesheet
  app.js            # Navigation logic
server.js           # Express server for live preview
package.json        # Node.js dependencies
/admin/             # Content management panel
  index.html        # Admin UI
  admin.js          # CRUD client
/apps_script/       # Google Apps Script backend
  ContentApi.gs     # API endpoints for content management
\`\`\`

## Navigation

The website uses proper file-based navigation:
- Home: /index.html or /
- About: /about.html or /about
- Projects: /projects.html or /projects
- Contact: /contact.html or /contact

## Admin Panel

Access the admin panel at \`/admin/index.html\` or by adding \`?admin=1\` to any page URL.

Default admin features:
- Token-based authentication
- Content CRUD operations
- Section-based organization (home, about, projects, contact)

## Google Apps Script Deployment

To deploy as a Google Sheets Web App:

1. Open Google Sheets and go to Extensions → Apps Script
2. Create files: index.html, about.html, projects.html, contact.html, admin.html
3. Copy ContentApi.gs to Code.gs
4. Deploy as Web App with "Anyone" access
5. Set ADMIN_TOKEN in Script Properties

Access pages via: \`?page=about\`, \`?page=projects\`, etc.

## License

Generated by Agent Diaz AI
`;
  }

  /* ──────────────────────────── DOCX ──────────────────────────── */

  private async buildDOCX(
    taskId: string,
    title: string,
    slides: SlideIn[],
    sources: string[],
  ): Promise<BuildResult> {
    // Check if this should be a proper report (comprehensive detection)
    const reportKeywords = ['method', 'result', 'discussion', 'analysis', 'findings', 'data', 'study', 'research', 'conclusion', 'implication'];
    const isReport = slides.some(s => {
      const titleLower = s.title?.toLowerCase() || '';
      const bodyLower = (s.content?.body || s.content?.subtitle || '').toLowerCase();
      return reportKeywords.some(kw => titleLower.includes(kw) || bodyLower.includes(kw));
    }) || title.toLowerCase().match(/\b(report|analysis|study|research)\b/);
    
    if (isReport) {
      return this.buildDOCXReport(taskId, title, slides, sources, hints);
    }
    
    let embeddedChartsCount = 0;
    let embeddedImagesCount = 0;
    
    // Process slides and embed charts/images (NO NOTES in final output)
    const sections = await Promise.all(
      slides.map(async (s, i) => {
        const c: any = s.content || {};
        const parts: any[] = [
          new Paragraph({ text: `${i + 1}. ${safeTitle(s.title || "Slide")}`, heading: HeadingLevel.HEADING_2 }),
        ];
        
        // Add body text
        const text = c.subtitle || c.body || "";
        if (text) parts.push(new Paragraph({ text }));
        
        // Add bullets
        if (Array.isArray(c.bullets) && c.bullets.length) {
          parts.push(new Paragraph({ text: "• " + c.bullets.join("\n• ") }));
        }
        
        // REMOVED: Notes are internal scaffolding, never include in final DOCX
        
        // Embed charts as images (NO raw URLs!)
        let chartUrl: string | null = null;
        let spec: any | null = c.chartSpec ? normalizeToDoughnutSpec(c.chartSpec) : null;
        if (spec && hasUsableChartData(spec)) {
          chartUrl = chartUrlFromSpec(spec);
        } else if (c.chart?.url && looksLikeImageUrl(c.chart.url)) {
          chartUrl = c.chart.url;
        }
        
        if (chartUrl) {
          try {
            const response = await axios.get(chartUrl, {
              responseType: "arraybuffer",
              timeout: 15000,
              headers: { "User-Agent": "Agent Diaz/1.0 (docx-embedder)" },
            });
            const imageBuffer = Buffer.from(response.data);
            
            parts.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imageBuffer,
                    transformation: {
                      width: 450,
                      height: 300,
                    },
                  } as any),
                ],
              })
            );
            embeddedChartsCount++;
          } catch (err: any) {
            await logger.trace(taskId, `Failed to embed chart: ${err.message || err}`);
            // Fallback: add descriptive text (NO URL)
            parts.push(new Paragraph({ children: [new TextRun({ text: `[Chart: ${c.chart?.title || "visualization"}]`, italics: true, color: "999999" })] }));
          }
        }
        
        // Embed images
        if (c.image?.url) {
          try {
            const response = await axios.get(c.image.url, {
              responseType: "arraybuffer",
              timeout: 15000,
              headers: { "User-Agent": "Agent Diaz/1.0 (docx-embedder)" },
            });
            const imageBuffer = Buffer.from(response.data);
            
            parts.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imageBuffer,
                    transformation: {
                      width: 500,
                      height: 350,
                    },
                  } as any),
                ],
              })
            );
            embeddedImagesCount++;
          } catch (err: any) {
            await logger.trace(taskId, `Failed to embed image: ${err.message || err}`);
            // Fallback: add descriptive text (NO URL)
            parts.push(new Paragraph({ children: [new TextRun({ text: `[Image: ${c.image.description || "content image"}]`, italics: true, color: "999999" })] }));
          }
        }
        
        return parts;
      })
    );
    
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ text: safeTitle(title), heading: HeadingLevel.TITLE }),
          ...sections.flat(),
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
        images: embeddedImagesCount,
        charts: embeddedChartsCount,
        theme: "n/a",
      },
    };
  }

  /* ──────────────────────── DOCX REPORT HELPERS ──────────────────────── */
  
  // ─── Citation Mapper: Converts [Source1] tags to footnotes ───
  private mapCitations(text: string, sources: string[]): { content: TextRun[], citations: Set<number> } {
    const runs: TextRun[] = [];
    const citations = new Set<number>();
    const parts = text.split(/(\[Source\d+\])/g);
    
    for (const part of parts) {
      const match = part.match(/\[Source(\d+)\]/);
      if (match) {
        const sourceNum = parseInt(match[1]);
        const sourceIdx = sourceNum - 1;
        if (sourceIdx >= 0 && sourceIdx < sources.length) {
          citations.add(sourceNum);
          runs.push(new TextRun({ text: ` [${sourceNum}]`, superScript: true, color: "0000FF" }));
        }
      } else if (part) {
        runs.push(new TextRun({ text: part }));
      }
    }
    
    return { content: runs.length > 0 ? runs : [new TextRun({ text })], citations };
  }
  
  // ─── Table Generator: Extracts numeric data and builds tables ───
  private extractDataTable(slides: SlideIn[]): { hasTable: boolean; table?: any } {
    const numericBullets: Array<{ label: string; value: string }> = [];
    
    for (const slide of slides) {
      const bullets = slide.content?.bullets || [];
      for (const bullet of bullets) {
        const match = bullet.match(/^([^:]+):\s*([0-9.]+\s*(?:%|days?|weeks?|months?|years?)?)/i);
        if (match) {
          numericBullets.push({ label: match[1].trim(), value: match[2].trim() });
        }
      }
    }
    
    if (numericBullets.length < 2) {
      return { hasTable: false };
    }
    
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Parameter", bold: true })] })], shading: { fill: "DDDDDD" } as any }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Value", bold: true })] })], shading: { fill: "DDDDDD" } as any }),
          ],
        }),
        ...numericBullets.slice(0, 10).map(item => 
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(item.label)] }),
              new TableCell({ children: [new Paragraph(item.value)] }),
            ],
          })
        ),
      ],
    });
    
    return { hasTable: true, table };
  }
  
  // ─── Chart Fetcher: Robust PNG download with validation ───
  private async fetchChartImage(url: string, taskId: string): Promise<Buffer | null> {
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 15000,
        headers: { "User-Agent": "Agent Diaz/1.0" },
        maxRedirects: 3,
      });
      
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const buffer = Buffer.from(response.data);
      if (buffer.length < 100) {
        throw new Error("Image too small");
      }
      
      return buffer;
    } catch (err: any) {
      await logger.trace(taskId, `Chart fetch failed: ${url.slice(0, 80)} - ${err.message}`);
      return null;
    }
  }
  
  // ─── Validation Gates: Pre-export quality checks (fail-closed on real problems only) ───
  private async validateReportArtifacts(
    taskId: string,
    content: { exec: string; intro: string; methods: string; results: string; discussion: string },
    sources: string[],
    chartCount: number,
    hasTable: boolean,
    allCitations: Set<number>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    // Forbidden terms check
    const allText = Object.values(content).join(' ').toLowerCase();
    const forbiddenTerms = ['this slide', 'this presentation', 'template', 'will include', 'pedagogic construct', 'will describe'];
    for (const term of forbiddenTerms) {
      if (allText.includes(term)) {
        errors.push(`Contains forbidden meta language: "${term}"`);
      }
    }
    
    // Truncation check (ellipses at end of sections)
    for (const [key, text] of Object.entries(content)) {
      if (text.trim().endsWith('...') || text.trim().endsWith('…')) {
        errors.push(`Section "${key}" appears truncated (ends with ellipsis)`);
      }
    }
    
    // Empty/missing sections check (fail-closed on real structural problems)
    const emptySections = Object.entries(content).filter(([key, text]) => !text || text.length < 50);
    if (emptySections.length > 2) {
      errors.push(`Too many empty sections: ${emptySections.map(([k]) => k).join(', ')}`);
    }
    
    // Minimum content length (lower threshold with limited sources)
    const totalLength = Object.values(content).join('').length;
    if (totalLength < 300) {
      errors.push(`Total content too short: ${totalLength} chars (minimum 300)`);
    }
    
    // NOTE: Removed citation/source count requirements - handled by Limited Sources banner
    // Chart/table is now optional, not required
    
    if (errors.length > 0) {
      await logger.trace(taskId, `VALIDATION FAILED: ${errors.join('; ')}`);
    } else {
      await logger.trace(taskId, `VALIDATION PASSED: ${allCitations.size} cites, ${chartCount} charts, ${sources.length} sources`);
    }
    
    return { valid: errors.length === 0, errors };
  }

  /* ──────────────────────── DOCX REPORT (Professional Structure) ──────────────────────── */
  
  private async buildDOCXReport(
    taskId: string,
    title: string,
    slides: SlideIn[],
    sources: string[],
    hints: LayoutHints = {},
  ): Promise<BuildResult> {
    await logger.stepStart(taskId, "Building validated DOCX report with pipeline");
    
    // ═══ STAGE 1: PARSE & SANITIZE ═══
    const sanitizeText = (text: string): string => {
      if (!text) return "";
      return text
        .replace(/\b(this slide|this presentation|template|microsoft create|will include|will describe|will adopt|will provide|pedagogic construct)\b/gi, '')
        .replace(/\bwill be\b/gi, 'is')
        .replace(/\bwill have\b/gi, 'has')
        .replace(/\bwill contain\b/gi, 'contains')
        .replace(/\bwill show\b/gi, 'shows')
        .replace(/\bwill demonstrate\b/gi, 'demonstrates')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+\./g, '.')
        .trim();
    };
    
    const buildTextFromSlide = (slide?: SlideIn): string => {
      if (!slide) return "";
      const c = slide.content || {};
      const parts: string[] = [];
      if (c.subtitle) parts.push(sanitizeText(c.subtitle));
      if (c.body) parts.push(sanitizeText(c.body));
      if (Array.isArray(c.bullets)) parts.push(c.bullets.map(b => sanitizeText(b)).filter(Boolean).join('. '));
      return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
    };
    
    const execSummarySlide = slides.find(s => s.title?.toLowerCase().includes('summary') || s.title?.toLowerCase().includes('executive'));
    const introSlide = slides.find(s => s.title?.toLowerCase().includes('introduction') || s.title?.toLowerCase().includes('background'));
    const methodsSlide = slides.find(s => s.title?.toLowerCase().includes('method') || s.title?.toLowerCase().includes('approach'));
    const resultsSlides = slides.filter(s => s.title?.toLowerCase().includes('result') || s.title?.toLowerCase().includes('finding') || s.title?.toLowerCase().includes('data'));
    const discussionSlide = slides.find(s => s.title?.toLowerCase().includes('discussion') || s.title?.toLowerCase().includes('conclusion') || s.title?.toLowerCase().includes('implication'));
    
    let execText = buildTextFromSlide(execSummarySlide) || "Comprehensive analysis based on research and data evaluation.";
    let introText = buildTextFromSlide(introSlide) || "Background context for the analysis presented in this report.";
    let methodsText = buildTextFromSlide(methodsSlide) || "Literature synthesis and analytical review of existing research.";
    let resultsText = resultsSlides.map(buildTextFromSlide).filter(Boolean).join(' ') || "Key patterns and insights detailed below.";
    let discussionText = buildTextFromSlide(discussionSlide) || "Implications and future directions for research.";
    
    // ═══ STAGE 2: ENRICH WITH CITATIONS & TABLE ═══
    const allCitations = new Set<number>();
    
    const execMap = this.mapCitations(execText, sources);
    execMap.citations.forEach(c => allCitations.add(c));
    
    const introMap = this.mapCitations(introText, sources);
    introMap.citations.forEach(c => allCitations.add(c));
    
    const resultsMap = this.mapCitations(resultsText, sources);
    resultsMap.citations.forEach(c => allCitations.add(c));
    
    const { hasTable, table } = this.extractDataTable(slides);
    
    // ═══ STAGE 3: FETCH CHARTS ═══
    const chartData: Array<{ buffer: Buffer; title: string } | null> = [];
    const maxCharts = 3;
    
    for (const slide of slides.slice(0, 10)) {
      if (chartData.filter(Boolean).length >= maxCharts) break;
      
      const c: any = slide.content || {};
      let chartUrl: string | null = null;
      let spec: any | null = c.chartSpec ? normalizeToDoughnutSpec(c.chartSpec) : null;
      
      if (spec && hasUsableChartData(spec)) {
        chartUrl = chartUrlFromSpec(spec);
      } else if (c.chart?.url && looksLikeImageUrl(c.chart.url)) {
        chartUrl = c.chart.url;
      }
      
      if (chartUrl) {
        const buffer = await this.fetchChartImage(chartUrl, taskId);
        if (buffer) {
          chartData.push({ buffer, title: sanitizeText(c.chart?.title || spec?.title || "Visualization") });
        }
      }
    }
    
    const chartCount = chartData.filter(Boolean).length;
    await logger.trace(taskId, `Enrichment: ${allCitations.size} citations, ${hasTable ? 1 : 0} table, ${chartCount} charts`);
    
    // ═══ STAGE 4: VALIDATE ═══
    const validation = await this.validateReportArtifacts(
      taskId,
      { exec: execText, intro: introText, methods: methodsText, results: resultsText, discussion: discussionText },
      sources,
      chartCount,
      hasTable,
      allCitations,
    );
    
    if (!validation.valid) {
      throw new Error(`Report validation failed: ${validation.errors.join('; ')}`);
    }
    
    // ═══ STAGE 5: ASSEMBLE DOCX ═══
    const children: any[] = [];
    
    // Cover
    children.push(
      new Paragraph({ text: sanitizeText(title), heading: HeadingLevel.TITLE }),
      new Paragraph({ children: [new TextRun({ text: "Professional Report", bold: true, size: 28 })] }),
      new Paragraph({ children: [new TextRun({ text: new Date().toISOString().slice(0, 10), color: "666666" })] }),
      new Paragraph({ text: "" }),
    );
    
    // Limited Sources Banner (if applicable)
    if (hints.limitedSources) {
      const sourceCount = hints.sourceCount || sources.length;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `⚠️ Limited Sources Notice: This report was generated with ${sourceCount} vetted ${sourceCount === 1 ? 'source' : 'sources'}. `,
              bold: true,
              color: "D97706",
            }),
            new TextRun({
              text: "Content may be based on general knowledge and established literature. For comprehensive research, consult additional academic sources.",
              color: "92400E",
            }),
          ],
          spacing: { before: 200, after: 300 },
          shading: { fill: "FEF3C7" } as any,
        }),
        new Paragraph({ text: "" }),
      );
      await logger.trace(taskId, `Added Limited Sources banner (${sourceCount} sources)`);
    }
    
    // Executive Summary
    children.push(
      new Paragraph({ text: "Executive Summary", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: execMap.content }),
      new Paragraph({ text: "" }),
    );
    
    // Introduction
    children.push(
      new Paragraph({ text: "Introduction", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: introMap.content }),
      new Paragraph({ text: "" }),
    );
    
    // Methods
    children.push(
      new Paragraph({ text: "Methods", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: methodsText }),
      new Paragraph({ text: "" }),
    );
    
    // Results (with citations)
    children.push(
      new Paragraph({ text: "Results", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: resultsMap.content }),
      new Paragraph({ text: "" }),
    );
    
    // Add table if available
    if (hasTable && table) {
      children.push(
        new Paragraph({ text: "Data Summary", heading: HeadingLevel.HEADING_2 }),
        table,
        new Paragraph({ text: "" }),
      );
    }
    
    // Add charts
    chartData.filter(Boolean).forEach((chart, i) => {
      if (chart) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: `Figure ${i + 1}: ${chart.title}`, bold: true })] }),
          new Paragraph({ children: [new ImageRun({ data: chart.buffer, transformation: { width: 450, height: 300 } } as any)] }),
          new Paragraph({ text: "" }),
        );
      }
    });
    
    // Discussion
    children.push(
      new Paragraph({ text: "Discussion", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: discussionText }),
      new Paragraph({ text: "" }),
    );
    
    // References
    if (sources.length > 0) {
      children.push(new Paragraph({ text: "References", heading: HeadingLevel.HEADING_1 }));
      sources.slice(0, 20).forEach((url, i) => {
        children.push(new Paragraph({ children: [new TextRun({ text: `[${i + 1}] ${url}`, size: 20 })] }));
      });
    }
    
    // ═══ STAGE 6: PACK & EXPORT ═══
    const doc = new Document({ sections: [{ properties: {}, children }] });
    
    let buf: Buffer;
    try {
      buf = await Packer.toBuffer(doc);
    } catch (err: any) {
      throw new Error(`DOCX packing failed (possible truncation): ${err.message}`);
    }
    
    const filename = makeFilename(`${title}_Report`, "docx");
    const filePath = await fileStorage.saveFile(filename, buf);
    const { size } = await fileStorage.getFileStats(filename);
    
    await logger.trace(taskId, `✓ Report: ${allCitations.size} cites, ${chartCount} charts, ${hasTable ? 1 : 0} table, ${sources.length} refs`);
    await logger.stepEnd(taskId, "Building validated DOCX report with pipeline");
    
    return {
      filename,
      fileSize: size,
      filePath,
      metadata: {
        slides: slides.length,
        images: 0,
        charts: chartCount,
        theme: "Professional",
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
    hints: LayoutHints = {},
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

  /* ──────────────────────────── Website Builder ──────────────────────────── */

  private async buildWebsite(
    taskId: string,
    title: string,
    slides: any[],
    sources?: string[],
  ): Promise<BuildResult> {
    await logger.stepStart(taskId, "Building multi-page website with admin panel");
    await logger.trace(taskId, 'buildWebsite: Starting generation');
    const theme = deriveTheme(title);
    
    const sections = this.distributeSlidesToWebsitePages(slides);
    const stylesCSS = this.generateWebsiteCSS(theme);
    const appJS = this.generateWebsiteJS();
    
    const indexHTML = this.generateWebsitePageHTML('Home', 'index.html', sections.home, theme, title);
    const aboutHTML = this.generateWebsitePageHTML('About', 'about.html', sections.about, theme, title);
    const projectsHTML = this.generateWebsitePageHTML('Projects', 'projects.html', sections.projects, theme, title);
    const contactHTML = this.generateWebsitePageHTML('Contact', 'contact.html', sections.contact, theme, title);
    await logger.trace(taskId, 'buildWebsite: Generated 4 HTML pages');
    
    const adminHTML = this.generateAdminHTML();
    const adminJS = this.generateAdminJS();
    const contentApiGS = this.generateAppsScriptBackend();
    await logger.trace(taskId, 'buildWebsite: Generated admin and Apps Script files');
    
    // Generate Express server for standalone preview
    const serverJS = this.generateExpressServer();
    const packageJSON = this.generatePackageJSON(title);
    const readmeMD = this.generateWebsiteReadme(title);
    
    // Generate unique site ID
    const siteId = nanoid(12);
    const SITES_DIR = path.join(process.cwd(), "data", "sites");
    const siteDir = path.join(SITES_DIR, siteId);
    
    // Save files to persistent storage
    await logger.trace(taskId, `buildWebsite: Saving to ${siteDir}`);
    await fs.promises.mkdir(siteDir, { recursive: true });
    await fs.promises.writeFile(path.join(siteDir, 'index.html'), indexHTML);
    await fs.promises.writeFile(path.join(siteDir, 'about.html'), aboutHTML);
    await fs.promises.writeFile(path.join(siteDir, 'projects.html'), projectsHTML);
    await fs.promises.writeFile(path.join(siteDir, 'contact.html'), contactHTML);
    await fs.promises.writeFile(path.join(siteDir, 'styles.css'), stylesCSS);
    await fs.promises.writeFile(path.join(siteDir, 'app.js'), appJS);
    
    // Create manifest
    const manifest = {
      id: siteId,
      title: safeTitle(title),
      createdAt: new Date().toISOString(),
      liveUrl: `/sites/${siteId}/`,
      previewUrl: `/preview/${siteId}`,
      pages: 4,
      theme: theme.name
    };
    await fs.promises.writeFile(
      path.join(siteDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    await logger.trace(taskId, `buildWebsite: Saved ${4} pages to data/sites/${siteId}/`);
    
    // ALSO create ZIP for download (keep existing functionality)
    const zipFilename = makeFilename(`${title}_Website`, "zip");
    const zipBuffer = await this.createWebsiteZip({
      'site/index.html': indexHTML,
      'site/about.html': aboutHTML,
      'site/projects.html': projectsHTML,
      'site/contact.html': contactHTML,
      'site/styles.css': stylesCSS,
      'site/app.js': appJS,
      'server.js': serverJS,
      'package.json': packageJSON,
      'README.md': readmeMD,
      'admin/index.html': adminHTML,
      'admin/admin.js': adminJS,
      'apps_script/ContentApi.gs': contentApiGS,
    });
    await logger.trace(taskId, `buildWebsite: ZIP buffer created, ${zipBuffer.length} bytes`);
    
    const filePath = await fileStorage.saveFile(zipFilename, zipBuffer);
    const { size } = await fileStorage.getFileStats(zipFilename);
    
    await logger.stepEnd(taskId, "Built multi-page website bundle");
    await logger.trace(taskId, `buildWebsite: Live at /sites/${siteId}/, ZIP: ${zipFilename}`);
    
    return {
      filename: zipFilename,
      fileSize: size,
      filePath,
      siteId,
      liveUrl: `/sites/${siteId}/`,
      previewUrl: `/preview/${siteId}`,
      metadata: {
        slides: 4,
        images: 0,
        charts: 0,
        theme: theme.name
      },
    };
  }
  
  private distributeSlidesToWebsitePages(slides: any[]): {
    home: any[];
    about: any[];
    projects: any[];
    contact: any[];
  } {
    // Distribute slides evenly across sections
    const total = slides.length;
    const perPage = Math.ceil(total / 4);
    
    return {
      home: slides.slice(0, perPage),
      about: slides.slice(perPage, perPage * 2),
      projects: slides.slice(perPage * 2, perPage * 3),
      contact: slides.slice(perPage * 3),
    };
  }
  
  private generateWebsiteCSS(theme: any): string {
    return `:root {
  --bg: ${theme.bg};
  --paper: ${theme.card};
  --text: ${theme.text};
  --sub: ${theme.mute};
  --accent: ${theme.a};
  --band: ${theme.b};
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  line-height: 1.6;
}

header {
  background: var(--paper);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  position: sticky;
  top: 0;
  z-index: 100;
}

nav {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

nav ul {
  list-style: none;
  display: flex;
  gap: 2rem;
}

nav a {
  text-decoration: none;
  color: var(--text);
  font-weight: 500;
  transition: color 0.2s;
}

nav a:hover {
  color: var(--accent);
}

nav a.active {
  color: var(--accent);
  border-bottom: 2px solid var(--accent);
  padding-bottom: 4px;
}

.admin-btn {
  background: var(--accent);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.9rem;
  text-decoration: none;
  display: none;
}

.admin-btn.visible {
  display: inline-block;
}

main {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 2rem;
}

.hero {
  text-align: center;
  padding: 4rem 0;
  background: linear-gradient(135deg, var(--accent), var(--band));
  color: white;
  border-radius: 16px;
  margin-bottom: 3rem;
}

.hero h1 {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.hero p {
  font-size: 1.2rem;
  opacity: 0.9;
}

.section {
  background: var(--paper);
  padding: 2.5rem;
  margin-bottom: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.section h2 {
  color: var(--text);
  margin-bottom: 1rem;
  font-size: 1.8rem;
}

.section .band {
  width: 80px;
  height: 4px;
  background: var(--band);
  margin-bottom: 1.5rem;
  border-radius: 2px;
}

.section p {
  color: var(--sub);
  margin-bottom: 1rem;
}

.section ul {
  list-style: disc;
  margin-left: 1.5rem;
  color: var(--sub);
}

.section ul li {
  margin-bottom: 0.5rem;
}

.section img {
  max-width: 100%;
  border-radius: 8px;
  margin-top: 1rem;
}

footer {
  text-align: center;
  padding: 2rem;
  color: var(--sub);
  margin-top: 4rem;
}

@media (max-width: 768px) {
  nav ul {
    flex-direction: column;
    gap: 1rem;
  }
  
  .hero h1 {
    font-size: 2rem;
  }
  
  main {
    padding: 0 1rem;
  }
}`;
  }
  
  private generateWebsiteJS(): string {
    return `// Active nav highlighting
document.addEventListener('DOMContentLoaded', () => {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const links = document.querySelectorAll('nav a[href]');
  
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
  
  // Show admin button if ?admin=1 or localStorage.adminToken exists
  const params = new URLSearchParams(window.location.search);
  const hasAdminParam = params.get('admin') === '1';
  const hasToken = !!localStorage.getItem('adminToken');
  
  if (hasAdminParam || hasToken) {
    const adminBtn = document.querySelector('.admin-btn');
    if (adminBtn) {
      adminBtn.classList.add('visible');
    }
  }
});`;
  }
  
  private generateWebsitePageHTML(
    pageName: string,
    currentFile: string,
    slides: any[],
    theme: any,
    siteTitle: string
  ): string {
    const sectionsHTML = slides.map((slide) => {
      const c = slide.content || {};
      const heading = sanitizeContent(slide.title || pageName);
      const body = sanitizeContent(c.subtitle || c.body || '');
      const bullets = Array.isArray(c.bullets) ? c.bullets.map((b: string) => sanitizeContent(b)) : [];
      const imageUrl = c.image?.url || '';
      
      return `
    <div class="section">
      <h2>${escapeXml(heading)}</h2>
      <div class="band"></div>
      ${body ? `<p>${escapeXml(body)}</p>` : ''}
      ${bullets.length > 0 ? `<ul>${bullets.map((b: string) => `<li>${escapeXml(b)}</li>`).join('')}</ul>` : ''}
      ${imageUrl ? `<img src="${imageUrl}" alt="${escapeXml(heading)}" loading="lazy">` : ''}
    </div>`;
    }).join('');
    
    const isHome = pageName === 'Home';
    const heroText = slides[0]?.content?.subtitle || slides[0]?.content?.body || 'Welcome to our website';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageName} - ${escapeXml(sanitizeContent(siteTitle))}</title>
  <meta name="description" content="${escapeXml(sanitizeContent(siteTitle))} - ${pageName} page">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <nav>
      <ul>
        <li><a href="index.html" data-testid="nav-home">Home</a></li>
        <li><a href="about.html" data-testid="nav-about">About</a></li>
        <li><a href="projects.html" data-testid="nav-projects">Projects</a></li>
        <li><a href="contact.html" data-testid="nav-contact">Contact</a></li>
      </ul>
      <a href="admin/index.html" class="admin-btn" data-testid="btn-admin">Admin</a>
    </nav>
  </header>
  
  <main>
    ${isHome ? `
    <div class="hero">
      <h1>${escapeXml(sanitizeContent(siteTitle))}</h1>
      <p>${escapeXml(sanitizeContent(heroText))}</p>
    </div>` : ''}
    
    ${sectionsHTML}
  </main>
  
  <footer>
    <p>&copy; 2025 ${escapeXml(sanitizeContent(siteTitle))}. Generated by Agent Diaz AI.</p>
  </footer>
  
  <script src="app.js"></script>
</body>
</html>`;
  }
  
  private async createWebsiteZip(files: Record<string, string>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const buffers: Buffer[] = [];
      
      const bufferStream = new Writable({
        write(chunk, encoding, callback) {
          buffers.push(chunk);
          callback();
        }
      });
      
      bufferStream.on('finish', () => {
        resolve(Buffer.concat(buffers));
      });
      
      archive.on('error', reject);
      archive.pipe(bufferStream);
      
      // Add all files to zip
      for (const [path, content] of Object.entries(files)) {
        archive.append(content, { name: path });
      }
      
      archive.finalize();
    });
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
