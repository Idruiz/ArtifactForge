// server/orchestrator/intent.ts
// Intent detection and parameter extraction using chrono-node and heuristics

export type IntentType = 
  | 'CALENDAR' 
  | 'DATA_ANALYSIS' 
  | 'PRESENTATION' 
  | 'WEBSITE' 
  | 'REPORT' 
  | 'GENERIC_CHAT';

export interface ParsedIntent {
  type: IntentType;
  confidence: number;
  params: {
    title?: string;
    duration?: number; // minutes
    datetime?: Date;
    attendees?: string[];
    dataRefs?: string[];
    topic?: string;
  };
}

// Lazy import chrono-node to avoid blocking server startup
let chronoInstance: any = null;
async function getChrono() {
  if (!chronoInstance) {
    chronoInstance = await import('chrono-node');
  }
  return chronoInstance;
}

const INTENT_PATTERNS = {
  CALENDAR: /\b(schedule|book|meeting|invite|free slot|availability|calendar|appointment)\b/i,
  DATA_ANALYSIS: /\b(analyze|analysis|explore|EDA|chart|plot|regression|cluster|pivot|data|dataset|csv|statistics|metrics)\b/i,
  PRESENTATION: /\b(presentation|slides|ppt|deck|pitch|slideshow|powerpoint)\b/i,
  WEBSITE: /\b(website|web\s?app|landing|page|site|html)\b/i,
  REPORT: /\b(report|write-?up|summary|brief|whitepaper|doc|document|paper)\b/i,
};

const PRIORITY_ORDER: IntentType[] = ['CALENDAR', 'DATA_ANALYSIS', 'PRESENTATION', 'WEBSITE', 'REPORT'];

export async function detectIntent(text: string, recentContext?: string): Promise<ParsedIntent> {
  const matches: Array<{ type: IntentType; confidence: number }> = [];
  
  // Check all patterns
  for (const [type, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(text)) {
      // Higher confidence if in first 50 chars
      const early = text.slice(0, 50).match(pattern);
      matches.push({ 
        type: type as IntentType, 
        confidence: early ? 0.9 : 0.7 
      });
    }
  }
  
  // If multiple matches, use priority order
  if (matches.length > 1) {
    matches.sort((a, b) => {
      const aPriority = PRIORITY_ORDER.indexOf(a.type);
      const bPriority = PRIORITY_ORDER.indexOf(b.type);
      if (aPriority !== bPriority) return aPriority - bPriority;
      return b.confidence - a.confidence;
    });
  }
  
  const bestMatch = matches[0];
  
  if (!bestMatch) {
    return {
      type: 'GENERIC_CHAT',
      confidence: 1.0,
      params: {},
    };
  }
  
  // Extract parameters based on intent type
  const params = await extractParams(text, bestMatch.type);
  
  return {
    type: bestMatch.type,
    confidence: bestMatch.confidence,
    params,
  };
}

async function extractParams(text: string, intentType: IntentType): Promise<ParsedIntent['params']> {
  const params: ParsedIntent['params'] = {};
  
  // Extract title
  params.title = extractTitle(text, intentType);
  
  // Extract duration
  params.duration = extractDuration(text);
  
  // Extract datetime for calendar
  if (intentType === 'CALENDAR') {
    const chrono = await getChrono();
    const parsed = chrono.parse(text);
    if (parsed.length > 0) {
      params.datetime = parsed[0].start.date();
    }
    
    // Extract attendees (names after "with")
    const withMatch = text.match(/\bwith\s+([^,.\n]+)/i);
    if (withMatch) {
      params.attendees = [withMatch[1].trim()];
    }
  }
  
  // Extract data references
  if (intentType === 'DATA_ANALYSIS') {
    const dataRefs: string[] = [];
    const fileMatches = Array.from(text.matchAll(/\b([\w-]+\.(?:csv|json|xlsx|tsv))\b/gi));
    for (const match of fileMatches) {
      dataRefs.push(match[1]);
    }
    if (dataRefs.length > 0) {
      params.dataRefs = dataRefs;
    }
  }
  
  return params;
}

function extractTitle(text: string, intentType: IntentType): string | undefined {
  // Try various title patterns
  const patterns = [
    /\b(?:called|titled|named|about)\s+"([^"]+)"/i,
    /\b(?:called|titled|named|about)\s+['']([^'']+)['']/i,
    /\b(?:called|titled|named|about)\s+([A-Z][^.,\n]{3,40})/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  
  // Fallback: extract noun phrase after intent keyword
  const intentWord = Object.entries(INTENT_PATTERNS).find(([type]) => type === intentType)?.[1];
  if (intentWord) {
    const match = text.match(new RegExp(intentWord.source + '\\s+(?:on|about)?\\s+([A-Z][^.,\n]{3,40})', 'i'));
    if (match) return match[1].trim();
  }
  
  return undefined;
}

function extractDuration(text: string): number | undefined {
  const patterns = [
    { regex: /(\d+)\s*(?:hours?|hrs?)/i, multiplier: 60 },
    { regex: /(\d+)\s*(?:minutes?|mins?)/i, multiplier: 1 },
    { regex: /half\s*(?:an?\s*)?hour/i, value: 30 },
    { regex: /quarter\s*(?:an?\s*)?hour/i, value: 15 },
  ];
  
  for (const { regex, multiplier, value } of patterns) {
    const match = text.match(regex);
    if (match) {
      if (value !== undefined) return value;
      if (multiplier !== undefined) return parseInt(match[1]) * multiplier;
    }
  }
  
  return undefined;
}
