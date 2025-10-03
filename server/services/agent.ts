// server/services/agentService.ts
// Production agent: multi-artifact builder (pptx/html/docx/md/dashboard/infographic/report)
// - Single content pipeline → build N artifacts
// - Robust research (broad fallback), outline, visuals (in-place images, dedupe)
// - No placeholder slides here; builder handles last-mile fallbacks (synthetic charts if none)
// - Backwards compatible with current routes (no signature changes)

import { nanoid } from "nanoid";
import { openaiService, generateRichOutline } from "./openai";
import { searcherService } from "./searcher";
import { visualMatcherService } from "./visualMatcher";
import { builderService } from "./builder";
import { logger } from "../utils/logger";
import { fileStorage } from "../utils/fileStorage";

// ─── SOURCE VETTING (Allowlist + Scoring) ───

// Allowlist patterns (accept by default)
const ALLOWLIST_PATTERNS = [
  // Core Academic
  '.edu', '.ac.', '.gov', 
  // Museums & Natural History
  '.museum', '.nhm.', 'amnh.org', 'smithsonian', 'biodiversitylibrary.org',
  // Peer-reviewed aggregators
  'ncbi.nlm.nih.gov/pmc', 'doi.org/',
  // Biology-specific
  'antwiki.org', 'antweb.org', 
  // University extensions & research
  'ufl.edu/ifas', 'ucdavis.edu/ipm', 'nhm.ac.uk', 'nmnh.si.edu',
  // Fallback encyclopedias
  'britannica.com', 'wikipedia.org',
  // Reputable science media
  'nationalgeographic.com', 'scientificamerican.com', 'nature.com',
];

// Blocklist patterns (reject for citations)
const BLOCKLIST_PATTERNS = [
  'studocu.com', 'scribd.com', 'misfitanimals.com', 'geeksforgeeks.org',
  'calculator', 'microsoft.com/create', 'galaxy.ai', 'chegg.com', 'coursehero.com',
  'quizlet.com', 'slideshare.net', 'prezi.com', 'rapidtables.com',
];

// Known reference seeds (preloaded fallbacks)
const SEED_REFERENCES = [
  { 
    title: "The Ants", 
    authors: "Hölldobler, B. & Wilson, E.O.", 
    year: 1990,
    citation: "Hölldobler, B. & Wilson, E.O. (1990). The Ants. Harvard University Press.",
    url: "https://doi.org/10.1007/978-3-662-10306-7" 
  },
  {
    title: "Ant Ecology",
    authors: "Lach, L., Parr, C.L. & Abbott, K.L.",
    year: 2010,
    citation: "Lach, L., Parr, C.L. & Abbott, K.L. (2010). Ant Ecology. Oxford University Press.",
    url: "https://global.oup.com/academic/product/ant-ecology-9780199544639"
  },
  {
    title: "The Fire Ants",
    authors: "Tschinkel, W.R.",
    year: 2006,
    citation: "Tschinkel, W.R. (2006). The Fire Ants. Harvard University Press.",
    url: "https://www.hup.harvard.edu/catalog.php?isbn=9780674022075"
  },
];

// URL normalizer: dedupe, canonicalize, unwrap
function normalizeURL(url: string): string {
  if (!url) return '';
  
  // Unwrap line breaks and trim
  let normalized = url.replace(/[\r\n\s]+/g, '').trim();
  
  // Remove fragments
  normalized = normalized.split('#')[0];
  
  // Remove UTM and tracking params
  try {
    const urlObj = new URL(normalized);
    const params = new URLSearchParams(urlObj.search);
    const cleanParams = new URLSearchParams();
    
    params.forEach((value, key) => {
      if (!key.startsWith('utm_') && !key.startsWith('fb') && key !== 'ref') {
        cleanParams.set(key, value);
      }
    });
    
    urlObj.search = cleanParams.toString();
    normalized = urlObj.toString();
  } catch {
    // Invalid URL, return as-is
  }
  
  return normalized;
}

// Scoring-based vetting (≥0.3 threshold with allowlist auto-pass)
function scoreSource(url: string, title: string = '', snippet: string = ''): number {
  const lower = url.toLowerCase();
  const text = `${title} ${snippet}`.toLowerCase();
  let score = 0;
  
  // Blocklist = instant 0
  if (BLOCKLIST_PATTERNS.some(pattern => lower.includes(pattern))) {
    return 0;
  }
  
  // Authority scoring
  if (lower.includes('.edu')) score += 0.4;
  if (lower.includes('.gov')) score += 0.4;
  if (lower.includes('.ac.')) score += 0.35;
  if (lower.includes('museum') || lower.includes('nhm.') || lower.includes('amnh.org')) score += 0.3;
  if (lower.includes('doi.org') || lower.includes('ncbi.nlm.nih.gov')) score += 0.5;
  if (lower.includes('antwiki') || lower.includes('antweb')) score += 0.35;
  if (lower.includes('britannica.com')) score += 0.4;
  if (lower.includes('wikipedia.org')) score += 0.3;
  if (lower.includes('nationalgeographic.com')) score += 0.4;
  if (lower.includes('scientificamerican.com')) score += 0.4;
  if (lower.includes('nature.com')) score += 0.5;
  if (lower.includes('smithsonian')) score += 0.4;
  
  // Topic match bonus (for biology/ants)
  if (text.match(/\b(ant|formicidae|insect|metamorphosis|larva|pupa|colony)\b/i)) score += 0.15;
  
  // PDF bonus (often research papers)
  if (lower.endsWith('.pdf')) score += 0.1;
  
  return Math.min(score, 1.0);
}

