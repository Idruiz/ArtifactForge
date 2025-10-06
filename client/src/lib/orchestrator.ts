// client/src/lib/orchestrator.ts
// Client-side orchestrator utility

interface OrchestratorRequest {
  userId: string;
  text: string;
  voice?: boolean;
  sessionId: string;
  apiKeys: {
    openai?: string;
    serpApi?: string;
    unsplash?: string;
  };
}

interface OrchestratorResponse {
  ok: boolean;
  intent: string;
  detectedIntent?: string;
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

export async function callOrchestrator(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  try {
    const response = await fetch('/orchestrator/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || 'Orchestrator failed');
    }

    return await response.json();
  } catch (err: any) {
    console.error('[Orchestrator] Error:', err);
    return {
      ok: false,
      intent: 'ERROR',
      actionTaken: 'Failed to process command',
      error: err.message,
    };
  }
}

export function isActionIntent(intent: string): boolean {
  return ['CALENDAR', 'DATA_ANALYSIS', 'PRESENTATION', 'WEBSITE', 'REPORT'].includes(intent);
}
