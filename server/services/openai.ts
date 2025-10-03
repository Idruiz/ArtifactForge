// server/services/openai.ts
// Multi-artifact OpenAI service (Chat Completions + function calling only)
// - No Responses API calls here
// - No temperature/top_p/verbosity/reasoning params (avoid model incompatibility)
// - Uses max_completion_tokens (NOT max_tokens)
// - Dynamic min-sources via process.env.MIN_SOURCES
// Generators: outline, report, website, dataset, quiz, content calendar, flowchart.

import OpenAI from "openai";
import { logger } from "../utils/logger";

/* ─────────────────────────── Config ─────────────────────────── */

function getMinSources(): number {
  // Read at call time so agent can temporarily override via process.env.MIN_SOURCES
  const n = Number(process.env.MIN_SOURCES || 1);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const MAX_COMPLETION_TOKENS = 9000;

/* ─────────────────────────── Types ─────────────────────────── */

export interface RichOutline {
  title: string;
  slides: Array<{
    title: string;
    body: string;
    bullets: string[];
    keyword: string;
    chartSpec?: {
      type: "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";
      title?: string;
      data?: Record<string, unknown>;
    };
  }>;
  sources: string[];
}

export interface ReportDoc {
  title: string;
  sections: Array<{ heading: string; body: string; bullets?: string[] }>;
  sources: string[];
}

export interface WebsiteBundle {
  title: string;
  files: Array<{ path: string; content: string }>; // must include index.html
}

export interface DatasetTable {
  title: string;
  columns: string[];
  rows: string[][];
  notes?: string;
}

export interface QuizSpec {
  title: string;
  questions: Array<{
    prompt: string;
    type: "single" | "multiple" | "short";
    options?: string[];
    answer: number[] | string; // indices for single/multiple; free text for short
  }>;
}

export interface ContentCalendar {
  title: string;
  items: Array<{
    date: string;    // YYYY-MM-DD
    platform: string;
    topic: string;
    copy: string;
    assets?: string[];
  }>;
}

export interface FlowchartSpec {
  title: string;
  mermaid: string; // e.g., graph TD; A-->B;
  description?: string;
}

/* ─────────────────────────── Service ─────────────────────────── */

type ValidationResult = { ok: true } | { ok: false; reason: string };

class OpenAIService {
  private client: OpenAI | null = null;
  private model: string = DEFAULT_MODEL;

  initialize(apiKey: string, model?: string) {
    if (!apiKey) throw new Error("OpenAI API key missing");
    this.client = new OpenAI({ apiKey });
    if (model) this.model = model;
  }

  /* ---------------- Chat (plain) ---------------- */

  async generateChatReply(
    userMessage: string,
    persona: string,
    tone: string,
    context?: string,
  ): Promise<string> {
    if (!this.client) throw new Error("OpenAI not initialized");
    const sys =
      this.getPersonaPrompt(persona, tone) +
      (context ? `\n\nContext:\n${context}` : "");

    await logger.trace?.("openaiService", `chat model=${this.model} max_completion_tokens=${MAX_COMPLETION_TOKENS}`);

    const r = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMessage },
      ] as any,
      max_completion_tokens: MAX_COMPLETION_TOKENS as any,
    } as any);

    return r.choices?.[0]?.message?.content?.trim() || "";
  }

  /* ---------------- Outline (presentation) ---------------- */

  async generateRichOutline(
    topic: string,
    persona: string,
    tone: string,
  ): Promise<RichOutline> {
    if (!this.client) throw new Error("OpenAI not initialized");

    const sys = [
      this.getPersonaPrompt(persona, tone),
      "You will produce a professional, research-grounded presentation outline with DEEP ANALYSIS and PROPER CITATIONS.",
      "",
      "CRITICAL RULES FOR ANALYSIS:",
      "1. ANALYZE & INFER: Extract insights, patterns, and implications from research context.",
      "2. COMPUTE: When numbers appear in research, calculate percentages, rates, comparisons, trends.",
      "3. SYNTHESIZE: Combine multiple sources to draw conclusions; don't just copy-paste.",
      "4. REASON: Every slide body must contain actual reasoning, not placeholders or meta-text.",
      "5. CITE SOURCES: Use inline citation tags [Source1], [Source2] etc. for every factual claim.",
      "6. STRUCTURE: Use research context in at least 7 slide bodies with narrative citations.",
      "",
      "CITATION REQUIREMENTS:",
      "- Every factual claim MUST include an inline citation tag: [Source1], [Source2], etc.",
      "- Map citation numbers to the URLs in your sources array (Source1 = sources[0], Source2 = sources[1])",
      "- Example: 'Worker ants live 1-3 years [Source1], while queens can survive 15-30 years [Source2].'",
      "- At minimum, include 5+ citations across all slide bodies",
      "",
      "FORBIDDEN (will cause rejection):",
      "- Meta language: 'This slide will...', 'presentation', 'template', 'will include', 'will describe'",
      "- Placeholders: 'TBD', 'to be determined', 'example data', '[insert]', 'pedagogic construct'",
      "- Future tense for content: Use present/past tense for actual findings",
      "- Empty analysis: Every body must have substance, not generic statements",
      "- Uncited facts: EVERY claim must have a citation tag",
      "",
      "DATA & CHARTS:",
      "- Include chartSpec ONLY when you have real numbers from research to visualize",
      "- Extract data from research context and compute derived metrics",
      "- For data analysis requests: compute percentages, rates, and comparative statistics",
      "- Do NOT fabricate numbers - but DO calculate from provided data",
      "- Chart titles must reference the cited source: 'Colony Growth Rates [Source3]'",
      "",
      "QUALITY CHECKS:",
      "- Each slide title must be unique and specific (not 'Introduction', 'Overview')",
      "- Each body must be 600+ chars of substantive analysis with citations (not padding)",
      "- Bullets must be concrete findings/actions with citation tags where appropriate",
      "- Keyword should reflect actual content theme, not generic terms",
      "- Minimum 5 inline citations [SourceN] across all bodies",
      "",
      'When ready, call function "RichOutline" exactly once with the full object.',
    ].join("\n");

    const user = `Topic:\n${topic}`;

    await logger.trace?.("openaiService", `outline model=${this.model} minSources=${getMinSources()}`);

    const toolName = "RichOutline";
    const parameters = {
      type: "object",
      additionalProperties: false,
      required: ["title", "slides", "sources"],
      properties: {
        title: { type: "string", minLength: 8, maxLength: 200 },
        slides: {
          type: "array",
          minItems: 10,
          maxItems: 40,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "body", "bullets", "keyword"],
            properties: {
              title: { type: "string", minLength: 6, maxLength: 140 },
              body: { type: "string", minLength: 600 },
              bullets: {
                type: "array",
                minItems: 3,
                maxItems: 6,
                items: { type: "string", minLength: 6, maxLength: 200 },
              },
              keyword: { type: "string", minLength: 3, maxLength: 60 },
              chartSpec: {
                type: "object",
                additionalProperties: true,
                properties: {
                  type: { type: "string", enum: ["bar", "line", "area", "pie", "doughnut", "scatter"] },
                  title: { type: "string" },
                  data: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        sources: {
          type: "array",
          minItems: getMinSources(),        // dynamic at call time
          maxItems: 40,
          items: {
            type: "string",
            pattern: "^https?:\\/\\/",
            minLength: 10,
            maxLength: 400,
          },
        },
      },
    };

    const outline = await this.callTool<RichOutline>({
      system: sys,
      user,
      toolName,
      description: "Submit the complete, validated presentation outline as JSON.",
      parameters,
    });

    // Validate & repair gently (sources soft-checked; agent may merge URLs later)
    const v = this.validateRichOutline(outline);
    if (!v.ok) {
      const repaired = this.repairRichOutline(outline);
      const v2 = this.validateRichOutline(repaired);
      if (!v2.ok) throw new Error(`Outline validation failed: ${v2.reason}`);
      return repaired;
    }
    return outline;
  }

  /* ---------------- Report (sections) ---------------- */

  async generateReport(
    prompt: string,
    persona: string,
    tone: string,
  ): Promise<ReportDoc> {
    if (!this.client) throw new Error("OpenAI not initialized");

    const sys = [
      this.getPersonaPrompt(persona, tone),
      "Produce a structured report with sections and optional bullets. Include credible sources (URLs or plain text).",
      'When ready, call function "ReportDoc" once.',
    ].join("\n");

    const toolName = "ReportDoc";
    const parameters = {
      type: "object",
      additionalProperties: false,
      required: ["title", "sections", "sources"],
      properties: {
        title: { type: "string", minLength: 8 },
        sections: {
          type: "array",
          minItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["heading", "body"],
            properties: {
              heading: { type: "string", minLength: 4 },
              body: { type: "string", minLength: 400 },
              bullets: {
                type: "array",
                items: { type: "string", minLength: 4 },
              },
            },
          },
        },
        sources: {
          type: "array",
          minItems: 3,
          items: { type: "string", minLength: 6 },
        },
      },
    };

    const doc = await this.callTool<ReportDoc>({
      system: sys,
      user: prompt,
      toolName,
      description: "Return a complete report JSON object.",
      parameters,
    });

    if (!doc?.title || !doc.sections?.length) {
      throw new Error("Report generation failed: missing title/sections");
    }
    return doc;
  }

  /* ---------------- Website (bundle) ---------------- */

  async generateWebsite(
    prompt: string,
    persona: string,
    tone: string,
  ): Promise<WebsiteBundle> {
    if (!this.client) throw new Error("OpenAI not initialized");

    const sys = [
      this.getPersonaPrompt(persona, tone),
      "Generate a small static website bundle. Files must be self-contained (no build tools).",
      "Always include an index.html. Use relative paths only.",
      'When ready, call function "WebsiteBundle" once.',
    ].join("\n");

    const toolName = "WebsiteBundle";
    const parameters = {
      type: "object",
      additionalProperties: false,
      required: ["title", "files"],
      properties: {
        title: { type: "string", minLength: 6 },
        files: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "content"],
            properties: {
              path: { type: "string", minLength: 5 },  // e.g., "index.html", "styles.css", "app.js"
              content: { type: "string", minLength: 1 },
            },
          },
        },
      },
    };

    const bundle = await this.callTool<WebsiteBundle>({
      system: sys,
      user: prompt,
      toolName,
      description: "Return website files as JSON array.",
      parameters,
    });

    const hasIndex = (bundle.files || []).some((f) => /^index\.html?$/i.test(f.path));
    if (!hasIndex) throw new Error("Website bundle missing index.html");
    return bundle;
  }

  /* ---------------- Dataset (table) ---------------- */

  async generateDataset(
    prompt: string,
    persona: string,
    tone: string,
  ): Promise<DatasetTable> {
    if (!this.client) throw new Error("OpenAI not initialized");

    const sys = [
      this.getPersonaPrompt(persona, tone),
      "Generate a small tabular dataset. Keep it realistic and consistent.",
      'When ready, call function "DatasetTable" once.',
    ].join("\n");

    const toolName = "DatasetTable";
    const parameters = {
      type: "object",
      additionalProperties: false,
      required: ["title", "columns", "rows"],
      properties: {
        title: { type: "string", minLength: 6 },
        columns: {
          type: "array",
          minItems: 2,
          items: { type: "string", minLength: 1 },
        },
        rows: {
          type: "array",
          minItems: 3,
          items: {
            type: "array",
            items: { type: "string" },
          },
        },
        notes: { type: "string" },
      },
    };

    const ds = await this.callTool<DatasetTable>({
      system: sys,
      user: prompt,
      toolName,
      description: "Return dataset as columns + rows.",
      parameters,
    });

    // shape check: rows match columns length
    const colCount = ds.columns?.length || 0;
    if (!colCount || !(ds.rows?.length)) throw new Error("Dataset missing columns/rows");
    for (const r of ds.rows) if (r.length !== colCount) throw new Error("Row length mismatch");
    return ds;
  }

  /* ---------------- Quiz ---------------- */

  async generateQuiz(
    prompt: string,
    persona: string,
    tone: string,
  ): Promise<QuizSpec> {
    if (!this.client) throw new Error("OpenAI not initialized");

    const sys = [
      this.getPersonaPrompt(persona, tone),
      "Generate a quiz with a mix of question types.",
      'When ready, call function "QuizSpec" once.',
    ].join("\n");

    const toolName = "QuizSpec";
    const parameters = {
      type: "object",
      additionalProperties: false,
      required: ["title", "questions"],
      properties: {
        title: { type: "string", minLength: 6 },
        questions: {
          type: "array",
          minItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["prompt", "type", "answer"],
            properties: {
              prompt: { type: "string", minLength: 6 },
              type: { type: "string", enum: ["single", "multiple", "short"] },
              options: { type: "array", items: { type: "string" } },
              // Accept any for 'answer'; validate after call
              answer: {} as any,
            },
          },
        },
      },
    };

    const quiz = await this.callTool<QuizSpec>({
      system: sys,
      user: prompt,
      toolName,
      description: "Return quiz JSON.",
      parameters,
    });

    // sanity checks
    for (const q of quiz.questions) {
      if (q.type !== "short") {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          throw new Error("Choice question missing options");
        }
        if (!Array.isArray(q.answer)) throw new Error("Choice question answer must be array of indices");
      } else {
        if (Array.isArray(q.answer)) throw new Error("Short answer must be string");
      }
    }
    return quiz;
  }

  /* ---------------- Content Calendar ---------------- */

  async generateContentCalendar(
    prompt: string,
    persona: string,
    tone: string,
  ): Promise<ContentCalendar> {
    if (!this.client) throw new Error("OpenAI not initialized");

    const sys = [
      this.getPersonaPrompt(persona, tone),
      "Generate a 2–4 week social/content calendar.",
      'When ready, call function "ContentCalendar" once.',
    ].join("\n");

    const toolName = "ContentCalendar";
    const parameters = {
      type: "object",
      additionalProperties: false,
      required: ["title", "items"],
      properties: {
        title: { type: "string", minLength: 6 },
        items: {
          type: "array",
          minItems: 7,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "platform", "topic", "copy"],
            properties: {
              date: { type: "string", minLength: 8, maxLength: 10 },
              platform: { type: "string" },
              topic: { type: "string" },
              copy: { type: "string" },
              assets: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    };

    const cal = await this.callTool<ContentCalendar>({
      system: sys,
      user: prompt,
      toolName,
      description: "Return content calendar JSON.",
      parameters,
    });

    return cal;
  }

  /* ---------------- Flowchart (Mermaid) ---------------- */

  async generateFlowchart(
    prompt: string,
    persona: string,
    tone: string,
  ): Promise<FlowchartSpec> {
    if (!this.client) throw new Error("OpenAI not initialized");

    const sys = [
      this.getPersonaPrompt(persona, tone),
      "Create a concise Mermaid flowchart for the described workflow.",
      'When ready, call function "FlowchartSpec" once.',
    ].join("\n");

    const toolName = "FlowchartSpec";
    const parameters = {
      type: "object",
      additionalProperties: false,
      required: ["title", "mermaid"],
      properties: {
        title: { type: "string", minLength: 6 },
        mermaid: { type: "string", minLength: 10 },
        description: { type: "string" },
      },
    };

    const fc = await this.callTool<FlowchartSpec>({
      system: sys,
      user: prompt,
      toolName,
      description: "Return Mermaid flowchart JSON.",
      parameters,
    });

    if (!/^((graph\s+(TD|LR))|sequenceDiagram|classDiagram|stateDiagram)/.test(fc.mermaid.trim())) {
      await logger.trace?.("openaiService", "Flowchart mermaid header not recognized; continuing");
    }
    return fc;
  }

  /* ---------------- Core tool caller ---------------- */

  private async callTool<T>(args: {
    system: string;
    user: string;
    toolName: string;
    description: string;
    parameters: Record<string, unknown>;
  }): Promise<T> {
    if (!this.client) throw new Error("OpenAI not initialized");
    const { system, user, toolName, description, parameters } = args;

    const tools = [
      {
        type: "function" as const,
        function: {
          name: toolName,
          description,
          parameters,
        },
      },
    ];

    await logger.trace?.(
      "openaiService",
      `tool_call model=${this.model} tool=${toolName} max_completion_tokens=${MAX_COMPLETION_TOKENS}`
    );

    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ] as any,
      tools,
      tool_choice: { type: "function", function: { name: toolName } } as any,
      max_completion_tokens: MAX_COMPLETION_TOKENS as any,
    } as any);

    const choice = resp.choices?.[0];

    // Prefer tool_calls (modern)
    const toolCall = choice?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      return parseJsonLoose<T>(toolCall.function.arguments);
    }

    // Fallback: legacy function_call
    const legacy = (choice?.message as any)?.function_call;
    if (legacy?.arguments) {
      return parseJsonLoose<T>(legacy.arguments);
    }

    // As a last resort, try to parse the raw content as JSON
    const text = choice?.message?.content?.trim();
    if (text && (text.startsWith("{") || text.startsWith("["))) {
      return parseJsonLoose<T>(text);
    }

    throw new Error(`Tool call '${toolName}' missing JSON arguments`);
  }

  /* ---------------- Validators for outline ---------------- */

  private validateRichOutline(outline: RichOutline): ValidationResult {
    if (!outline?.title) return { ok: false, reason: "missing title" };
    if (!Array.isArray(outline.slides) || outline.slides.length < 10)
      return { ok: false, reason: "need >= 10 slides" };

    // Sources: soft-check. If model under-delivers, the agent will merge URLs it gathered.
    if (!Array.isArray(outline.sources) || outline.sources.length < getMinSources()) {
      return { ok: true };
    }

    const seen = new Set<string>();
    for (let i = 0; i < outline.slides.length; i++) {
      const s = outline.slides[i];
      if (!s?.title || !s?.body || !Array.isArray(s?.bullets)) {
        return { ok: false, reason: `slide ${i + 1} incomplete` };
      }
      const key = s.title.trim().toLowerCase();
      if (seen.has(key)) return { ok: false, reason: `duplicate slide title: "${s.title}"` };
      seen.add(key);

      if (s.body.trim().length < 600) return { ok: false, reason: `slide ${i + 1} body too short` };
      if (s.bullets.length < 3 || s.bullets.length > 6)
        return { ok: false, reason: `slide ${i + 1} bullets out of range` };
    }
    return { ok: true };
  }

  private repairRichOutline(outline: RichOutline): RichOutline {
    if (!outline) return outline;
    const seen = new Map<string, number>();
    outline.slides = (outline.slides || []).map((s, idx) => {
      const base = (s?.title || `Slide ${idx + 1}`).trim();
      const lower = base.toLowerCase();
      const count = (seen.get(lower) || 0) + 1;
      seen.set(lower, count);
      const title = count > 1 ? `${base} (${count})` : base;

      let bullets = Array.isArray(s?.bullets) ? s.bullets.filter(Boolean).slice(0, 6) : [];
      while (bullets.length < 3) bullets.push("Additional insight");

      const body = String(s?.body || "").trim();
      const keyword = String(s?.keyword || "topic").trim();

      return { ...s, title, bullets, body, keyword };
    });

    if (Array.isArray(outline.sources)) {
      const uniq = Array.from(new Set(outline.sources.map((u) => (u || "").trim()))).filter(Boolean);
      outline.sources = uniq;
    } else {
      outline.sources = [];
    }
    return outline;
  }

  /* ---------------- Persona prompt ---------------- */

  private getPersonaPrompt(persona: string, tone: string): string {
    const personas: Record<string, string> = {
      professional: "You are a professional assistant with business expertise.",
      creative: "You are a creative writer and storyteller.",
      analytical: "You are a data analyst and researcher.",
      educator: "You are an experienced educator and teacher.",
      consultant: "You are a business consultant with strategic expertise.",
    };
    const tones: Record<string, string> = {
      formal: "Use formal language and maintain a professional tone.",
      casual: "Be conversational and friendly.",
      enthusiastic: "Be energetic, positive, and excited.",
      concise: "Be concise and avoid fluff.",
    };
    return `${personas[persona] || personas.professional} ${tones[tone] || tones.formal}`.trim();
  }
}

