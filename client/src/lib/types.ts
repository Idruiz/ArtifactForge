export interface ApiKeys {
  openai: string;
  serpApi?: string;
  unsplash?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  status?: 'processing' | 'completed';
  steps?: TaskStep[];
}

export interface TaskStep {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  details?: string;
}

export interface Artifact {
  id: string;
  filename: string;
  fileType: string;
  fileSize: number;
  downloadUrl: string;
  metadata?: {
    slides?: number;
    images?: number;
    charts?: number;
    pages?: number;
  };
  createdAt: Date;
}

export interface AgentStatus {
  currentTask: string;
  progress: number;
  isProcessing: boolean;
}

export interface LogEntry {
  id: string;
  type: 'trace' | 'step_start' | 'step_end' | 'delivery';
  message: string;
  timestamp: Date;
}

export type Persona = 'professional' | 'creative' | 'analytical' | 'educator' | 'consultant';
export type Tone = 'formal' | 'casual' | 'enthusiastic' | 'concise';
export type TabType = 'chat' | 'logs' | 'artifacts';
