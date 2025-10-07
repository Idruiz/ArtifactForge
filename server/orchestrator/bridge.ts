// server/orchestrator/bridge.ts
// Bridges orchestrator to existing pipelines (agentService, calendar, etc.)

import { agentService } from '../services/agent';
import axios from 'axios';

interface BridgeResult {
  ok: boolean;
  intent: string;
  actionTaken: string;
  artifact?: {
    id: string;
    url: string;
    type: string;
  };
  event?: {
    id: string;
    htmlLink: string;
  };
  followup?: string;
  error?: string;
}

interface ApiKeys {
  openai: string;
  serpApi?: string;
  unsplash?: string;
}

export async function toPresentation(params: {
  prompt: string;
  title?: string;
  sessionId: string;
  apiKeys: ApiKeys;
  conversationHistory?: any[];
}): Promise<BridgeResult> {
  try {
    // Call agentService with contentAgentEnabled=true
    await agentService.startTask(
      params.sessionId,
      params.prompt,
      'professional', // persona
      'balanced', // tone
      params.apiKeys,
      true, // contentAgentEnabled
      params.conversationHistory || [],
    );

    return {
      ok: true,
      intent: 'PRESENTATION',
      actionTaken: 'Started presentation generation. Monitor the Artifacts panel for the PPTX file.',
      followup: 'Your presentation is being created. This may take 1-2 minutes.',
    };
  } catch (err: any) {
    return {
      ok: false,
      intent: 'PRESENTATION',
      actionTaken: 'Failed to start presentation generation',
      error: err.message || 'Unknown error',
    };
  }
}

export async function toWebsite(params: {
  prompt: string;
  title?: string;
  sessionId: string;
  apiKeys: ApiKeys;
  conversationHistory?: any[];
}): Promise<BridgeResult> {
  try {
    // Call agentService with contentAgentEnabled=true
    await agentService.startTask(
      params.sessionId,
      params.prompt,
      'professional',
      'balanced',
      params.apiKeys,
      true,
      params.conversationHistory || [],
    );

    return {
      ok: true,
      intent: 'WEBSITE',
      actionTaken: 'Started website generation. Monitor the Artifacts panel for the HTML site.',
      followup: 'Your website is being created. This may take 1-2 minutes.',
    };
  } catch (err: any) {
    return {
      ok: false,
      intent: 'WEBSITE',
      actionTaken: 'Failed to start website generation',
      error: err.message || 'Unknown error',
    };
  }
}

export async function toReport(params: {
  prompt: string;
  title?: string;
  sessionId: string;
  apiKeys: ApiKeys;
  conversationHistory?: any[];
}): Promise<BridgeResult> {
  try {
    // Call agentService with contentAgentEnabled=true
    await agentService.startTask(
      params.sessionId,
      params.prompt,
      'professional',
      'balanced',
      params.apiKeys,
      true,
      params.conversationHistory || [],
    );

    return {
      ok: true,
      intent: 'REPORT',
      actionTaken: 'Started report generation. Monitor the Artifacts panel for the DOCX file.',
      followup: 'Your report is being created. This may take 1-2 minutes.',
    };
  } catch (err: any) {
    return {
      ok: false,
      intent: 'REPORT',
      actionTaken: 'Failed to start report generation',
      error: err.message || 'Unknown error',
    };
  }
}

export async function toAnalysis(params: {
  prompt: string;
  dataRefs?: string[];
  sessionId: string;
  apiKeys: ApiKeys;
  conversationHistory?: any[];
}): Promise<BridgeResult> {
  try {
    // Build enriched prompt with data references
    let enrichedPrompt = params.prompt;
    if (params.dataRefs && params.dataRefs.length > 0) {
      enrichedPrompt += `\n\nData files mentioned: ${params.dataRefs.join(', ')}`;
    }

    // Call agentService with contentAgentEnabled=true for data analysis
    await agentService.startTask(
      params.sessionId,
      enrichedPrompt,
      'professional',
      'balanced',
      params.apiKeys,
      true,
      params.conversationHistory || [],
    );

    return {
      ok: true,
      intent: 'DATA_ANALYSIS',
      actionTaken: 'Started data analysis. Monitor the Artifacts panel for charts and reports.',
      followup: 'Your analysis is being created. This may take 1-2 minutes.',
    };
  } catch (err: any) {
    return {
      ok: false,
      intent: 'DATA_ANALYSIS',
      actionTaken: 'Failed to start data analysis',
      error: err.message || 'Unknown error',
    };
  }
}

export async function toCalendar(params: {
  command: string;
  userId?: string;
}): Promise<BridgeResult> {
  try {
    // Import the calendar booking service directly instead of making HTTP call
    const { scheduleViaProxy } = await import('../modules/calendarBook/service.js');
    const { parseCommand } = await import('../modules/calendarBook/nlp.js');
    
    const userId = params.userId || 'idruiz12@gmail.com';
    const tz = 'America/Vancouver';
    const workHours = { start: '09:00', end: '18:00' };
    
    // Parse the command
    const parsed = parseCommand(params.command);
    console.log('[ORCH-CAL] Parsed command:', JSON.stringify(parsed));
    
    // Call the service directly
    const result = await scheduleViaProxy(userId, {
      title: parsed.intent === 'schedule' ? parsed.title : 'Meeting',
      date: parsed.date,
      preferredStart: (parsed.intent === 'schedule' ? parsed.hhmm : null) || null,
      durationMins: parsed.dur,
      tz,
      workHours,
      attendeeAlias: parsed.alias,
    });
    
    console.log('[ORCH-CAL] Result from scheduleViaProxy:', JSON.stringify(result));

    // Check for successful booking
    if (result.eventId && result.htmlLink) {
      return {
        ok: true,
        intent: 'CALENDAR',
        actionTaken: `Created calendar event successfully`,
        event: {
          id: result.eventId,
          htmlLink: result.htmlLink,
        },
        followup: `Event created! View it here: ${result.htmlLink}`,
      };
    }

    return {
      ok: false,
      intent: 'CALENDAR',
      actionTaken: 'Calendar command processed but no clear action taken',
      followup: `Please try rephrasing your calendar request. Debug: ${JSON.stringify(result)}`,
    };
  } catch (err: any) {
    console.error('[ORCH-CAL] Error:', err);
    const errorMsg = err.message || 'Unknown error';
    return {
      ok: false,
      intent: 'CALENDAR',
      actionTaken: 'Calendar action failed',
      error: errorMsg,
      followup: `Error: ${errorMsg}`,
    };
  }
}