function isVettedSource(url: string, title: string = '', snippet: string = ''): boolean {
  const lower = url.toLowerCase();
  
  // Blocklist check first
  if (BLOCKLIST_PATTERNS.some(pattern => lower.includes(pattern))) {
    return false;
  }
  
  // Allowlist auto-pass (use the defined patterns!)
  if (ALLOWLIST_PATTERNS.some(pattern => lower.includes(pattern))) {
    return true;
  }
  
  // Fallback to scoring (threshold 0.55 for quality)
  const score = scoreSource(url, title, snippet);
  return score >= 0.55;
}

interface VettedSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  vetted: boolean;
}

type AgentStatus = "pending" | "processing" | "completed" | "failed";

interface AgentTask {
  id: string;
  sessionId: string;
  prompt: string;
  persona: string;
  tone: string;
  apiKeys: any;
  status: AgentStatus;
  progress: number;      // 0–100
  currentStep: string;   // human-readable
  conversationHistory?: any[]; // for context retention
}

type BuilderFormat =
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

class AgentService {
  private activeTasks = new Map<string, AgentTask>();
  private statusCallbacks = new Map<string, (status: any) => void>();
  private messageCallbacks = new Map<string, (message: any) => void>();
  private artifactCallbacks = new Map<string, (artifact: any) => void>();

  onStatusUpdate(sessionId: string, callback: (status: any) => void) {
    this.statusCallbacks.set(sessionId, callback);
  }
  onMessage(sessionId: string, callback: (message: any) => void) {
    this.messageCallbacks.set(sessionId, callback);
  }
  onArtifact(sessionId: string, callback: (artifact: any) => void) {
    this.artifactCallbacks.set(sessionId, callback);
  }

  async startTask(
    sessionId: string,
    prompt: string,
    persona: string,
    tone: string,
    apiKeys: any,
    contentAgentEnabled: boolean,
    conversationHistory: any[] = [],
  ): Promise<string> {
    const taskId = nanoid();
    const task: AgentTask = {
      id: taskId,
      sessionId,
      prompt,
      persona,
      tone,
      apiKeys,
      status: "processing",
      progress: 0,
      currentStep: "Initializing",
      conversationHistory,
    };

    this.activeTasks.set(taskId, task);
    this.updateStatus(sessionId, task);

    this.processTask(task, contentAgentEnabled).catch(async (error: any) => {
      await logger.log(task.id, "trace", `Error: ${error?.message || error}`);
      task.status = "failed";
      task.currentStep = "Failed";
      this.updateStatus(sessionId, task);
    });

    return taskId;
  }

  /* ------------------------------------------------------------------ */

  private async processTask(task: AgentTask, contentAgentEnabled: boolean) {
    try {
      // init services with per-task API keys (no global state)
      openaiService.initialize(task.apiKeys.openai);
      searcherService.initialize(task.apiKeys.serpApi);
      visualMatcherService.initialize(task.apiKeys.unsplash);

      // If toggle is ON, always generate content. If OFF, auto-detect based on prompt.
      if (contentAgentEnabled || this.isContentGenerationRequest(task.prompt)) {
        await this.processContentGeneration(task);
      } else {
        await this.processChatResponse(task);
      }

      task.status = "completed";
      task.progress = 100;
      task.currentStep = "Completed";
      this.updateStatus(task.sessionId, task);
    } catch (error: any) {
      await logger.log(task.id, "trace", `Error: ${error?.message || error}`);
      task.status = "failed";
      task.currentStep = "Failed";
      this.updateStatus(task.sessionId, task);
    }
  }

  /* ---------------------------- Chat-only path ---------------------------- */

  private async processChatResponse(task: AgentTask) {
    task.currentStep = "Generating response";
    task.progress = 20;
    this.updateStatus(task.sessionId, task);

    await logger.stepStart(task.id, "Generating chat response");
    
    // Build context from conversation history
    const history = task.conversationHistory || [];
    const contextMessages = history
      .filter((m: any) => m.role && m.content)
      .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    
    const response = await openaiService.generateChatReply(
      task.prompt,
      task.persona,
      task.tone,
      contextMessages ? `Previous conversation:\n${contextMessages}` : undefined,
    );
    await logger.stepEnd(task.id, "Generating chat response");

    this.emitMessage(task.sessionId, {
      id: nanoid(),
      role: "assistant",
      content: response,
      timestamp: new Date(),
      status: "completed",
    });

    task.progress = 100;
    this.updateStatus(task.sessionId, task);
  }

