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
    // Use the working calendar-book/command endpoint
    const response = await axios.post('http://localhost:5000/calendar-book/command', {
      userId: params.userId || 'idruiz12@gmail.com',
      text: params.command,
      tz: 'America/Vancouver',
      workHours: { start: '09:00', end: '18:00' },
    });

    const data = response.data;

    // Check for successful booking
    if (data.eventId && data.htmlLink) {
      return {
        ok: true,
        intent: 'CALENDAR',
        actionTaken: `Created calendar event successfully`,
        event: {
          id: data.eventId,
          htmlLink: data.htmlLink,
        },
        followup: `Event created! View it here: ${data.htmlLink}`,
      };
    }

    // Handle free slots response
    if (data.freeSlots && Array.isArray(data.freeSlots)) {
      const slots = data.freeSlots.slice(0, 3).map((s: any) => s.start).join(', ');
      return {
        ok: true,
        intent: 'CALENDAR',
        actionTaken: `Found ${data.freeSlots.length} free slots`,
        followup: `Available times: ${slots}. Say "book the first one" to schedule.`,
      };
    }

    return {
      ok: false,
      intent: 'CALENDAR',
      actionTaken: 'Calendar command processed but no clear action taken',
      followup: data.message || 'Please try rephrasing your calendar request.',
    };
  } catch (err: any) {
    const errorMsg = err.response?.data?.error || err.message || 'Unknown error';
    return {
      ok: false,
      intent: 'CALENDAR',
      actionTaken: 'Calendar action failed',
      error: errorMsg,
      followup: `Error: ${errorMsg}`,
    };
  }
}
