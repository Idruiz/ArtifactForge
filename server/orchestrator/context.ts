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

  recordTurn(userId: string, role: 'user' | 'assistant', text: string) {
    const ctx = this.contexts.get(userId) || { turns: [], topic: null };
    
    ctx.turns.push({ role, text, ts: Date.now() });
    
    // Keep only last MAX_TURNS
    if (ctx.turns.length > MAX_TURNS) {
      ctx.turns = ctx.turns.slice(-MAX_TURNS);
    }
    
    this.contexts.set(userId, ctx);
  }

  getRecentContext(userId: string, limit: number = 10): Turn[] {
    const ctx = this.contexts.get(userId);
    if (!ctx) return [];
    return ctx.turns.slice(-limit);
  }

  getTopic(userId: string): Topic | null {
    const ctx = this.contexts.get(userId);
    return ctx?.topic || null;
  }

  setTopic(userId: string, name: string, summary: string) {
    const ctx = this.contexts.get(userId) || { turns: [], topic: null };
    ctx.topic = { name, summary, ts: Date.now() };
    this.contexts.set(userId, ctx);
  }

  buildContextPrompt(userId: string, limit: number = 10): string {
    const turns = this.getRecentContext(userId, limit);
    if (turns.length === 0) return '';
    
    const lines = turns.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`);
    return 'Recent conversation:\n' + lines.join('\n');
  }

  getAllTurns(userId: string): Turn[] {
    const ctx = this.contexts.get(userId);
    return ctx?.turns || [];
  }

  clear(userId: string) {
    this.contexts.delete(userId);
  }
}

export const contextStore = new ContextStore();
