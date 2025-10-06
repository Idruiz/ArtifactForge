import { useState, useEffect, useRef } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { AgentWorkspace } from "@/components/AgentWorkspace";
import { ApiKeysModal } from "@/components/ApiKeysModal";
import { CalendarPanel } from "@/components/CalendarPanel";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useVoice } from "@/hooks/useVoice";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ApiKeys,
  Persona,
  Tone,
  Artifact,
  ChatMessage,
} from "@/lib/types";
import { nanoid } from "nanoid";
import { callOrchestrator, isActionIntent } from "@/lib/orchestrator";

// ---------- persist keys between reloads ----------
const storedKeys = JSON.parse(
  localStorage.getItem("agentdiaz-api-keys") || "{}",
) as Partial<ApiKeys>;

export default function Home() {
  const { toast } = useToast();

  // ---------- session (always fresh) ----------
  const [sessionId] = useState(() => {
    const newId = nanoid();
    localStorage.setItem('agentdiaz-session-id', newId);
    return newId;
  });

  // ---------- UI state ----------
  const [persona, setPersona] = useState<Persona>("professional");
  const [tone, setTone] = useState<Tone>("formal");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [contentAgentEnabled, setContentAgentEnabled] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [showApiKeysModal, setShowApiKeysModal] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeys>({
    openai: storedKeys.openai || "",
    serpApi: storedKeys.serpApi || "",
    unsplash: storedKeys.unsplash || "",
  });

  // ---------- WebSocket ----------
  const {
    isConnected,
    sendMessage,
    logs,
    agentStatus,
    artifacts,
    messages: wsMessages,
  } = useWebSocket(sessionId);

  // ---------- local copy of user messages (no persistence) ----------
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);

  // merge WS messages (assistant) + local user messages and sort by timestamp
  const allMessages = [...userMessages, ...wsMessages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // ---------- voice hook with Car Mode support ----------
  const { 
    isListening, 
    isSupported, 
    startListening, 
    speak, 
    startCarMode, 
    stopCarMode, 
    isCarMode 
  } = useVoice(
    (text) => {
      // Normal voice input - append to chat input
      setChatInput((prev) => prev + (prev ? " " : "") + text);
    },
    async (text) => {
      // Car Mode auto-send callback (triggered after 3 seconds of silence)
      if (!text.trim()) return;

      const userId = sessionId;

      // Store user message
      setUserMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          timestamp: new Date(),
          status: "completed",
        },
      ]);

      // Call orchestrator first
      const orchResult = await callOrchestrator({
        userId,
        text,
        voice: true,
        sessionId,
        apiKeys,
      });

      console.log('[Orchestrator] Car Mode Result:', orchResult);

      // If orchestrator handled it (action intent), add response
      if (isActionIntent(orchResult.intent || orchResult.detectedIntent || '')) {
        const responseContent = orchResult.followup || orchResult.actionTaken;
        setUserMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: responseContent,
            timestamp: new Date(),
            status: "completed",
          },
        ]);

        // Always speak in car mode
        speak(responseContent);
        return;
      }

      // Otherwise, fall back to generic chat via WebSocket
      sendMessage({
        type: "chat",
        data: {
          sessionId,
          content: text,
          persona,
          tone,
          contentAgentEnabled,
          apiKeys,
          conversationHistory: allMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        },
      });
    }
  );

  // ---------- speak assistant replies (both normal and Car Mode) ----------
  const lastSpokenIdRef = useRef<string>("");
  const speakingInProgressRef = useRef<boolean>(false);
  
  useEffect(() => {
    if ((voiceEnabled || isCarMode) && wsMessages.length > 0 && !speakingInProgressRef.current) {
      const last = wsMessages[wsMessages.length - 1];
      if (last.role === "assistant" && last.status === "completed" && last.id !== lastSpokenIdRef.current) {
        console.log(`[TTS Trigger] Speaking message ID: ${last.id}`);
        lastSpokenIdRef.current = last.id;
        speakingInProgressRef.current = true;
        speak(last.content);
        // Reset flag after a delay to allow next message
        setTimeout(() => {
          speakingInProgressRef.current = false;
        }, 1000);
      }
    }
  }, [wsMessages, voiceEnabled, isCarMode, speak]);

  // ---------- handlers ----------
  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const userMessage = chatInput;
    const userId = sessionId; // Use sessionId as userId for orchestrator

    // store user message locally for immediate display
    setUserMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        timestamp: new Date(),
        status: "completed",
      },
    ]);

    setChatInput("");

    // Call orchestrator first
    const orchResult = await callOrchestrator({
      userId,
      text: userMessage,
      voice: false,
      sessionId,
      apiKeys,
    });

    console.log('[Orchestrator] Result:', orchResult);

    // If orchestrator handled it (action intent), add response and don't send to WS
    if (isActionIntent(orchResult.intent || orchResult.detectedIntent || '')) {
      const responseContent = orchResult.followup || orchResult.actionTaken;
      setUserMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: responseContent,
          timestamp: new Date(),
          status: "completed",
        },
      ]);

      if (orchResult.followup && voiceEnabled) {
        speak(orchResult.followup);
      }
      return;
    }

    // Otherwise, fall back to generic chat via WebSocket
    sendMessage({
      type: "chat",
      data: {
        sessionId,
        content: userMessage,
        persona,
        tone,
        contentAgentEnabled,
        apiKeys,
        conversationHistory: allMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
      },
    });
  };

  const [showCalendarPanel, setShowCalendarPanel] = useState(false);

  const handleQuickAction = (action: string) => {
    if (action === "calendar") {
      setShowCalendarPanel(true);
      return;
    }

    const prompts: Record<string, string> = {
      presentation:
        "Create a professional PPTX presentation about [YOUR TOPIC] with slides including charts and images",
      report:
        "Generate a comprehensive DOCX report about [YOUR TOPIC] with data analysis and visualizations",
      website: "Build a complete HTML website about [YOUR TOPIC] with multiple pages and modern design",
      analyze:
        "Analyze [YOUR DATA/TOPIC] and create insights with charts and summaries in DOCX format",
    };
    const prompt = prompts[action] || "";
    if (prompt) {
      setChatInput(prompt);
      // Focus the input so user can immediately edit
      setTimeout(() => {
        const input = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="input-chat"]');
        if (input) {
          input.focus();
          // Select [YOUR TOPIC] or [YOUR DATA/TOPIC] placeholder for easy replacement
          const placeholderMatch = prompt.match(/\[YOUR[^\]]+\]/);
          if (placeholderMatch) {
            const start = prompt.indexOf(placeholderMatch[0]);
            const end = start + placeholderMatch[0].length;
            input.setSelectionRange(start, end);
          }
        }
      }, 100);
    }
  };

  const handleDownloadArtifact = (artifact: Artifact) =>
    window.open(artifact.downloadUrl, "_blank");

  const handlePreviewArtifact = (artifact: Artifact) =>
    window.open(artifact.downloadUrl, "_blank");

  const handleRestartAgent = () => {
    sendMessage({ type: "restart", data: { sessionId } });
    toast({
      title: "Agent Restarted",
      description: "The agent has been reset and is ready for new tasks.",
    });
  };

  const handleSaveApiKeys = (keys: ApiKeys) => {
    setApiKeys(keys);
    localStorage.setItem("agentdiaz-api-keys", JSON.stringify(keys));

    sendMessage({
      type: "updateKeys",
      data: { sessionId, apiKeys: keys },
    });

    toast({
      title: "API Keys Saved",
      description: "Your API keys have been updated successfully.",
    });
  };

  // ---------- render ----------
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <ChatPanel
        isConnected={isConnected}
        persona={persona}
        tone={tone}
        voiceEnabled={voiceEnabled}
        contentAgentEnabled={contentAgentEnabled}
        chatInput={chatInput}
        isListening={isListening}
        isCarMode={isCarMode}
        onPersonaChange={setPersona}
        onToneChange={setTone}
        onVoiceToggle={setVoiceEnabled}
        onContentAgentToggle={setContentAgentEnabled}
        onChatInputChange={setChatInput}
        onSendMessage={handleSendMessage}
        onStartVoiceInput={
          isSupported
            ? startListening
            : () =>
                toast({
                  title: "Voice input not supported",
                  description:
                    "Your browser doesn't support speech recognition.",
                  variant: "destructive",
                })
        }
        onStartCarMode={
          isSupported
            ? startCarMode
            : () =>
                toast({
                  title: "Voice input not supported",
                  description:
                    "Your browser doesn't support speech recognition.",
                  variant: "destructive",
                })
        }
        onStopCarMode={stopCarMode}
        onShowApiKeys={() => setShowApiKeysModal(true)}
        onRestartAgent={handleRestartAgent}
      />

      <AgentWorkspace
        agentStatus={agentStatus}
        messages={allMessages}
        logs={logs}
        artifacts={artifacts}
        onQuickAction={handleQuickAction}
        onDownloadArtifact={handleDownloadArtifact}
        onPreviewArtifact={handlePreviewArtifact}
      />

      <ApiKeysModal
        isOpen={showApiKeysModal}
        onClose={() => setShowApiKeysModal(false)}
        apiKeys={apiKeys}
        onSave={handleSaveApiKeys}
      />

      <Dialog open={showCalendarPanel} onOpenChange={setShowCalendarPanel}>
        <DialogContent className="max-w-3xl max-h-[90vh] p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Calendar Agent (Beta)</DialogTitle>
          </DialogHeader>
          <CalendarPanel userId={sessionId} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
