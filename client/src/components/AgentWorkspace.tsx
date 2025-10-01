/* client/src/components/AgentWorkspace.tsx */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
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
  ArrowDown,
} from "lucide-react";
import type {
  AgentStatus,
  ChatMessage,
  LogEntry,
  Artifact,
  ArtifactRef,
} from "@/lib/types";
import { formatDistanceToNow } from "date-fns";

interface Props {
  agentStatus: AgentStatus;
  messages: ChatMessage[];
  logs: LogEntry[];
  artifacts: Artifact[];
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

  /* --- auto-scroll with user override --- */
  const chatEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Chat auto-scroll with near-bottom detection
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      150;

    if (isNearBottom) {
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
  }, [p.messages]);

  // Scroll listener to hide/show jump button
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        150;
      setShowJumpToLatest(!isNearBottom);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Log auto-scroll
  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) return;

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      200;
    if (isNearBottom) {
      logEndRef.current?.scrollIntoView({ behavior: "instant" as any });
    }
  }, [p.logs]);

  const jumpToLatest = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowJumpToLatest(false);
  };

  /* --- panel size persistence --- */
  const getPanelSizes = () => {
    try {
      const saved = localStorage.getItem("agentdiaz-panel-sizes");
      return saved ? JSON.parse(saved) : { left: 15, center: 50, right: 35 };
    } catch {
      return { left: 15, center: 50, right: 35 };
    }
  };

  const savePanelSizes = (sizes: { left: number; center: number; right: number }) => {
    try {
      localStorage.setItem("agentdiaz-panel-sizes", JSON.stringify(sizes));
    } catch {
      // ignore
    }
  };

  const [panelSizes] = useState(getPanelSizes());

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* TOP BAR - Status & Quick Actions */}
      <div className="bg-white border-b border-gray-200 p-3 shrink-0">
        <div className="flex items-center gap-4">
          {/* Agent Status - Compact */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600">Task:</span>
              <Badge
                variant={p.agentStatus.isProcessing ? "default" : "secondary"}
                className="text-xs"
              >
                {p.agentStatus.currentTask}
              </Badge>
            </div>
            <div className="flex items-center gap-2 min-w-[180px]">
              <span className="text-xs text-slate-600">Progress:</span>
              <Progress value={p.agentStatus.progress} className="flex-1 h-2" />
              <span className="text-xs font-medium text-slate-900 min-w-[35px]">
                {p.agentStatus.progress}%
              </span>
            </div>
          </div>

          {/* Output Formats - Compact */}
          <div className="flex items-center gap-1.5">
            {["PPTX", "DOCX", "HTML", "CSV", "MD"].map((f) => (
              <Badge key={f} variant="outline" className="text-xs px-1.5 py-0.5">
                {f}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* THREE-PANEL RESIZABLE LAYOUT */}
      <ResizablePanelGroup
        direction="horizontal"
        className="flex-1"
        onLayout={(sizes) => {
          if (sizes.length === 3) {
            savePanelSizes({
              left: sizes[0],
              center: sizes[1],
              right: sizes[2],
            });
          }
        }}
      >
        {/* LEFT PANEL - Quick Actions */}
        <ResizablePanel
          defaultSize={panelSizes.left}
          minSize={10}
          maxSize={25}
          className="bg-slate-50"
        >
          <div className="h-full p-3 overflow-y-auto">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Quick Actions
            </h3>
            <div className="space-y-2">
              {([
                ["presentation", BarChart3, "Presentation"],
                ["report", FileText, "Report"],
                ["website", Globe, "Website"],
                ["analyze", TrendingUp, "Analyze"],
              ] as const).map(([key, Icon, label]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  onClick={() => p.onQuickAction(key as string)}
                  className="w-full justify-start"
                  data-testid={`button-quick-${key}`}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* CENTER PANEL - Chat */}
        <ResizablePanel defaultSize={panelSizes.center} minSize={30}>
          <div className="h-full flex flex-col bg-white">
            <div className="border-b border-gray-200 px-4 py-2">
              <h3 className="text-sm font-semibold text-slate-900">
                💬 Chat & Responses
              </h3>
            </div>
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto p-4 relative"
            >
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
                        className={`max-w-[85%] md:max-w-md lg:max-w-2xl px-4 py-3 rounded-lg ${bg}`}
                      >
                        {m.role === "assistant" && (
                          <div className="flex items-center space-x-2 mb-2">
                            <div className="w-6 h-6 bg-primary rounded-full flex justify-center items-center">
                              <span className="text-xs text-white">AI</span>
                            </div>
                            <span className="text-xs text-slate-500">
                              Agent Diaz
                            </span>
                          </div>
                        )}
                        <p className="text-sm md:text-base whitespace-pre-wrap break-words">
                          {m.content}
                        </p>
                        {m.status === "processing" && (
                          <div className="mt-2 flex items-center space-x-1">
                            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                            <div className="w-2 h-2 bg-primary rounded-full animate-bounce delay-75" />
                            <div className="w-2 h-2 bg-primary rounded-full animate-bounce delay-150" />
                          </div>
                        )}
                        {/* In-chat artifact attachments */}
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {m.attachments.map((att: ArtifactRef) => (
                              <div
                                key={att.id}
                                className="flex items-center gap-2 p-2 bg-slate-100 dark:bg-slate-800 rounded border"
                              >
                                <span className="text-lg">{icon(att.fileType)}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium truncate">
                                    {att.filename}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {fmtSize(att.fileSize)}
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => window.open(att.downloadUrl, "_blank")}
                                  data-testid={`button-download-${att.id}`}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {/* Jump to Latest button */}
              {showJumpToLatest && (
                <div className="absolute bottom-4 right-4">
                  <Button
                    size="sm"
                    onClick={jumpToLatest}
                    className="shadow-lg"
                    data-testid="button-jump-to-latest"
                  >
                    <ArrowDown className="w-4 h-4 mr-1" />
                    Jump to latest
                  </Button>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* RIGHT PANEL - Logs (top) + Artifacts (bottom) */}
        <ResizablePanel defaultSize={panelSizes.right} minSize={25}>
          <ResizablePanelGroup direction="vertical">
            {/* LOGS PANEL */}
            <ResizablePanel defaultSize={50} minSize={20}>
              <div className="h-full flex flex-col bg-slate-900">
                <div className="border-b border-slate-700 px-4 py-2">
                  <h3 className="text-sm font-semibold text-white">
                    📋 Real-time Logs
                  </h3>
                </div>
                <div
                  ref={logContainerRef}
                  className="flex-1 overflow-y-auto p-3 font-mono text-xs"
                >
                  <div className="space-y-1">
                    {p.logs.map((l, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <span className="text-slate-500 shrink-0 tabular-nums text-[10px]">
                          {new Date(l.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={`${logColor(l.type)} break-words flex-1 text-[11px]`}>
                          [{l.type?.toUpperCase() || "LOG"}] {l.message}
                        </span>
                      </div>
                    ))}
                    {p.logs.length === 0 && (
                      <div className="text-slate-500 text-center py-8 text-xs">
                        No logs yet. Logs will appear here as the agent works.
                      </div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* ARTIFACTS PANEL */}
            <ResizablePanel defaultSize={50} minSize={20}>
              <div className="h-full flex flex-col bg-white">
                <div className="border-b border-gray-200 px-4 py-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    📦 Generated Artifacts
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {p.artifacts.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-sm">
                      No artifacts yet. Generated files will appear here.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {p.artifacts.map((a) => (
                        <Card
                          key={a.id}
                          className="hover:shadow-md transition-shadow"
                          data-testid={`artifact-${a.id}`}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start gap-3">
                              <span className="text-2xl">{icon(a.fileType)}</span>
                              <div className="flex-1 min-w-0">
                                <CardTitle className="text-sm font-semibold truncate">
                                  {a.filename}
                                </CardTitle>
                                <CardDescription className="text-xs mt-1">
                                  {fmtSize(a.fileSize)} •{" "}
                                  {formatDistanceToNow(new Date(a.createdAt), {
                                    addSuffix: true,
                                  })}
                                </CardDescription>
                                {a.metadata && (
                                  <div className="flex gap-2 mt-2">
                                    {a.metadata.slides && (
                                      <Badge variant="secondary" className="text-xs">
                                        {a.metadata.slides} slides
                                      </Badge>
                                    )}
                                    {a.metadata.pages && (
                                      <Badge variant="secondary" className="text-xs">
                                        {a.metadata.pages} pages
                                      </Badge>
                                    )}
                                    {a.metadata.images && (
                                      <Badge variant="secondary" className="text-xs">
                                        {a.metadata.images} images
                                      </Badge>
                                    )}
                                    {a.metadata.charts && (
                                      <Badge variant="secondary" className="text-xs">
                                        {a.metadata.charts} charts
                                      </Badge>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => p.onPreviewArtifact(a)}
                                  data-testid={`button-preview-${a.id}`}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => p.onDownloadArtifact(a)}
                                  data-testid={`button-download-${a.id}`}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
