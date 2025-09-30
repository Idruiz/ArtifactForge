// server/services/searcher.ts
// Clean search: SerpAPI first; DuckDuckGo HTML fallback that actually returns web results.
// Plus lightweight page text extraction.
//
// No new deps (uses axios + regex parsing).
//
import axios from "axios";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults: number;
}

class SearcherService {
  private serpApiKey?: string;

  initialize(apiKey?: string) {
    this.serpApiKey = apiKey;
  }

  async search(query: string, maxResults = 10): Promise<SearchResponse> {
    if (!query?.trim()) return { results: [], totalResults: 0 };

    // 1) SerpAPI (Google) if key present
    if (this.serpApiKey) {
      try {
        return await this.searchWithSerpAPI(query, maxResults);
      } catch (err: any) {
        console.warn("SerpAPI failed, falling back:", safeErr(err));
      }
    }

    // 2) DuckDuckGo HTML fallback (keyless, parses web results)
    try {
      const r = await this.searchWithDuckDuckGoHTML(query, maxResults);
      if (r.totalResults > 0) return r;
    } catch (err: any) {
      console.warn("DDG HTML fallback failed:", safeErr(err));
    }

    // 3) Wikipedia micro-fallback (at least something to cite)
    try {
      const w = await this.searchWikipedia(query, Math.min(maxResults, 5));
      if (w.totalResults > 0) return w;
    } catch (err: any) {
      console.warn("Wikipedia fallback failed:", safeErr(err));
    }

    return { results: [], totalResults: 0 };
  }

  private async searchWithSerpAPI(query: string, maxResults: number): Promise<SearchResponse> {
    const r = await axios.get("https://serpapi.com/search", {
      params: {
        q: query,
        api_key: this.serpApiKey,
        engine: "google",
        num: Math.min(maxResults, 10),
        hl: "en",
      },
      timeout: 10000,
    });

    const items = Array.isArray(r.data?.organic_results) ? r.data.organic_results : [];
    const mapped: SearchResult[] = items
      .map((it: any) => ({
        title: it.title || "",
        url: it.link || "",
        snippet: it.snippet || it.snippet_highlighted_words?.join(" ") || "",
        date: it.date || it.snippet_date,
        source: hostname(it.link),
      }))
      .filter((x) => x.title && isHttpUrl(x.url) && x.snippet && x.snippet.length >= 40);

    const deduped = dedupeByUrl(mapped).slice(0, maxResults);
    return { results: deduped, totalResults: deduped.length };
  }

  // ──────────────────────────────────────────────────────────────
  // DuckDuckGo HTML fallback (keyless)
  // Parses search results page and extracts real target URLs from `uddg` param.
  // ──────────────────────────────────────────────────────────────
  private async searchWithDuckDuckGoHTML(query: string, maxResults: number): Promise<SearchResponse> {
    const url = "https://duckduckgo.com/html/";
    const res = await axios.get(url, {
      params: { q: query, kl: "us-en" },
      timeout: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgentFire/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml",
      },
    });

    const html = String(res.data || "");
    // Links look like: <a class="result__a" href="/l/?uddg=<ENCODED_URL>&rut=...">Title</a>
    const out: SearchResult[] = [];
    const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gim;
    const snippetRe = /<a[^>]+class="result__snippet[^"]*"[^>]*>(.*?)<\/a>|<div[^>]+class="result__snippet[^"]*"[^>]*>(.*?)<\/div>/im;

    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) && out.length < maxResults) {
      const href = decodeHtml(m[1]);
      const titleHtml = m[2];
      let target = "";

      // Extract real URL from uddg param
      try {
        const u = new URL(href, "https://duckduckgo.com");
        const uddg = u.searchParams.get("uddg");
        target = uddg ? decodeURIComponent(uddg) : "";
      } catch {
        /* ignore */
      }
      if (!isHttpUrl(target)) continue;

      const title = stripTags(decodeHtml(titleHtml)).trim();
      if (!title) continue;

      // Snippet: search around this link block (rough heuristic)
      const around = html.slice(Math.max(0, linkRe.lastIndex - 800), Math.min(html.length, linkRe.lastIndex + 800));
      let snippet = "";
      const sm = snippetRe.exec(around);
      if (sm) {
        snippet = stripTags(decodeHtml(sm[1] || sm[2] || "")).replace(/\s+/g, " ").trim();
      }
      if (!snippet) snippet = title;

      out.push({
        title,
        url: target,
        snippet,
        source: hostname(target),
      });
    }

    const deduped = dedupeByUrl(out);
    return { results: deduped, totalResults: deduped.length };
  }

  // Wikipedia micro-fallback
  private async searchWikipedia(query: string, maxResults: number): Promise<SearchResponse> {
    const r = await axios.get("https://en.wikipedia.org/w/api.php", {
      params: {
        action: "opensearch",
        format: "json",
        limit: Math.min(maxResults, 10),
        search: query,
        namespace: 0,
        origin: "*",
      },
      timeout: 9000,
    });

    const titles: string[] = r.data?.[1] || [];
    const descs: string[] = r.data?.[2] || [];
    const urls: string[] = r.data?.[3] || [];

    const results: SearchResult[] = [];
    for (let i = 0; i < titles.length; i++) {
      if (!isHttpUrl(urls[i])) continue;
      const title = titles[i] || "";
      const snippet = (descs[i] || title).trim();
      results.push({ title, url: urls[i], snippet, source: hostname(urls[i]) });
    }
    const deduped = dedupeByUrl(results);
    return { results: deduped, totalResults: deduped.length };
  }

  // Extract readable text from a page (lightweight cleaner)
  async extractContent(url: string): Promise<string> {
    if (!isHttpUrl(url)) return "";
    try {
      const r = await axios.get(url, {
        timeout: 12000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AgentFire/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        maxContentLength: 2 * 1024 * 1024,
      });

      const html = String(r.data || "");
      const cleaned = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<(nav|footer|aside|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

      const text = cleaned
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return text.slice(0, 4000); // keep it modest
    } catch (err: any) {
      console.warn(`extractContent fail ${url}:`, safeErr(err));
      return "";
    }
  }

  async performMultiSearch(queries: string[]): Promise<{ [key: string]: SearchResponse }> {
    const results: { [key: string]: SearchResponse } = {};
    const pool = pLimit(4);

    await Promise.all(
      queries.map((q) =>
        pool(async () => {
          try {
            results[q] = await this.search(q, 6);
          } catch (err: any) {
            console.warn(`Search failed "${q}":`, safeErr(err));
            results[q] = { results: [], totalResults: 0 };
          }
        })
      )
    );

    return results;
  }
}

/* --------------------------- helpers --------------------------- */

function pLimit(n: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    if (queue.length) queue.shift()!();
  };
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then((v) => {
          resolve(v);
          next();
        }, (e) => {
          reject(e);
          next();
        });
      };
      if (active < n) run();
      else queue.push(run);
    });
}

function isHttpUrl(u: string): boolean {
  try {
    const { protocol } = new URL(u);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function hostname(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function dedupeByUrl(arr: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const it of arr) {
    const key = (it.url || "").trim();
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

function decodeHtml(s: string): string {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(s: string): string {
  return String(s).replace(/<[^>]*>/g, " ");
}

function safeErr(e: any): string {
  try {
    return e?.message || JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export const searcherService = new SearcherService();