/* ─────────────────────────── Helpers ─────────────────────────── */

function stripFence(s: string): string {
  return String(s || "").replace(/^```json\s*|\s*```$/g, "").trim();
}

function parseJsonLoose<T>(raw: string): T {
  const s = stripFence(raw);
  try {
    return JSON.parse(s) as T;
  } catch {
    // Tiny fixups for common JSON hiccups
    const fixed = s
      // remove trailing commas before } or ]
      .replace(/,\s*([}\]])/g, "$1")
      // replace unescaped newlines in strings (very naive; last resort)
      .replace(/:\s*"([^"]*?)\n([^"]*?)"/g, (_m, p1, p2) => `: "${p1}\\n${p2}"`);
    return JSON.parse(fixed) as T;
  }
}

/* ─────────────────────────── Exports ─────────────────────────── */

export const openaiService = new OpenAIService();

// Named exports for convenience in other services
export const generateRichOutline = openaiService.generateRichOutline.bind(openaiService);
export const generateReport = openaiService.generateReport.bind(openaiService);
export const generateWebsite = openaiService.generateWebsite.bind(openaiService);
export const generateDataset = openaiService.generateDataset.bind(openaiService);
export const generateQuiz = openaiService.generateQuiz.bind(openaiService);
export const generateContentCalendar = openaiService.generateContentCalendar.bind(openaiService);
export const generateFlowchart = openaiService.generateFlowchart.bind(openaiService);