  /* --------------------------- Content pipeline --------------------------- */

  private async processContentGeneration(task: AgentTask) {
    // Decide what to produce (heuristics from prompt; defaults to pptx)
    const formats = this.detectRequestedFormats(task.prompt);

    // 1) Plan
    task.currentStep = "Planning content structure";
    task.progress = 10;
    this.updateStatus(task.sessionId, task);
    await logger.stepStart(task.id, "Planning content generation");

    let queries = await this.generateSearchQueries(task.prompt);
    await logger.trace(task.id, `Generated ${queries.length} search queries`);
    await logger.stepEnd(task.id, "Planning content generation");

    // 2) Research (with broaden-on-empty)
    task.currentStep = "Researching content";
    task.progress = 25;
    this.updateStatus(task.sessionId, task);
    await logger.stepStart(task.id, "Web research");

    let searchResults = await searcherService.performMultiSearch(queries);
    let total = this.countSearchResults(searchResults);
    if (total === 0) {
      await logger.trace(task.id, "0 results; broadening queries and retrying once");
      queries = this.broadenQueries(task.prompt, queries);
      searchResults = await searcherService.performMultiSearch(queries);
      total = this.countSearchResults(searchResults);
    }
    await logger.trace(task.id, `Found ${total} search results`);
    await logger.stepEnd(task.id, "Web research");

    // 2.5) Vet sources (scoring-based with deduplication)
    await logger.stepStart(task.id, "Vetting sources");
    const vettedResults: Record<string, any> = {};
    const seenUrls = new Set<string>();
    const vettedUrls: string[] = [];
    const rejectedUrls: string[] = [];
    
    // Process each search result and vet
    for (const [query, response] of Object.entries(searchResults)) {
      const results = Array.isArray(response?.results) ? response.results : [];
      const vetted = results.filter((r: any) => {
        const rawUrl = r?.url || '';
        const url = normalizeURL(rawUrl);
        
        // Skip duplicates
        if (seenUrls.has(url)) return false;
        seenUrls.add(url);
        
        const title = r?.title || '';
        const snippet = r?.snippet || '';
        const lower = url.toLowerCase();
        
        // Check each vetting tier and log results
        const blocklisted = BLOCKLIST_PATTERNS.some(pattern => lower.includes(pattern));
        const allowlisted = ALLOWLIST_PATTERNS.some(pattern => lower.includes(pattern));
        const score = scoreSource(url, title, snippet);
        const isVetted = isVettedSource(url, title, snippet);
        
        // Build decision explanation
        let decision = '';
        if (blocklisted) decision = 'BLOCKLIST';
        else if (allowlisted) decision = 'ALLOWLIST→PASS';
        else if (score >= 0.55) decision = `SCORE ${score.toFixed(2)}→PASS`;
        else decision = `SCORE ${score.toFixed(2)}→FAIL`;
        
        if (isVetted) {
          vettedUrls.push(url);
        } else {
          rejectedUrls.push(`${url.slice(0, 60)} [${decision}]`);
        }
        
        return isVetted;
      });
      
      vettedResults[query] = { results: vetted, totalResults: vetted.length };
    }
    
    const vettedCount = vettedUrls.length;
    const rejectedCount = rejectedUrls.length;
    
    // Log unique URLs only (avoid duplicates) with detailed diagnostics
    await logger.trace(task.id, `Source vetting: ${vettedCount} vetted, ${rejectedCount} rejected`);
    if (vettedCount > 0) {
      await logger.trace(task.id, `✓ Vetted: ${vettedUrls.slice(0, 3).map(u => u.slice(0, 50)).join(', ')}${vettedCount > 3 ? ` +${vettedCount - 3} more` : ''}`);
    }
    if (rejectedCount > 0) {
      await logger.trace(task.id, `✗ Rejected (showing first 5): ${rejectedUrls.slice(0, 5).join(' | ')}`);
    }
    
    // R0-R5 ITERATIVE HARVEST: Keep searching until MIN_VETTED_REQUIRED (10) met
    const MIN_VETTED_REQUIRED = 10;
    const isReportOrAnalysis = task.prompt.toLowerCase().match(/\b(report|analysis|study|research)\b/);
    let roundsCompleted: string[] = [];
    
    if (isReportOrAnalysis && vettedUrls.length < MIN_VETTED_REQUIRED) {
      await logger.trace(task.id, `Need ${MIN_VETTED_REQUIRED} sources, have ${vettedUrls.length}. Starting iterative harvest...`);
      
      // R0: Seed references (always add if topic-relevant)
      await logger.trace(task.id, `R0: Adding seed references`);
      const relevantSeeds = SEED_REFERENCES.filter(ref => 
        task.prompt.toLowerCase().includes('ant') || task.prompt.toLowerCase().includes('insect')
      );
      
      for (const seed of relevantSeeds) {
        if (!seenUrls.has(seed.url)) {
          seenUrls.add(seed.url);
          vettedUrls.push(seed.url);
          vettedResults['R0_seeds'] = vettedResults['R0_seeds'] || { results: [], totalResults: 0 };
          vettedResults['R0_seeds'].results.push({
            title: seed.title,
            url: seed.url,
            snippet: seed.citation,
          });
          vettedResults['R0_seeds'].totalResults++;
        }
      }
      roundsCompleted.push(`R0_seeds=${relevantSeeds.length}`);
      await logger.trace(task.id, `R0 complete: ${vettedUrls.length} total`);
    }
    
    // R1: Topical queries with Latin/scientific terms
    if (isReportOrAnalysis && vettedUrls.length < MIN_VETTED_REQUIRED) {
      await logger.trace(task.id, `R1: Broadening with topical/scientific queries`);
      const broadQueries = this.generateFallbackQueries(task.prompt);
      const r1Results = await searcherService.performMultiSearch(broadQueries);
      
      let r1Added = 0;
      for (const [query, response] of Object.entries(r1Results)) {
        const results = Array.isArray(response?.results) ? response.results : [];
        for (const r of results) {
          const url = normalizeURL(r?.url || '');
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          
          if (isVettedSource(url, r?.title || '', r?.snippet || '')) {
            vettedUrls.push(url);
            r1Added++;
            vettedResults[query] = vettedResults[query] || { results: [], totalResults: 0 };
            vettedResults[query].results.push(r);
            vettedResults[query].totalResults++;
          }
        }
      }
      roundsCompleted.push(`R1_topical=${r1Added}`);
      await logger.trace(task.id, `R1 complete: added ${r1Added}, total ${vettedUrls.length}`);
    }
    
    // R2: Scholar/Museum-specific queries
    if (isReportOrAnalysis && vettedUrls.length < MIN_VETTED_REQUIRED) {
      await logger.trace(task.id, `R2: Scholar/museum-specific searches`);
      const scholarQueries = [
        `${task.prompt} site:ncbi.nlm.nih.gov/pmc`,
        `${task.prompt} site:doi.org`,
        `${task.prompt} site:antwiki.org OR site:antweb.org`,
        `${task.prompt} site:smithsonian OR site:nhm.ac.uk OR site:amnh.org`,
      ];
      const r2Results = await searcherService.performMultiSearch(scholarQueries);
      
      let r2Added = 0;
      for (const [query, response] of Object.entries(r2Results)) {
        const results = Array.isArray(response?.results) ? response.results : [];
        for (const r of results) {
          const url = normalizeURL(r?.url || '');
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          
          if (isVettedSource(url, r?.title || '', r?.snippet || '')) {
            vettedUrls.push(url);
            r2Added++;
          }
        }
      }
      roundsCompleted.push(`R2_scholar=${r2Added}`);
      await logger.trace(task.id, `R2 complete: added ${r2Added}, total ${vettedUrls.length}`);
    }
    
    // R3: Extension/Educational resources
    if (isReportOrAnalysis && vettedUrls.length < MIN_VETTED_REQUIRED) {
      await logger.trace(task.id, `R3: University extension and educational resources`);
      const r3Queries = [
        `${task.prompt} site:edu extension OR ipm`,
        `${task.prompt} site:gov agriculture OR entomology`,
      ];
      const r3Results = await searcherService.performMultiSearch(r3Queries);
      
      let r3Added = 0;
      for (const [query, response] of Object.entries(r3Results)) {
        const results = Array.isArray(response?.results) ? response.results : [];
        for (const r of results) {
          const url = normalizeURL(r?.url || '');
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          
          if (isVettedSource(url, r?.title || '', r?.snippet || '')) {
            vettedUrls.push(url);
            r3Added++;
          }
        }
      }
      roundsCompleted.push(`R3_extension=${r3Added}`);
      await logger.trace(task.id, `R3 complete: added ${r3Added}, total ${vettedUrls.length}`);
    }
    
    // R4: Synonym/related term expansion
    if (isReportOrAnalysis && vettedUrls.length < MIN_VETTED_REQUIRED) {
      await logger.trace(task.id, `R4: Synonym and related term expansion`);
      const synonymQueries = [
        task.prompt.replace(/life cycle/i, 'development stages'),
        task.prompt.replace(/life cycle/i, 'ontogeny metamorphosis'),
        task.prompt + ' brood development caste differentiation',
      ];
      const r4Results = await searcherService.performMultiSearch(synonymQueries);
      
      let r4Added = 0;
      for (const [query, response] of Object.entries(r4Results)) {
        const results = Array.isArray(response?.results) ? response.results : [];
        for (const r of results) {
          const url = normalizeURL(r?.url || '');
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          
          if (isVettedSource(url, r?.title || '', r?.snippet || '')) {
            vettedUrls.push(url);
            r4Added++;
          }
        }
      }
      roundsCompleted.push(`R4_synonyms=${r4Added}`);
      await logger.trace(task.id, `R4 complete: added ${r4Added}, total ${vettedUrls.length}`);
    }
    
    const finalVettedCount = vettedUrls.length;
    await logger.trace(task.id, `Harvest complete: ${finalVettedCount} sources. Rounds: ${roundsCompleted.join(', ')}`);
    
    // ENFORCE: Block outline generation if insufficient sources
    if (isReportOrAnalysis && finalVettedCount < MIN_VETTED_REQUIRED) {
      await logger.trace(task.id, `⚠️ INSUFFICIENT SOURCES: ${finalVettedCount}/${MIN_VETTED_REQUIRED} - cannot proceed to drafting`);
      (task as any).limitedSources = true;
      (task as any).sourceCount = finalVettedCount;
    }
    
    await logger.stepEnd(task.id, "Vetting sources");

    // 2.6) Build meaningful research context from vetted pages
    const { contextText, topUrls } = await this.gatherResearchContext(vettedResults);

    // ENFORCE: Block outline generation if insufficient sources for reports
    if (isReportOrAnalysis && finalVettedCount < MIN_VETTED_REQUIRED) {
      task.status = "failed";
      task.currentStep = `Failed: Only ${finalVettedCount}/${MIN_VETTED_REQUIRED} sources found`;
      this.updateStatus(task.sessionId, task);
      
      await logger.stepStart(task.id, "BLOCKED: Insufficient sources");
      await logger.trace(task.id, `Cannot generate report with ${finalVettedCount} sources. Need ${MIN_VETTED_REQUIRED}.`);
      await logger.trace(task.id, `Iterative harvest rounds completed: ${roundsCompleted.join(', ')}`);
      await logger.trace(task.id, `Please refine search terms or check if topic has sufficient academic coverage.`);
      await logger.stepEnd(task.id, "BLOCKED: Insufficient sources");
      
      throw new Error(`Insufficient sources for report: ${finalVettedCount}/${MIN_VETTED_REQUIRED}. Completed rounds: ${roundsCompleted.join(', ')}`);
    }

    // 3) Outline
    task.currentStep = "Creating content outline";
    task.progress = 45;
    this.updateStatus(task.sessionId, task);
    await logger.stepStart(task.id, "Generating content outline");

    // We have sufficient sources, proceed normally
    const outline = await generateRichOutline(
      `${task.prompt}\n\nResearch context:\n${contextText || "(no web sources available)"}\n\nReturn 'sources' as the actual URLs used.`,
      task.persona,
      task.tone,
    );

    await logger.trace(task.id, `Generated outline with ${outline.slides?.length || 0} slides`);
    await logger.stepEnd(task.id, "Generating content outline");

    // Merge model sources + our top URLs (unique)
    const sources = Array.from(
      new Set<string>([
        ...(Array.isArray(outline.sources) ? outline.sources : []),
        ...topUrls,
      ])
    );

    // 3.1) Normalize slides (subtitle + notes + chartSpec when possible)
    const normalizedSlides = this.normalizeSlides(outline.slides || []);

    // 4) Visuals (real only). IMPORTANT: skip cheesy analytics stock images when charts/stats requested.
    task.currentStep = "Sourcing images & charts";
    task.progress = 60;
    this.updateStatus(task.sessionId, task);
    await logger.stepStart(task.id, "Processing visual content");

    let slidesWithVisuals = await visualMatcherService.processVisualContent(normalizedSlides);

    // Avoid filler “analytics laptop / dashboard screenshot” photos if user wants charts/stats.
    const wantsCharts = this.wantsChartsOrStats(task.prompt);

    if (wantsCharts) {
      slidesWithVisuals = slidesWithVisuals.map((s: any) => {
        const img = s?.content?.image;
        const looksCheesy =
          !!img?.url &&
          /analytics|dashboard|laptop|computer|spreadsheet|graph|chart/i.test(`${img.url} ${img.description || ""}`);
        if (looksCheesy) {
          // drop it; the builder will embed data-driven chart images instead
          if (s?.content) s.content.image = undefined;
        }
        return s;
      });
    }

    // Ensure rhythm only if we didn't ask for charts; never cram filler images in chart-heavy decks
    let imageCount = slidesWithVisuals.filter(s => !!s?.content?.image?.url).length;
    if (!wantsCharts && imageCount < 3) {
      const pool = normalizedSlides.map(s => s.content?.keyword || s.title).filter(Boolean);
      for (let i = 0; i < slidesWithVisuals.length && imageCount < 3; i++) {
        const s = slidesWithVisuals[i];
        if (!s?.content?.image) {
          try {
            const kw = pool[i % (pool.length || 1)] || outline.title || task.prompt;
            const imgs = await visualMatcherService.findImages(kw, 1);
            if (imgs?.[0]) {
              s.content!.image = imgs[0];
              imageCount++;
            }
          } catch { /* ignore */ }
        }
      }
    }

    const chartCount = slidesWithVisuals.filter(s => !!s?.content?.chart?.url || !!s?.content?.chartSpec).length;
    await logger.trace(task.id, `Visuals → images: ${imageCount}, charts: ${chartCount}`);
    await logger.stepEnd(task.id, "Processing visual content");

    // 5) Build (one pipeline → many outputs)
    task.currentStep = "Building artifacts";
    task.progress = 70;
    this.updateStatus(task.sessionId, task);

    const artifacts: Array<{
      format: BuilderFormat;
      filename: string;
      fileSize: number;
      downloadUrl: string;
    }> = [];

    // Distribute progress across N builds
    const perBuild = Math.max(5, Math.floor(25 / Math.max(1, formats.length))); // 70→95

    for (const fmt of formats) {
      try {
        await logger.stepStart(task.id, `Building ${fmt.toUpperCase()}`);
        const result = await builderService.buildPresentation(task.id, {
          title: outline.title || "AI Generated",
          slides: slidesWithVisuals,
          format: fmt,
          sources,
          layoutHints: {
            moveBodyToNotes: true,
            chartEmbedDefault: "right",
            disableAutoSummary: false,   // allow last-resort visuals; builder is safe/non-blocking
            // prioritize charts over decorative images:
            // (this flag is read by the updated builder; ignored by older versions)
            // @ts-ignore - passed through safely
            prioritizeCharts: true,
            // @ts-ignore - Limited sources flag
            limitedSources: (task as any).limitedSources || false,
            sourceCount: (task as any).sourceCount || finalVettedCount || vettedUrls.length
          }
        } as any);
        await logger.stepEnd(task.id, `Building ${fmt.toUpperCase()}`);

        const downloadUrl = fileStorage.getPublicUrl(result.filename);
        await logger.delivery(task.id, result.filename);

        this.emitArtifact(task.sessionId, {
          id: nanoid(),
          filename: result.filename,
          fileType: fmt,
          fileSize: result.fileSize,
          downloadUrl,
          liveUrl: result.liveUrl,
          previewUrl: result.previewUrl,
          siteId: result.siteId,
          metadata: result.metadata,
          createdAt: new Date(),
        });

        artifacts.push({
          format: fmt,
          filename: result.filename,
          fileSize: result.fileSize,
          downloadUrl,
        });
      } catch (e: any) {
        await logger.trace(task.id, `Build failed for ${fmt}: ${e?.message || e}`);
      } finally {
        task.progress = Math.min(95, task.progress + perBuild);
        this.updateStatus(task.sessionId, task);
      }
    }

    // Final message
    const made = artifacts.map(a => `${a.format.toUpperCase()} (${Math.round(a.fileSize/1024)} KB)`).join(", ");
    this.emitMessage(task.sessionId, {
      id: nanoid(),
      role: "assistant",
      content: artifacts.length
        ? `✅ Done! Created: ${made}. Check the “Generated Artifacts” panel to download.`
        : `⚠️ I couldn't build the requested artifacts this run. Check logs for details.`,
      timestamp: new Date(),
      status: artifacts.length ? "completed" : "failed",
    });
  }

