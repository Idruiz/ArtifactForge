// server/utils/fetchImage.ts
// Try Pixabay then Pexels; return direct image URL or empty string (caller handles fallback)

import axios from "axios";

const PIXABAY_KEY = process.env.PIXABAY_KEY || "";
const PEXELS_KEY = process.env.PEXELS_KEY || "";

export async function fetchImage(keyword: string): Promise<string> {
  const q = (keyword || "").trim();
  if (!q) return "";

  // Pixabay (if key)
  if (PIXABAY_KEY) {
    try {
      const r = await axios.get("https://pixabay.com/api/", {
        params: { key: PIXABAY_KEY, q: q, image_type: "photo", per_page: 5, safesearch: true },
        timeout: 8000,
      });
      const hits = Array.isArray(r.data?.hits) ? r.data.hits : [];
      const hit = hits.find((h: any) => isHttp(h?.largeImageURL));
      if (hit) return hit.largeImageURL;
    } catch (e: any) {
      console.warn("[img] Pixabay failed:", safeErr(e));
    }
  }

  // Pexels (if key)
  if (PEXELS_KEY) {
    try {
      const r = await axios.get("https://api.pexels.com/v1/search", {
        params: { query: q, per_page: 5 },
        headers: { Authorization: PEXELS_KEY },
        timeout: 8000,
      });
      const photos = Array.isArray(r.data?.photos) ? r.data.photos : [];
      const p = photos.find((p: any) => isHttp(p?.src?.large2x || p?.src?.large || p?.src?.original));
      if (p) return p.src.large2x || p.src.large || p.src.original;
    } catch (e: any) {
      console.warn("[img] Pexels failed:", safeErr(e));
    }
  }

  return "";
}

function isHttp(u: string): boolean {
  try {
    const { protocol } = new URL(u);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function safeErr(e: any): string {
  try {
    return e?.message || JSON.stringify(e);
  } catch {
    return String(e);
  }
}
