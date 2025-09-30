// server/services/outliner.ts
// Thin, reliable wrapper over OpenAI structured outline -> normalized slides

import { openaiService, RichOutline } from "./openai";
import { logger } from "../utils/logger";

export interface OutlineSlide {
  slideNumber: number;
  title: string;
  type: "title" | "content" | "chart" | "image";
  content: {
    body?: string;
    bullets?: string[];
    keyword?: string;
    chartSpec?: {
      // IMPORTANT: match visualMatcher accepted types
      type: "bar" | "line" | "pie" | "doughnut";
      data?: any;
      title?: string;
    };
    chart?: { url: string; title?: string }; // set later by visualMatcher
    image?: { url: string; description: string; width?: number; height?: number }; // set later
  };
}

export interface PresentationOutline {
  title: string;
  slides: OutlineSlide[];
  sources?: string[];
}

class OutlinerService {
  async generateOutline(
    taskId: string,
    prompt: string,
    persona: string,
    tone: string,
    researchContext?: string
  ): Promise<PresentationOutline> {
    await logger.stepStart(taskId, "Generating presentation outline");

    const topic = researchContext
      ? `${prompt}\n\nResearch context:\n${researchContext}`
      : prompt;

    const outline: RichOutline = await openaiService.generateRichOutline(
      topic,
      persona,
      tone
    );

    const normalized = this.normalize(outline);
    const v = this.validateOutline(normalized);
    if (!v.isValid) {
      await logger.trace(taskId, `Outline validation failed: ${v.errors.join("; ")}`);
      throw new Error(`Outline validation failed: ${v.errors.join("; ")}`);
    }

    await logger.trace(
      taskId,
      `Generated outline: ${normalized.slides.length} slides, ${outline.sources?.length ?? 0} sources`
    );
    await logger.stepEnd(taskId, "Generating presentation outline");
    return normalized;
  }

  private normalize(outline: RichOutline): PresentationOutline {
    const slides: OutlineSlide[] = [];
    const seen = new Map<string, number>();

    const coerceChartType = (t?: string): "bar" | "line" | "pie" | "doughnut" | undefined => {
      if (!t) return undefined;
      const raw = String(t).toLowerCase().trim();
      // visualMatcher supports these; coerce unsupported ones
      if (raw === "bar" || raw === "line" || raw === "pie" || raw === "doughnut") return raw;
      if (raw === "area" || raw === "scatter") return "line"; // normalize unsupported to 'line'
      return "line";
    };

    outline.slides.forEach((s, idx) => {
      const baseTitle = (s.title || `Slide ${idx + 1}`).trim();
      const key = baseTitle.toLowerCase();
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);
      const title = count > 1 ? `${baseTitle} (${count})` : baseTitle;

      // clamp bullets 3..6, drop empties
      const rawBullets = Array.isArray(s.bullets) ? s.bullets.filter(Boolean) : [];
      const bullets = rawBullets.slice(0, 6);
      while (bullets.length < 3) bullets.push("Additional insight");

      const chartType = coerceChartType(s.chartSpec?.type);
      const chartSpec = s.chartSpec && chartType
        ? { type: chartType, data: s.chartSpec.data ?? undefined, title: s.chartSpec.title ?? undefined }
        : undefined;

      slides.push({
        slideNumber: slides.length + 1,
        title,
        type: chartSpec ? "chart" : "content",
        content: {
          body: s.body?.trim(),
          bullets,
          keyword: s.keyword?.trim() || title,
          chartSpec,
        },
      });
    });

    // guarantee at least 10 slides (soft pad with content-only)
    while (slides.length < 10) {
      const n = slides.length + 1;
      slides.push({
        slideNumber: n,
        title: `Additional Insights ${n}`,
        type: "content",
        content: {
          body:
            "Additional insights to round out the narrative and maintain flow between sections.",
          bullets: ["Key point A", "Key point B", "Key point C"],
          keyword: "insights",
        },
      });
    }

    // re-number in case we extended
    slides.forEach((s, i) => (s.slideNumber = i + 1));

    return {
      title: (outline.title || "Presentation").trim(),
      slides,
      sources: outline.sources,
    };
  }

  validateOutline(outline: PresentationOutline): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!outline.title?.trim()) errors.push("Outline must have a title");
    if (!Array.isArray(outline.slides) || outline.slides.length < 8) {
      errors.push(`Too few slides: ${outline.slides?.length ?? 0} (min 8)`);
    }

    const seen = new Set<string>();
    for (const [i, s] of outline.slides.entries()) {
      if (!s.title?.trim()) errors.push(`Slide ${i + 1} missing title`);
      const key = s.title.trim().toLowerCase();
      if (seen.has(key)) errors.push(`Duplicate slide title: "${s.title}"`);
      seen.add(key);

      if (!s.content?.body || s.content.body.trim().length < 400) {
        errors.push(`Slide ${i + 1} body too short`);
      }
      if (!Array.isArray(s.content?.bullets) || s.content.bullets.length < 3) {
        errors.push(`Slide ${i + 1} needs ≥3 bullets`);
      }

      if (s.content.chartSpec) {
        const t = s.content.chartSpec.type;
        const ok = ["bar", "line", "pie", "doughnut"].includes(String(t));
        if (!ok) errors.push(`Slide ${i + 1} invalid chart type: ${t}`);
      }
    }

    return { isValid: errors.length === 0, errors };
  }
}

export const outlinerService = new OutlinerService();
