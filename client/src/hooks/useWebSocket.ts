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
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    const wsUrl = window.location.origin
      .replace(/^http/, "ws")
      .concat("/ws");

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        ws.send(JSON.stringify({ type: "join", sessionId }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          switch (message.type) {
            case "log": {
              const entry = {
                ...message.data,
                timestamp: new Date(message.data.timestamp),
              };
              setLogs((prev) => [...prev, entry]);
              break;
            }

            case "status":
              setAgentStatus(message.data);
              break;
            case "artifact": {
              const artifact = message.data;
              // Add to artifacts panel
              setArtifacts((prev) => [...prev, artifact]);
              
              // Dual-delivery: Also add as a chat message with attachment
              const attachmentMessage: ChatMessage = {
                id: `artifact-${artifact.id}`,
                role: "assistant",
                content: `✅ Generated: ${artifact.filename}`,
                timestamp: new Date(artifact.createdAt || new Date()),
                status: "completed",
                attachments: [{
                  id: artifact.id,
                  filename: artifact.filename,
                  fileType: artifact.fileType,
                  fileSize: artifact.fileSize,
                  downloadUrl: artifact.downloadUrl,
                }],
              };
              setMessages((prev) => [...prev, attachmentMessage]);
              break;
            }
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
        
        // Auto-reconnect with exponential backoff
        if (reconnectAttemptsRef.current < 10) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Reconnecting... (attempt ${reconnectAttemptsRef.current})`);
            connect();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setIsConnected(false);
      };
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [sessionId]);

  return {
    isConnected,
    sendMessage,
    logs,
    agentStatus,
    artifacts,
    messages,
  };
}
