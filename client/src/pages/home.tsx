import { useState, useEffect } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { AgentWorkspace } from "@/components/AgentWorkspace";
import { ApiKeysModal } from "@/components/ApiKeysModal";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useVoice } from "@/hooks/useVoice";
import { useToast } from "@/hooks/use-toast";
import {
  ApiKeys,
  Persona,
  Tone,
  TabType,
  Artifact,
  ChatMessage,
} from "@/lib/types";
import { nanoid } from "nanoid";

// ---------- persist keys between reloads ----------
const storedKeys = JSON.parse(
  localStorage.getItem("agentdiaz-api-keys") || "{}",
) as Partial<ApiKeys>;

export default function Home() {
  const { toast } = useToast();

  // ---------- session (persisted across reloads) ----------
  const [sessionId] = useState(() => {
    const stored = localStorage.getItem('agentdiaz-session-id');
    if (stored) return stored;
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
  const [activeTab, setActiveTab] = useState<TabType>("chat");
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

  // ---------- local copy of user messages with persistence ----------
  const [userMessages, setUserMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem(`agentdiaz-messages-${sessionId}`);
    return saved ? JSON.parse(saved) : [];
  });

  // merge WS messages (assistant) + local user messages and sort by timestamp
  const allMessages = [...userMessages, ...wsMessages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // persist user messages
  useEffect(() => {
    localStorage.setItem(`agentdiaz-messages-${sessionId}`, JSON.stringify(userMessages));
  }, [userMessages, sessionId]);

  // ---------- voice hook ----------
  const { isListening, isSupported, startListening, speak } = useVoice(
    (text) => {
      setChatInput((prev) => prev + (prev ? " " : "") + text);
    },
  );

  // ---------- speak assistant replies ----------
  useEffect(() => {
    if (voiceEnabled && wsMessages.length > 0) {
      const last = wsMessages[wsMessages.length - 1];
      if (last.role === "assistant" && last.status === "completed") {
        speak(last.content);
      }
    }
  }, [wsMessages, voiceEnabled, speak]);

  // ---------- handlers ----------
  const handleSendMessage = () => {
    if (!chatInput.trim()) return;

    // store user message locally for immediate display
    setUserMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: chatInput,
        timestamp: new Date(),
        status: "completed",
      },
    ]);

    // send to server with conversation history for context (optimized - only essential data)
    sendMessage({
      type: "chat",
      data: {
        sessionId,
        content: chatInput,
        persona,
        tone,
        contentAgentEnabled,
        apiKeys,
        conversationHistory: allMessages.slice(-6).map(m => ({ role: m.role, content: m.content })), // last 6 messages, minimal data
      },
    });

    setChatInput("");
    setActiveTab("chat");
  };

  const handleQuickAction = (action: string) => {
    const prompts: Record<string, string> = {
      presentation:
        "Create a professional presentation with multiple slides including charts and images",
      report:
        "Generate a comprehensive research report with data analysis and visualizations",
      website: "Build a complete website with multiple pages and modern design",
      analyze:
        "Analyze the provided data and create insights with charts and summaries",
    };
    const prompt = prompts[action] || "";
    if (prompt) {
      setChatInput(prompt);
      // Auto-send the message
      setTimeout(() => {
        if (prompt) {
          setUserMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "user",
              content: prompt,
              timestamp: new Date(),
              status: "completed",
            },
          ]);
          sendMessage({
            type: "chat",
            data: {
              sessionId,
              content: prompt,
              persona,
              tone,
              contentAgentEnabled,
              apiKeys,
              conversationHistory: allMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
            },
          });
          setChatInput("");
          setActiveTab("chat");
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
        onShowApiKeys={() => setShowApiKeysModal(true)}
        onRestartAgent={handleRestartAgent}
      />

      <AgentWorkspace
        agentStatus={agentStatus}
        messages={allMessages}
        logs={logs}
        artifacts={artifacts}
        activeTab={activeTab}
        onTabChange={setActiveTab}
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
    </div>
  );
}
