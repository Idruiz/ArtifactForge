import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Mic, Key, RotateCcw, Zap } from 'lucide-react';
import { Persona, Tone, ApiKeys } from '@/lib/types';

interface ChatPanelProps {
  isConnected: boolean;
  persona: Persona;
  tone: Tone;
  voiceEnabled: boolean;
  contentAgentEnabled: boolean;
  chatInput: string;
  isListening: boolean;
  onPersonaChange: (persona: Persona) => void;
  onToneChange: (tone: Tone) => void;
  onVoiceToggle: (enabled: boolean) => void;
  onContentAgentToggle: (enabled: boolean) => void;
  onChatInputChange: (input: string) => void;
  onSendMessage: () => void;
  onStartVoiceInput: () => void;
  onShowApiKeys: () => void;
  onRestartAgent: () => void;
}

export function ChatPanel({
  isConnected,
  persona,
  tone,
  voiceEnabled,
  contentAgentEnabled,
  chatInput,
  isListening,
  onPersonaChange,
  onToneChange,
  onVoiceToggle,
  onContentAgentToggle,
  onChatInputChange,
  onSendMessage,
  onStartVoiceInput,
  onShowApiKeys,
  onRestartAgent,
}: ChatPanelProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  return (
    <div className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 py-4">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Agent Diaz</h1>
            <Badge variant={isConnected ? "default" : "destructive"}>
              {isConnected ? "Online" : "Offline"}
            </Badge>
          </div>
          
          <div className="flex items-center space-x-3">
            <Button variant="ghost" size="sm" onClick={onShowApiKeys} data-testid="button-api-keys">
              <Key className="w-4 h-4 mr-2" />
              API Keys
            </Button>
            
            <Button variant="ghost" size="sm" onClick={onRestartAgent} data-testid="button-restart">
              <RotateCcw className="w-4 h-4 mr-2" />
              Restart
            </Button>
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex items-center space-x-6 mb-4">
          {/* Persona Selection */}
          <div className="flex items-center space-x-2">
            <Label className="text-sm font-medium">Persona:</Label>
            <Select value={persona} onValueChange={onPersonaChange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional">Professional Assistant</SelectItem>
                <SelectItem value="creative">Creative Writer</SelectItem>
                <SelectItem value="analytical">Data Analyst</SelectItem>
                <SelectItem value="educator">Educator</SelectItem>
                <SelectItem value="consultant">Business Consultant</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tone Selection */}
          <div className="flex items-center space-x-2">
            <Label className="text-sm font-medium">Tone:</Label>
            <Select value={tone} onValueChange={onToneChange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="formal">Formal</SelectItem>
                <SelectItem value="casual">Casual</SelectItem>
                <SelectItem value="enthusiastic">Enthusiastic</SelectItem>
                <SelectItem value="concise">Concise</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Voice Toggle */}
          <div className="flex items-center space-x-2">
            <Label className="text-sm font-medium">Voice:</Label>
            <Switch checked={voiceEnabled} onCheckedChange={onVoiceToggle} />
          </div>

          {/* Content Agent Toggle */}
          <div className="flex items-center space-x-2">
            <Label className="text-sm font-medium" title="When ON: Always generate artifacts. When OFF: Auto-detect based on your request.">
              Content Agent:
            </Label>
            <Switch 
              checked={contentAgentEnabled} 
              onCheckedChange={onContentAgentToggle}
              data-testid="switch-content-agent"
            />
            <span className="text-xs text-slate-500">{contentAgentEnabled ? "ON (Always Generate)" : "OFF (Auto-Detect)"}</span>
          </div>
        </div>

        {/* Chat Input Row */}
        <div className="flex items-end space-x-3">
          <div className="flex-1 relative">
            <Textarea
              placeholder="Ask me anything or request content generation (e.g., 'Create a professional presentation on best pharmacy practices in BC, Canada in 2025')"
              value={chatInput}
              onChange={(e) => onChatInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              className="resize-none pr-12"
              data-testid="input-chat"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={onStartVoiceInput}
              className="absolute right-2 top-2"
              disabled={isListening}
            >
              <Mic className={`w-5 h-5 ${isListening ? 'text-red-500 animate-pulse' : 'text-slate-400'}`} />
            </Button>
          </div>
          <Button onClick={onSendMessage} disabled={!chatInput.trim()} data-testid="button-send">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
