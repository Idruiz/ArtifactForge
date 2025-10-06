// server/orchestrator/context.ts
// Rolling conversation context store with topic memory

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

interface Topic {
  name: string;
  summary: string;
  ts: number;
}

interface UserContext {
  turns: Turn[];
  topic: Topic | null;
}

const MAX_TURNS = 20;

class ContextStore {
  private contexts = new Map<string, UserContext>();

  recordTurn(conversationId: string, role: 'user' | 'assistant', text: string) {
    const ctx = this.contexts.get(conversationId) || { turns: [], topic: null };
    
    ctx.turns.push({ role, text, ts: Date.now() });
    
    // Keep only last MAX_TURNS
    if (ctx.turns.length > MAX_TURNS) {
      ctx.turns = ctx.turns.slice(-MAX_TURNS);
    }
    
    this.contexts.set(conversationId, ctx);
  }

  getRecentContext(conversationId: string, limit: number = 10): Turn[] {
    const ctx = this.contexts.get(conversationId);
    if (!ctx) return [];
    return ctx.turns.slice(-limit);
  }

  getTopic(conversationId: string): Topic | null {
    const ctx = this.contexts.get(conversationId);
    return ctx?.topic || null;
  }

  setTopic(conversationId: string, name: string, summary: string) {
    const ctx = this.contexts.get(conversationId) || { turns: [], topic: null };
    ctx.topic = { name, summary, ts: Date.now() };
    this.contexts.set(conversationId, ctx);
  }

  buildContextPrompt(conversationId: string, limit: number = 10): string {
    const turns = this.getRecentContext(conversationId, limit);
    if (turns.length === 0) return '';
    
    const lines = turns.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`);
    return 'Recent conversation:\n' + lines.join('\n');
  }

  getAllTurns(conversationId: string): Turn[] {
    const ctx = this.contexts.get(conversationId);
    return ctx?.turns || [];
  }

  clear(conversationId: string) {
    this.contexts.delete(conversationId);
  }
}

export const contextStore = new ContextStore();