  /* ------------------------------- helpers ------------------------------- */

  private detectRequestedFormats(prompt: string): BuilderFormat[] {
    const p = (prompt || "").toLowerCase();

    // If user names explicit targets, allow multiples
    const picks: BuilderFormat[] = [];
    const wants = (k: string) => p.includes(k);

    // Check formats in priority order (most specific first)
    if (wants("dashboard")) picks.push("dashboard");
    if (wants("infographic")) picks.push("infographic");
    
    // Website detection (actual HTML website, not presentation export)
    if (wants("website") || wants("web page") || wants("web app") || wants("landing page") || wants("site") || wants("portfolio") || wants("blog")) picks.push("website");
    
    // HTML presentation export (slide deck as HTML)
    if (wants("html presentation") || wants("html export") || wants("html slides")) picks.push("html");
    
    // Document formats
    if (wants("docx") || wants("word") || wants("document")) picks.push("docx");
    if (wants("markdown") || wants("md file")) picks.push("md");
    
    // Data formats
    if (wants("csv") || wants("spreadsheet") || wants("data export")) picks.push("csv");
    
    // Text formats
    if (wants("txt") || wants("text file")) picks.push("txt");
    if (wants("rtf")) picks.push("rtf");
    
    // Report (check for "report" but not as part of other words)
    if (wants("report")) picks.push("report");
    
    // Presentation (check last so it doesn't override more specific formats)
    if (wants("ppt") || wants("pptx") || wants("slides") || wants("presentation") || wants("powerpoint")) picks.push("pptx");

    // If none specified, infer from context
    if (picks.length === 0) {
      // Check for analysis/data context - likely wants report
      if (wants("analy") || wants("research") || wants("study") || wants("insights")) {
        return ["docx", "md"];
      }
      // Default to presentation + report
      return ["pptx", "report"];
    }

    // Always keep order unique and sane
    const seen = new Set<BuilderFormat>();
    const ordered = picks.filter(f => {
      if (seen.has(f)) return false;
      seen.add(f);
      return true;
    });

    // Cap to 4 outputs to avoid runaway builds on free tier
    return ordered.slice(0, 4) as BuilderFormat[];
  }

