/* client/src/components/AgentWorkspace.tsx */
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";

import {
  Download,
  Eye,
  FileText,
  BarChart3,
  Globe,
  TrendingUp,
} from "lucide-react";
import type {
  AgentStatus,
  ChatMessage,
  LogEntry,
  Artifact,
  TabType,
} from "@/lib/types";
import { formatDistanceToNow } from "date-fns";

interface Props {
  agentStatus: AgentStatus;
  messages: ChatMessage[];
  logs: LogEntry[];
  artifacts: Artifact[];
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onQuickAction: (action: string) => void;
  onDownloadArtifact: (a: Artifact) => void;
  onPreviewArtifact: (a: Artifact) => void;
}

export function AgentWorkspace(p: Props) {
  /* --- utilities --- */
  const fmtSize = (b: number) => {
    if (!b) return "0 Bytes";
    const k = 1024;
    const i = Math.floor(Math.log(b) / Math.log(k));
    return (b / Math.pow(k, i)).toFixed(1) + " " + ["B", "KB", "MB", "GB"][i];
  };

  const logColor = (t: string) =>
    ({
      step_start: "text-blue-400",
      step_end: "text-blue-400",
      trace: "text-green-400",
      delivery: "text-yellow-400",
    })[t as keyof Record<string, string>] || "text-gray-400";

  const icon = (type: string) =>
    (
      ({
        pptx: "📊",
        pdf: "📄",
        docx: "📝",
        html: "🌐",
        csv: "📈",
        md: "📋",
      }) as Record<string, string>
    )[type?.toLowerCase() || ""] || "📁";

  /* --- auto-scroll only when near bottom --- */
  const chatEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
    if (isNearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "instant" as any });
    }
  }, [p.messages]);

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) return;
    
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
    if (isNearBottom) {
      logEndRef.current?.scrollIntoView({ behavior: "instant" as any });
    }
  }, [p.logs]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* TOP BAR - Status & Quick Actions */}
      <div className="bg-white border-b border-gray-200 p-4 shrink-0">
        <div className="flex items-center gap-8">
          {/* Agent Status - Compact */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">Task:</span>
              <Badge variant={p.agentStatus.isProcessing ? "default" : "secondary"}>
                {p.agentStatus.currentTask}
              </Badge>
            </div>
            <div className="flex items-center gap-2 min-w-[200px]">
              <span className="text-sm text-slate-600">Progress:</span>
              <Progress value={p.agentStatus.progress} className="flex-1" />
              <span className="text-sm font-medium text-slate-900 min-w-[40px]">
                {p.agentStatus.progress}%
              </span>
            </div>
          </div>

          {/* Quick Actions - Horizontal */}
          <div className="flex items-center gap-2 flex-1">
            {([
              ["presentation", BarChart3, "Presentation"],
              ["report", FileText, "Report"],
              ["website", Globe, "Website"],
              ["analyze", TrendingUp, "Analyze"],
            ] as const).map(([key, Icon, label]) => (
              <Button
                key={key}
                variant="ghost"
                size="sm"
                onClick={() => p.onQuickAction(key as string)}
                data-testid={`button-quick-${key}`}
              >
                <Icon className="w-4 h-4 mr-1" />
                {label}
              </Button>
            ))}
          </div>

          {/* Output Formats - Compact */}
          <div className="flex items-center gap-2">
            {["PPTX", "PDF", "DOCX", "HTML", "CSV", "MD"].map((f) => (
              <Badge key={f} variant="outline" className="text-xs">
                {f}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* TABS - FULL WIDTH */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Tabs
          value={p.activeTab}
          onValueChange={(v) => p.onTabChange(v as TabType)}
          className="flex-1 flex flex-col"
        >
          <div className="bg-white border-b border-gray-200">
            <TabsList className="h-auto bg-transparent w-full justify-start">
              {["chat", "logs", "artifacts"].map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary"
                  data-testid={`tab-${t}`}
                >
                  {t === "chat" && "💬 Chat & Responses"}
                  {t === "logs" && "📋 Real-time Logs"}
                  {t === "artifacts" && "📦 Generated Artifacts"}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* CHAT */}
          <TabsContent value="chat" className="flex-1 m-0 overflow-hidden">
            <div ref={chatContainerRef} className="h-full overflow-y-scroll overflow-x-hidden p-4 md:p-6 scrollbar-visible" style={{ WebkitOverflowScrolling: "touch" }}>
              <div className="space-y-4 max-w-4xl mx-auto">
                {p.messages.map((m) => {
                  const bg =
                    m.role === "user"
                      ? "bg-primary text-white"
                      : "bg-white border shadow-sm";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] md:max-w-xs lg:max-w-2xl px-4 py-3 rounded-lg ${bg}`}
                      >
                        {m.role === "assistant" && (
                          <div className="flex items-center space-x-2 mb-2">
                            <div className="w-6 h-6 bg-primary rounded-full flex justify-center items-center">
                              <span className="text-xs text-white">AI</span>
                            </div>
                            <span className="text-xs text-slate-500">Agent Diaz</span>
                          </div>
                        )}
                        <p className="text-sm md:text-base whitespace-pre-wrap break-words">
                          {m.content}
                        </p>
                        {m.status === "streaming" && (
                          <div className="mt-2 flex items-center space-x-1">
                            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                            <div className="w-2 h-2 bg-primary rounded-full animate-bounce delay-75" />
                            <div className="w-2 h-2 bg-primary rounded-full animate-bounce delay-150" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
            </div>
          </TabsContent>

          {/* LOGS */}
          <TabsContent value="logs" className="flex-1 m-0 overflow-hidden">
            <div ref={logContainerRef} className="h-full overflow-y-scroll p-4 md:p-6 bg-slate-900 font-mono text-sm scrollbar-visible" style={{ WebkitOverflowScrolling: "touch" }}>
              <div className="space-y-1">
                {p.logs.map((l, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="text-slate-500 shrink-0 tabular-nums">
                      {new Date(l.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`${logColor(l.type)} break-words flex-1`}>
                      [{l.type.toUpperCase()}] {l.message}
                    </span>
                  </div>
                ))}
                {p.logs.length === 0 && (
                  <div className="text-slate-500 text-center py-8">
                    No logs yet. Logs will appear here as the agent works.
                  </div>
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          </TabsContent>

          {/* ARTIFACTS */}
          <TabsContent value="artifacts" className="flex-1 m-0 overflow-hidden">
            <div className="h-full overflow-y-scroll p-4 md:p-6 bg-gray-50 scrollbar-visible" style={{ WebkitOverflowScrolling: "touch" }}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl mx-auto">
                {p.artifacts.map((a) => (
                  <Card key={a.id} className="hover:shadow-lg transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-2xl">{icon(a.type)}</span>
                          <div>
                            <CardTitle className="text-sm font-medium">
                              {a.filename}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {a.type.toUpperCase()} • {fmtSize(a.size)}
                            </CardDescription>
                          </div>
                        </div>
                      </div>

                      {a.metadata?.title && (
                        <p className="text-sm text-slate-600 mb-3 line-clamp-2">
                          {a.metadata.title}
                        </p>
                      )}

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => p.onPreviewArtifact(a)}
                          data-testid={`button-preview-${a.id}`}
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => p.onDownloadArtifact(a)}
                          data-testid={`button-download-${a.id}`}
                        >
                          <Download className="w-3 h-3 mr-1" />
                          Download
                        </Button>
                      </div>

                      {a.createdAt && (
                        <p className="text-xs text-slate-400 mt-2">
                          {formatDistanceToNow(new Date(a.createdAt), {
                            addSuffix: true,
                          })}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {p.artifacts.length === 0 && (
                  <div className="col-span-full text-center py-12 text-slate-500">
                    <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No artifacts generated yet.</p>
                    <p className="text-sm mt-1">
                      Generated files will appear here.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
