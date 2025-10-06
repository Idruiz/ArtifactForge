import { useState, useEffect, useRef } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { AgentWorkspace } from "@/components/AgentWorkspace";
import { ApiKeysModal } from "@/components/ApiKeysModal";
import { CalendarPanel } from "@/components/CalendarPanel";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useCarMode } from "@/hooks/useCarMode";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

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

  // ---------- conversation management ----------
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(() => {
    return localStorage.getItem('agentdiaz-current-conversation') || null;
  });

  // Save conversation messages to database
  const saveMessageMutation = useMutation({
    mutationFn: async ({ conversationId, role, content }: { conversationId: string, role: string, content: string }) => {
      const res = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, { role, content });
      return res.json();
    },
  });

  // Create new conversation
  const createConversationMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string, title: string }) => {
      const res = await apiRequest("POST", "/api/conversations", { id, userId: sessionId, title });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setCurrentConversationId(data.id);
      localStorage.setItem('agentdiaz-current-conversation', data.id);
    },
  });

  const handleNewConversation = () => {
    const newId = nanoid();
    const title = `Conversation ${new Date().toLocaleString()}`;
    createConversationMutation.mutate({ id: newId, title });
    setUserMessages([]); // Clear local messages for new conversation
  };

  const handleSelectConversation = async (conversationId: string) => {
    setCurrentConversationId(conversationId);
    localStorage.setItem('agentdiaz-current-conversation', conversationId);
    
    // Load messages from conversation
    try {
      const res = await fetch(`/api/conversations/${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        const loadedMessages = data.messages.map((msg: any) => ({
          id: msg.id.toString(),
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.createdAt),
          status: "completed",
        }));
        setUserMessages(loadedMessages);
      }
    } catch (error) {
      console.error("Failed to load conversation:", error);
      toast({
        title: "Error",
        description: "Failed to load conversation messages",
        variant: "destructive",
      });
    }
  };

  // Auto-create first conversation if none exists
  useEffect(() => {
    if (!currentConversationId) {
      handleNewConversation();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- UI state ----------
  const [persona, setPersona] = useState<Persona>("professional");
  const [tone, setTone] = useState<Tone>("formal");
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

  // ---------- Car Mode with working V2 logic ----------
  const { 
    isCarMode,
    startCarMode,
    stopCarMode,
    speak: carModeSpeak
  } = useCarMode(
    async (text) => {
      // Transcription received from Car Mode
      if (!text.trim() || !currentConversationId) return;

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

      // Save user message to database
      if (currentConversationId) {
        saveMessageMutation.mutate({
          conversationId: currentConversationId,
          role: "user",
          content: text,
        });
      }

      // Call orchestrator first
      const orchResult = await callOrchestrator({
        userId,
        text,
        conversationId: currentConversationId,
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

        // Save assistant response to database
        if (currentConversationId) {
          saveMessageMutation.mutate({
            conversationId: currentConversationId,
            role: "assistant",
            content: responseContent,
          });
        }

        // Always speak in car mode
        carModeSpeak(responseContent);
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
          contentAgentEnabled: false, // ALWAYS false for Car Mode generic chat - prevents artifact generation
          apiKeys,
          conversationHistory: allMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        },
      });
    }
  );

  // ---------- speak assistant replies in Car Mode ----------
  const lastSpokenIdRef = useRef<string>("");
  const speakingInProgressRef = useRef<boolean>(false);
  
  useEffect(() => {
    if (isCarMode && wsMessages.length > 0 && !speakingInProgressRef.current) {
      const last = wsMessages[wsMessages.length - 1];
      if (last.role === "assistant" && last.status === "completed" && last.id !== lastSpokenIdRef.current) {
        console.log(`[TTS Trigger] Speaking message ID: ${last.id}`);
        lastSpokenIdRef.current = last.id;
        speakingInProgressRef.current = true;
        carModeSpeak(last.content);
        setTimeout(() => {
          speakingInProgressRef.current = false;
        }, 1000);
      }
    }
  }, [wsMessages, isCarMode, carModeSpeak]);

  // ---------- handlers ----------
  const handleSendMessage = async () => {
    if (!chatInput.trim() || !currentConversationId) return;

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

    // Save user message to database
    if (currentConversationId) {
      saveMessageMutation.mutate({
        conversationId: currentConversationId,
        role: "user",
        content: userMessage,
      });
    }

    // Call orchestrator first
    const orchResult = await callOrchestrator({
      userId,
      text: userMessage,
      conversationId: currentConversationId,
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

      // Save assistant response to database
      if (currentConversationId) {
        saveMessageMutation.mutate({
          conversationId: currentConversationId,
          role: "assistant",
          content: responseContent,
        });
      }

      // Response already added to messages above
      // Car Mode will auto-speak via the effect hook
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
        contentAgentEnabled={contentAgentEnabled}
        chatInput={chatInput}
        isCarMode={isCarMode}
        onPersonaChange={setPersona}
        onToneChange={setTone}
        onContentAgentToggle={setContentAgentEnabled}
        onChatInputChange={setChatInput}
        onSendMessage={handleSendMessage}
        onStartCarMode={startCarMode}
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
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
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
