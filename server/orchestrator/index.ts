// server/orchestrator/index.ts
// Main orchestrator router - chat-first command interface

import { Router } from 'express';
import { contextStore } from './context';
import { detectIntent, IntentType } from './intent';
import { toPresentation, toWebsite, toReport, toAnalysis, toCalendar } from './bridge';
import { nanoid } from 'nanoid';

const router = Router();

interface CommandRequest {
  userId: string;
  text: string;
  voice?: boolean;
  sessionId?: string;
  apiKeys?: {
    openai?: string;
    serpApi?: string;
    unsplash?: string;
  };
  tz?: string;
  workHours?: string;
  meta?: any;
}

router.post('/command', async (req, res) => {
  try {
    const { userId, text, sessionId, apiKeys, voice } = req.body as CommandRequest;

    if (!text || !userId) {
      return res.status(400).json({ 
        error: 'Missing required fields: userId and text' 
      });
    }

    console.log(`[ORCH] Command from ${userId}${voice ? ' (voice)' : ''}: ${text.slice(0, 80)}...`);

    // Record user turn in context
    contextStore.recordTurn(userId, 'user', text);

    // Get recent context for intent detection
    const recentContext = contextStore.buildContextPrompt(userId, 6);

    // Detect intent BEFORE checking API keys (calendar doesn't need OpenAI)
    const intent = await detectIntent(text, recentContext);
    console.log(`[ORCH] Detected intent: ${intent.type} (confidence: ${intent.confidence})`);

    // Get API keys with fallbacks
    const effectiveKeys = {
      openai: apiKeys?.openai || process.env.OPENAI_API_KEY || '',
      serpApi: apiKeys?.serpApi || process.env.SERP_API_KEY || '',
      unsplash: apiKeys?.unsplash || process.env.UNSPLASH_ACCESS_KEY || '',
    };

    // Only require OpenAI key for artifact generation, not for calendar or generic chat
    const requiresOpenAI = ['DATA_ANALYSIS', 'PRESENTATION', 'WEBSITE', 'REPORT'].includes(intent.type);
    if (requiresOpenAI && !effectiveKeys.openai) {
      return res.status(400).json({ 
        error: 'OpenAI API key required for artifact generation',
        intent: intent.type,
        followup: 'Please configure your OpenAI API key to create presentations, reports, websites, or run data analysis.',
      });
    }

    // Generate session ID if not provided
    const effectiveSessionId = sessionId || nanoid();

    // Build conversation history from context
    const conversationHistory = contextStore.getAllTurns(userId).map(t => ({
      role: t.role,
      content: t.text,
    }));

    // Route to appropriate pipeline
    let result;

    switch (intent.type) {
      case 'CALENDAR': {
        result = await toCalendar({
          command: text,
          userId,
        });
        break;
      }

      case 'DATA_ANALYSIS': {
        // Build enriched prompt from context + current text
        let enrichedPrompt = text;
        const topic = contextStore.getTopic(userId);
        if (topic) {
          enrichedPrompt = `${topic.summary}\n\n${text}`;
        } else if (recentContext) {
          enrichedPrompt = `${recentContext}\n\nCurrent request: ${text}`;
        }

        result = await toAnalysis({
          prompt: enrichedPrompt,
          dataRefs: intent.params.dataRefs,
          sessionId: effectiveSessionId,
          apiKeys: effectiveKeys,
          conversationHistory,
        });
        break;
      }

      case 'PRESENTATION': {
        // Build enriched prompt
        let enrichedPrompt = text;
        const topic = contextStore.getTopic(userId);
        if (topic) {
          enrichedPrompt = `Create a presentation about ${topic.name}.\n\nContext: ${topic.summary}\n\nRequirements: ${text}`;
        } else if (recentContext) {
          enrichedPrompt = `${recentContext}\n\nCurrent request: ${text}`;
        }

        result = await toPresentation({
          prompt: enrichedPrompt,
          title: intent.params.title,
          sessionId: effectiveSessionId,
          apiKeys: effectiveKeys,
          conversationHistory,
        });
        break;
      }

      case 'WEBSITE': {
        // Build enriched prompt
        let enrichedPrompt = text;
        const topic = contextStore.getTopic(userId);
        if (topic) {
          enrichedPrompt = `Create a website about ${topic.name}.\n\nContext: ${topic.summary}\n\nRequirements: ${text}`;
        } else if (recentContext) {
          enrichedPrompt = `${recentContext}\n\nCurrent request: ${text}`;
        }

        result = await toWebsite({
          prompt: enrichedPrompt,
          title: intent.params.title,
          sessionId: effectiveSessionId,
          apiKeys: effectiveKeys,
          conversationHistory,
        });
        break;
      }

      case 'REPORT': {
        // Build enriched prompt
        let enrichedPrompt = text;
        const topic = contextStore.getTopic(userId);
        if (topic) {
          enrichedPrompt = `Write a report about ${topic.name}.\n\nContext: ${topic.summary}\n\nRequirements: ${text}`;
        } else if (recentContext) {
          enrichedPrompt = `${recentContext}\n\nCurrent request: ${text}`;
        }

        result = await toReport({
          prompt: enrichedPrompt,
          title: intent.params.title,
          sessionId: effectiveSessionId,
          apiKeys: effectiveKeys,
          conversationHistory,
        });
        break;
      }

      case 'GENERIC_CHAT':
      default: {
        // Not an artifact/action command - return to generic chat
        result = {
          ok: true,
          intent: 'GENERIC_CHAT',
          actionTaken: 'No specific action detected - treating as generic chat',
          followup: null,
        };
        break;
      }
    }

    // Update topic if this seems to be a sustained conversation about something
    if (intent.type !== 'GENERIC_CHAT' && intent.params.title) {
      contextStore.setTopic(userId, intent.params.title, text.slice(0, 200));
    }

    // Return result
    return res.json({
      ...result,
      detectedIntent: intent.type,
      sessionId: effectiveSessionId,
    });

  } catch (err: any) {
    console.error('[ORCH] Error:', err);
    return res.status(500).json({ 
      error: err.message || 'Internal server error',
      intent: 'ERROR',
      actionTaken: 'Failed to process command',
    });
  }
});

// Health check
router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'orchestrator' });
});

export default router;