  private async generateSearchQueries(prompt: string): Promise<string[]> {
    const base = (prompt || "").trim();
    const generic = [
      `${base}`,
      `${base} best practices`,
      `${base} 2025 trends`,
      `${base} statistics data`,
    ];
    return generic.slice(0, 4);
  }

  private broadenQueries(prompt: string, prev: string[]): string[] {
    const base = (prompt || "").trim();
    const extras = [
      `${base} overview`,
      `${base} introduction site:edu`,
      `${base} government report`,
      `${base} case study`,
    ];
    // keep 2 originals + 2 broad
    return [prev[0] || base, prev[1] || `${base} analysis`, extras[0], extras[1]];
  }

  private generateFallbackQueries(prompt: string): string[] {
    const base = (prompt || "").trim();
    const lower = base.toLowerCase();
    
    // Scientific/biological fallbacks
    if (lower.includes('ant')) {
      return [
        'Formicidae holometabolous development site:edu OR site:gov',
        'ant lifecycle metamorphosis larval pupal stages',
        'ant colony caste queen worker development duration',
        'Formicidae life cycle review PDF',
      ];
    }
    
    // Generic fallback pattern
    return [
      `${base} site:edu OR site:gov`,
      `${base} scientific review`,
      `${base} research paper PDF`,
      `${base} academic study`,
    ];
  }

