/**
 * server/services/visualMatcher.ts
 * Robust: accepts both RichOutline slides (top-level fields) and normalized slides (content.*).
 */

import axios from "axios";
import { fetchImage } from "../utils/fetchImage";

interface ImageResult {
  url: string;
  description: string;
  width?: number;
  height?: number;
}

type ChartType = "bar" | "line" | "pie" | "doughnut" | "scatter"; // 'area' coerced to 'line'

interface ChartSpec {
  type: ChartType | string;
  data: any;
  title?: string;
}

type SlideIn = {
  slideNumber?: number;
  title?: string;
  type?: "title" | "content" | "chart" | "image";
  // normalized shape
  content?: {
    body?: string;
    bullets?: string[];
    keyword?: string;
    chartSpec?: ChartSpec;
    image?: ImageResult;
    chart?: { url: string; title?: string };
  };
  // raw RichOutline compatibility (top-level fields)
  body?: string;
  bullets?: string[];
  keyword?: string;
  chartSpec?: ChartSpec;
};

class VisualMatcherService {
  private unsplashKey?: string;
  private imageCache = new Map<string, ImageResult[]>();

  initialize(unsplashKey?: string) {
    this.unsplashKey = unsplashKey;
  }

  /* ---------------------------- Image Search ---------------------------- */

  async findImages(keyword: string, count = 3): Promise<ImageResult[]> {
    const clean = (keyword || "").trim();
    if (!clean || clean.length < 2) return [];

    const cacheKey = `${clean.toLowerCase()}|${Math.max(1, count)}`;
    const cached = this.imageCache.get(cacheKey);
    if (cached && cached.length >= count) return cached.slice(0, count);

    let results: ImageResult[] = [];

    if (this.unsplashKey) {
      try {
        results = await this.searchUnsplash(clean, count);
      } catch (err: any) {
        console.warn("[img] Unsplash failed:", safeErr(err));
      }
    }

    if (results.length < count) {
      try {
        const more = await this.searchPixabayOrPexels(clean, count - results.length);
        results = dedupeImages([...results, ...more]);
      } catch (err: any) {
        console.warn("[img] Pixabay/Pexels failed:", safeErr(err));
      }
    }

    if (results.length < count) {
      const fill = await this.generatePicsumImages(count - results.length, clean);
      results = dedupeImages([...results, ...fill]);
    }

    this.imageCache.set(cacheKey, results.slice(0, count));
    if (this.imageCache.size > 200) {
      const firstKey = this.imageCache.keys().next().value;
      if (firstKey) this.imageCache.delete(firstKey);
    }
    return results.slice(0, count);
  }

  private async searchUnsplash(keyword: string, count: number): Promise<ImageResult[]> {
    const r = await axios.get("https://api.unsplash.com/search/photos", {
      params: { query: keyword, per_page: Math.min(10, Math.max(1, count)), orientation: "landscape" },
      headers: { Authorization: `Client-ID ${this.unsplashKey}` },
      timeout: 10000,
    });
    const items = Array.isArray(r.data?.results) ? r.data.results : [];
    return items
      .map(
        (p: any): ImageResult => ({
          url: p?.urls?.regular,
          description: p?.alt_description || `${keyword} image`,
          width: p?.width,
          height: p?.height,
        }),
      )
      .filter((x) => !!x.url);
  }

