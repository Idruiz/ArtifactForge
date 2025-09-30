import { useEffect, useRef, useState, useCallback } from "react";
import { LogEntry, AgentStatus, Artifact, ChatMessage } from "@/lib/types";

interface WebSocketMessage {
  type: "log" | "status" | "artifact" | "message" | "error";
  data: any;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  sendMessage: (message: any) => void;
  logs: LogEntry[];
  agentStatus: AgentStatus;
  artifacts: Artifact[];
  messages: ChatMessage[];
}

export function useWebSocket(sessionId: string): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    currentTask: "Idle",
    progress: 0,
    isProcessing: false,
  });
  const [artifacts, setArtifacts] = useState<Artifact[]>(() => {
    const saved = localStorage.getItem(`agentdiaz-artifacts-${sessionId}`);
    return saved ? JSON.parse(saved) : [];
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem(`agentdiaz-ws-messages-${sessionId}`);
    return saved ? JSON.parse(saved) : [];
  });

  const wsRef = useRef<WebSocket | null>(null);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    const wsUrl = window.location.origin // e.g. https://your‑app.replit.dev
      .replace(/^http/, "ws") // → wss://your‑app.replit.dev
      .concat("/ws"); // → wss://your‑app.replit.dev/ws

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Join session
      ws.send(JSON.stringify({ type: "join", sessionId }));
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        switch (message.type) {
          case "log": {
            const entry = {
              ...message.data,
              // ensure timestamp is a Date instance
              timestamp: new Date(message.data.timestamp),
            };
            setLogs((prev) => [...prev, entry]);
            break;
          }

          case "status":
            setAgentStatus(message.data);
            break;
          case "artifact":
            setArtifacts((prev) => [...prev, message.data]);
            break;
          case "message":
            setMessages((prev) => [...prev, message.data]);
            break;
          case "error":
            console.error("WebSocket error:", message.data);
            break;
        }
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [sessionId]);

  // Persist messages and artifacts
  useEffect(() => {
    localStorage.setItem(`agentdiaz-ws-messages-${sessionId}`, JSON.stringify(messages));
  }, [messages, sessionId]);

  useEffect(() => {
    localStorage.setItem(`agentdiaz-artifacts-${sessionId}`, JSON.stringify(artifacts));
  }, [artifacts, sessionId]);

  return {
    isConnected,
    sendMessage,
    logs,
    agentStatus,
    artifacts,
    messages,
  };
}