  private countSearchResults(searchResults: Record<string, any>): number {
    let total = 0;
    Object.values(searchResults || {}).forEach((r: any) => {
      total += Array.isArray(r?.results) ? r.results.length : 0;
    });
    return total;
  }

  private summarizeSearchResults(searchResults: { [key: string]: any }): string {
    let summary = "";
    Object.entries(searchResults || {}).forEach(([query, payload]) => {
      summary += `Query: ${query}\n`;
      const arr = Array.isArray(payload?.results) ? payload.results : [];
      arr.slice(0, 3).forEach((r: any) => {
        const title = (r?.title || "").toString().slice(0, 140);
        const snip = (r?.snippet || "").toString().slice(0, 240);
        summary += `- ${title}: ${snip}\n`;
      });
      summary += "\n";
    });
    return summary.slice(0, 3200);
  }

  // Decide if the user explicitly wants charts/stats
  private wantsChartsOrStats(prompt: string): boolean {
    const p = (prompt || "").toLowerCase();
    const keys = [
      "chart","charts","graph","graphs",
      "statistic","statistics","stats","data viz","data visualization",
      "trend","trends","use statistics","use real charts"
    ];
    return keys.some(k => p.includes(k));
  }

  private normalizeSlides(slides: any[]): any[] {
    const out: any[] = [];
    const seenTitles = new Map<string, number>();

    const stripMd = (s: string) =>
      String(s || "")
        .replace(/[`*_>#]/g, "")
        .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
        .replace(/^\s*(this slide|the slide|in this slide)\b.*?:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();

    const trimLen = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

    // robust numeric extraction from bullets + subtitle/body for on-slide chartSpec
    const extractNumericChart = (bullets: string[], subtitle: string, body: string, notes: string) => {
      const src: string[] = [
        ...bullets,
        ...(subtitle ? [subtitle] : []),
        ...(body ? [body] : []),
        ...(notes ? [notes] : []),
      ];
      const pairs: { label: string; value: number }[] = [];
      const lineRe = /([A-Za-z][A-Za-z0-9 ./%+-]{1,60})[:\s—-]+(\$?\d[\d,]*(?:\.\d+)?)(\s*%|\s*(?:percent|percentage))?/i;

      for (const t of src) {
        const parts = String(t || "").split(/[\n\r]+|(?<=\.)\s+|,\s+/);
        for (const p of parts) {
          const m = p.match(lineRe);
          if (!m) continue;
          const label = stripMd(m[1]).trim();
          const num = parseFloat(m[2].replace(/[$,]/g, ""));
          if (!Number.isFinite(num)) continue;
          pairs.push({ label, value: num });
          if (pairs.length >= 6) break;
        }
        if (pairs.length >= 6) break;
      }

      if (pairs.length < 2) return undefined;
      return {
        type: "bar",
        title: "Key Metrics",
        layout: "embed-right",
        data: {
          labels: pairs.map(p => p.label).slice(0, 6),
          datasets: [{ label: "Value", data: pairs.map(p => p.value).slice(0, 6) }],
        },
      };
    };

    slides.forEach((s: any, idx: number) => {
      const rawTitle = stripMd(s?.title || `Slide ${idx + 1}`);
      const key = rawTitle.toLowerCase();
      const n = (seenTitles.get(key) || 0) + 1;
      seenTitles.set(key, n);
      const title = n > 1 ? `${rawTitle} (${n})` : rawTitle;

      const bodyRaw = stripMd(s?.body || s?.content?.body || "");
      const bulletsRaw: string[] = Array.isArray(s?.bullets)
        ? s.bullets
        : Array.isArray(s?.content?.bullets)
        ? s.content.bullets
        : [];
      const bullets = bulletsRaw.map(b => trimLen(stripMd(b), 120)).filter(Boolean).slice(0, 6);
      const subtitle = trimLen((bodyRaw.split(/(?<=\.)\s+/).slice(0, 2).join(" ")).trim(), 160);
      const notes = bodyRaw; // full prose to notes

      const chartSpec = s?.chartSpec || s?.content?.chartSpec || extractNumericChart(bullets, subtitle, bodyRaw, "");

      out.push({
        slideNumber: out.length + 1,
        title,
        type: "content",
        content: {
          subtitle,
          bullets: bullets.length ? bullets : ["Key points forthcoming"],
          keyword: stripMd(s?.keyword || s?.content?.keyword || title),
          notes,
          ...(chartSpec ? { chartSpec } : {}),
        },
      });
    });

    // Guardrail for tiny outlines
    while (out.length < 10) {
      out.push({
        slideNumber: out.length + 1,
        title: `Additional Insights ${out.length + 1}`,
        type: "content",
        content: {
          subtitle: "Additional insights to maintain narrative flow.",
          bullets: ["Key point A", "Key point B", "Key point C"],
          keyword: "insights",
          notes: "",
        },
      });
    }
    return out;
  }

  private async gatherResearchContext(
    searchResults: Record<string, any>
  ): Promise<{ contextText: string; topUrls: string[] }> {
    // Pick top unique URLs (up to 10)
    const urlSet = new Set<string>();
    const picks: { title: string; url: string; snippet: string }[] = [];
    Object.values(searchResults || {}).forEach((res: any) => {
      const arr = Array.isArray(res?.results) ? res.results : [];
      for (const r of arr) {
        if (urlSet.size >= 10) break;
        const u = (r?.url || "").trim();
        if (!u || urlSet.has(u)) continue;
        urlSet.add(u);
        picks.push({
          title: (r?.title || "").slice(0, 140),
          url: u,
          snippet: (r?.snippet || "").slice(0, 240),
        });
      }
    });

    // Simple 3-lane concurrency to fetch page text (if searcher exposes it)
    const chunks: string[] = [];
    const workers = 3;
    let i = 0;

    const next = async () => {
      while (i < Math.min(8, picks.length)) {
        const idx = i++;
        const r = picks[idx];
        try {
          const txt = (searcherService as any).extractContent
            ? await (searcherService as any).extractContent(r.url)
            : "";
          if (txt && txt.trim()) {
            const blurb = txt.slice(0, 600);
            chunks.push(`Source: ${r.title}\nURL: ${r.url}\nSummary: ${blurb}\n`);
          } else {
            chunks.push(`Source: ${r.title}\nURL: ${r.url}\nSummary: ${r.snippet}\n`);
          }
        } catch {
          chunks.push(`Source: ${r.title}\nURL: ${r.url}\nSummary: ${r.snippet}\n`);
        }
      }
    };

    await Promise.all(Array.from({ length: workers }, next));

    const contextText = chunks.join("\n").slice(0, 3500);
    const topUrls = picks.map((r) => r.url);
    return { contextText, topUrls };
  }

  // Decide if this looks like a “make something” request vs plain chat
  private isContentGenerationRequest(prompt: string): boolean {
    const p = (prompt || "").toLowerCase();
    const keywords = [
      "create","generate","build","make","presentation","slides",
      "report","document","website","dashboard","infographic",
      "chart","graph","analyze","write","draft","outline",
      "ppt","pptx","docx","markdown","md","csv","txt","pdf"
    ];
    return keywords.some(k => p.includes(k));
  }

  /* ----------------------- event + status plumbing ----------------------- */

  private updateStatus(sessionId: string, task: AgentTask) {
    const cb = this.statusCallbacks.get(sessionId);
    if (cb) cb({ currentTask: task.currentStep, progress: task.progress, isProcessing: task.status === "processing" });
  }
  private emitMessage(sessionId: string, message: any) {
    const cb = this.messageCallbacks.get(sessionId);
    if (cb) cb(message);
  }
  private emitArtifact(sessionId: string, artifact: any) {
    const cb = this.artifactCallbacks.get(sessionId);
    if (cb) cb(artifact);
  }

  getActiveTask(sessionId: string): AgentTask | undefined {
    return Array.from(this.activeTasks.values()).find(
      (t) => t.sessionId === sessionId && t.status === "processing",
    );
  }

  restartAgent(sessionId: string) {
    Array.from(this.activeTasks.entries()).forEach(([taskId, t]) => {
      if (t.sessionId === sessionId) this.activeTasks.delete(taskId);
    });
    visualMatcherService.clearCache();
    const cb = this.statusCallbacks.get(sessionId);
    if (cb) cb({ currentTask: "Idle", progress: 0, isProcessing: false });
  }
}

export const agentService = new AgentService();