  private async searchPixabayOrPexels(keyword: string, count: number): Promise<ImageResult[]> {
    if (count <= 0) return [];
    const list: ImageResult[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const url = await fetchImage(keyword);
        if (url) {
          list.push({ url, description: `${keyword} image`, width: 800, height: 600 });
        }
      } catch { /* swallow */ }
    }
    return list;
  }

  private async generatePicsumImages(count: number, keyword?: string): Promise<ImageResult[]> {
    const out: ImageResult[] = [];
    for (let i = 0; i < count; i++) {
      const id = 100 + i + Math.floor(Math.random() * 900);
      out.push({
        url: `https://picsum.photos/800/600?random=${id}`,
        description: keyword ? `${keyword} related image` : "Placeholder image",
        width: 800,
        height: 600,
      });
    }
    return out;
  }

  /* --------------------------- Chart Generation ------------------------- */

  async generateChart(spec: ChartSpec): Promise<string> {
    const type = this.mapChartType(spec?.type);
    if (!type || !spec?.data) throw new Error("Invalid chart spec");

    const chartConfig = {
      type,
      data: spec.data,
      options: {
        responsive: true,
        plugins: { title: { display: !!spec.title, text: spec.title || "" }, legend: { display: true } },
      },
    };

    try {
      const r = await axios.post(
        "https://quickchart.io/chart/create",
        { chart: chartConfig, width: 800, height: 600, backgroundColor: "white" },
        { timeout: 10000 },
      );
      const url = r.data?.url;
      if (typeof url === "string" && url.startsWith("http")) return url;
    } catch (err) {
      console.warn("[chart] create endpoint failed:", safeErr(err));
    }

    const encoded = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${encoded}&w=800&h=600&bkg=white`;
  }

  private mapChartType(t?: ChartType | string): ChartType {
    const v = String(t || "").toLowerCase();
    if (v === "bar" || v === "line" || v === "pie" || v === "doughnut" || v === "scatter") return v as ChartType;
    if (v === "area") return "line"; // coerce unsupported 'area' to 'line'
    return "bar";
  }

  /* ------------------------------ Main pipe ----------------------------- */

  async processVisualContent(slides: SlideIn[]): Promise<SlideIn[]> {
    const usedImages = new Set<string>();
    const usedChartKeys = new Set<string>();
    const out: SlideIn[] = [];

    for (const s of slides) {
      // Normalize shape: unify into content.*
      const content = { ...(s.content || {}) };

      const keyword = content.keyword ?? (s as any).keyword;
      const topChartSpec = (s as any).chartSpec as ChartSpec | undefined;
      const chartSpec: ChartSpec | undefined = content.chartSpec ?? topChartSpec;

      // Copy body/bullets if they were top-level
      if (!content.body && (s as any).body) content.body = (s as any).body;
      if (!content.bullets && Array.isArray((s as any).bullets)) content.bullets = (s as any).bullets;

      // Image
      if (keyword && !content.image) {
        try {
          const imgs = await this.findImages(keyword, 2);
          const fresh = imgs.find((i) => !usedImages.has(normalizeUrl(i.url)));
          if (fresh) {
            content.image = fresh;
            usedImages.add(normalizeUrl(fresh.url));
          }
        } catch { /* ignore */ }
      }

      // Chart
      if (chartSpec && !content.chart) {
        try {
          const key = chartKey({ type: this.mapChartType(chartSpec.type), data: chartSpec.data, title: chartSpec.title });
          if (!usedChartKeys.has(key)) {
            const url = await this.generateChart(chartSpec);
            content.chart = { url, title: chartSpec.title };
            usedChartKeys.add(key);
          }
        } catch { /* ignore */ }
      }

      out.push({
        ...s,
        content,
        // keep top-level fields for backward compatibility (harmless)
      });
    }

    return out;
  }

  clearCache() {
    this.imageCache.clear();
  }
}

/* -------------------------------- Helpers ------------------------------- */

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.searchParams.delete("random");
    return url.toString();
  } catch {
    return u || "";
  }
}

function dedupeImages(arr: ImageResult[]): ImageResult[] {
  const seen = new Set<string>();
  const out: ImageResult[] = [];
  for (const it of arr) {
    const key = normalizeUrl(it.url);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

function chartKey(spec: { type: any; data: any; title?: string }): string {
  const clean = { type: String(spec?.type || "bar"), title: spec?.title || "", data: spec?.data ?? null };
  return hash(JSON.stringify(clean));
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

function safeErr(e: any): string {
  try {
    return e?.message || JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export const visualMatcherService = new VisualMatcherService();
