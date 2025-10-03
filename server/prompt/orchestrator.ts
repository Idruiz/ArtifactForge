// server/prompt/orchestrator.ts
// Drop-in adaptive prompt builder. No hardcoded sample data.
// Node 18+, TypeScript. Adjust imports to your HTTP/LLM client.

type Student = {
  name: string;
  test_pct: number;
  term_pct: number;
  attendance_pct: number;
  missing_tasks: number;
  engagement_5: number;
  growth_pct: number;
  notes?: string;
};

type ClassAverages = {
  test_pct: number;
  term_pct: number;
  attendance_pct: number;
  missing_tasks_per_student: number;
  engagement_mean_5: number;
};

type DataAnalysisInput = {
  students: Student[];
  class_averages?: ClassAverages;
};

type ResearchReportInput = {
  topic: string;
  constraints?: string[];
  min_sources?: number;
  allow_domains?: string[];
  block_domains?: string[];
  figure_requirements?: string[];
  sections_required?: string[];
};

type RouterResult =
  | { intent: "DATA_ANALYSIS_DOCX"; reason: string; data: DataAnalysisInput }
  | { intent: "RESEARCH_REPORT_DOCX"; reason: string; data: ResearchReportInput };

export function routeIntent(raw: unknown): RouterResult {
  const txt = JSON.stringify(raw ?? "").toLowerCase();
  const hasStudents =
    /"students"\s*:/.test(txt) ||
    /\b(test|term|attendance|engagement|missing|growth)\b/.test(txt);
  const hasTopicOnly = /"topic"\s*:/.test(txt) && !hasStudents;

  if (hasStudents) {
    const data = validateDataAnalysisInput(raw);
    return { intent: "DATA_ANALYSIS_DOCX", reason: "Found per-student metrics", data };
  }
  if (hasTopicOnly) {
    const data = validateResearchReportInput(raw);
    return { intent: "RESEARCH_REPORT_DOCX", reason: "Topic with no per-student metrics", data };
  }
  // Default: prefer analysis if numbers present, else research
  const hasNumbers = /\b\d+(\.\d+)?%?/.test(txt);
  if (hasNumbers) {
    const data = validateDataAnalysisInput(raw);
    return { intent: "DATA_ANALYSIS_DOCX", reason: "Numeric cues detected", data };
  }
  const data = validateResearchReportInput({ topic: String(raw || "General topic") });
  return { intent: "RESEARCH_REPORT_DOCX", reason: "Fallback topic", data };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function validateDataAnalysisInput(raw: any): DataAnalysisInput {
  if (!raw || !raw.students) throw new Error("DATA_ANALYSIS_DOCX requires { students: [...] }");
  const students: Student[] = (raw.students as any[]).map((s, i) => {
    if (!s || typeof s.name !== "string") throw new Error(`students[${i}].name required`);
    const num = (k: string, lo: number, hi: number) => {
      const v = Number(s[k]); if (!Number.isFinite(v)) throw new Error(`students[${i}].${k} numeric required`);
      return clamp(v, lo, hi);
    };
    return {
      name: s.name,
      test_pct: num("test_pct", 0, 100),
      term_pct: num("term_pct", 0, 100),
      attendance_pct: num("attendance_pct", 0, 100),
      missing_tasks: clamp(Number(s.missing_tasks ?? 0), 0, 999),
      engagement_5: clamp(Number(s.engagement_5 ?? 3), 1, 5),
      growth_pct: clamp(Number(s.growth_pct ?? 0), -100, 100),
      notes: String(s.notes ?? "").slice(0, 400),
    };
  });
  const ca = raw.class_averages ? {
    test_pct: clamp(Number(raw.class_averages.test_pct ?? 0), 0, 100),
    term_pct: clamp(Number(raw.class_averages.term_pct ?? 0), 0, 100),
    attendance_pct: clamp(Number(raw.class_averages.attendance_pct ?? 0), 0, 100),
    missing_tasks_per_student: clamp(Number(raw.class_averages.missing_tasks_per_student ?? 0), 0, 999),
    engagement_mean_5: clamp(Number(raw.class_averages.engagement_mean_5 ?? 3), 1, 5),
  } : undefined;
  return { students, class_averages: ca };
}

function validateResearchReportInput(raw: any): ResearchReportInput {
  if (!raw || !raw.topic) throw new Error("RESEARCH_REPORT_DOCX requires { topic }");
  return {
    topic: String(raw.topic),
    constraints: raw.constraints ?? [],
    min_sources: Number(raw.min_sources ?? 10),
    allow_domains: raw.allow_domains ?? ["*.edu","*.gov","*.ac.*","antwiki.org","antweb.org","ncbi.nlm.nih.gov/pmc","doi.org/*","*.si.edu","*.nhm.ac.uk","*.amnh.org"],
    block_domains: raw.block_domains ?? ["studocu.com","scribd.com","misfitanimals.com","essay","ai report generator","calculator","tutorial"],
    figure_requirements: raw.figure_requirements ?? ["timeline","caste diagram","optional: temperature vs development schematic"],
    sections_required: raw.sections_required ?? ["cover","exec_summary","introduction","biology","colony","tables","figures","discussion","references"],
  };
}

// ---------- Prompt builders (no hardcoded example data) ----------

export function buildSystemMessage(intent: RouterResult["intent"]): string {
  if (intent === "DATA_ANALYSIS_DOCX") {
    return [
      "You are an assessment analyst. Produce a finished DOCX with embedded PNG figures and tables.",
      "No placeholders, no 'this slide will'. Compute on provided students; do not synthesize data when students[] is present.",
      "Fail-closed if figures/tables/sections missing; otherwise proceed.",
      "Ban leakage: words like 'slide', 'template', 'will include' must not appear.",
    ].join(" ");
  }
  return [
    "You are a science writer. Produce a finished research DOCX with embedded PNG figures and a vetted reference list (≥10).",
    "No placeholders or meta text. Include in-text citations [Author, Year] resolving to references.",
    "If sources scarce, iterate queries; do not proceed until min_sources reached.",
  ].join(" ");
}

export function buildUserMessage(intent: RouterResult["intent"], data: DataAnalysisInput | ResearchReportInput): string {
  if (intent === "DATA_ANALYSIS_DOCX") {
    const payload = JSON.stringify(data, null, 2);
    return [
      "Create a Class Performance Analysis DOCX with: Cover, Executive Summary (200–300 words), Methods (data source=this JSON), Results (≥500 words), Recommendations (class + per-student), Limitations, Appendix (CSV).",
      "Embed ≥4 PNG figures (bar charts, scatter, missing-tasks) and 2 tables (per-student; cohort summary).",
      "Use only the JSON below. Do not fabricate or generalize beyond it. If fewer students than expected, label as partial.",
      "JSON:",
      "```json",
      payload,
      "```"
    ].join("\n");
  }
  const payload = JSON.stringify(data, null, 2);
  return [
    "Write a Research DOCX on the topic below with: Cover, Executive Summary (250–400 words), Introduction (≥600), Biology & Colony sections, ≥3 embedded PNG figures (timeline, caste diagram, optional schematic), ≥1 table of stage ranges, Discussion (≥600), References (≥10, vetted).",
    "Follow allow/block domain rules in the JSON; iterate search until min_sources met; include [Author, Year] citations.",
    "JSON:",
    "```json",
    payload,
    "```"
  ].join("\n");
}

export function buildDeveloperMessage(intent: RouterResult["intent"]): string {
  if (intent === "DATA_ANALYSIS_DOCX") {
    return [
      "OUTPUT CONTRACT:",
      "- Return structured sections ready for DOCX: cover, exec_summary, methods, results, recommendations, limitations, appendix.",
      "- Produce figure specs with captions+alt text and base64 PNGs for embedding.",
      "- Produce two tables in Markdown that we will convert to DOCX tables.",
      "QA GATES: reject if any figure/table missing; reject if meta words present.",
    ].join("\n");
  }
  return [
    "OUTPUT CONTRACT:",
    "- Sections: cover, exec_summary, introduction, biology, colony, tables, figures, discussion, references.",
    "- Provide figure specs with captions+alt text and base64 PNGs.",
    "- Provide references with full metadata (title, authors, year, venue, DOI/PMCID/URL).",
    "QA GATES: reject if < min_sources, or any figure/table missing, or meta words present.",
  ].join("\n");
}

export type { Student, ClassAverages, DataAnalysisInput, ResearchReportInput, RouterResult };
