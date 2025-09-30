/* client/src/components/AgentWorkspace.tsx */
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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
  /* ─── utilities ─── */
  const fmtSize = (b: number) => {
    if (!b) return "0 Bytes";
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
    )[type.toLowerCase()] || "📁";

  /* ─── auto‑scroll to latest message / log ─── */
  const chatEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [p.messages]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [p.logs]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ───────── left panel ───────── */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Agent Status
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-slate-600">Current Task</span>
              <Badge
                variant={p.agentStatus.isProcessing ? "default" : "secondary"}
              >
                {p.agentStatus.currentTask}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-slate-600">Progress</span>
              <span className="text-sm font-medium text-slate-900">
                {p.agentStatus.progress}%
              </span>
            </div>
            <Progress value={p.agentStatus.progress} className="w-full" />
          </div>
        </div>

        {/* quick actions */}
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
          {[
            ["presentation", BarChart3, "Create Presentation"],
            ["report", FileText, "Generate Report"],
            ["website", Globe, "Build Website"],
            ["analyze", TrendingUp, "Analyze Data"],
          ].map(([key, Icon, label]) => (
            <Button
              key={key}
              variant="ghost"
              className="w-full justify-start"
              onClick={() => p.onQuickAction(key)}
            >
              <Icon className="w-4 h-4 mr-2" />
              {label}
            </Button>
          ))}
        </div>

        {/* output formats */}
        <div className="p-6">
          <h3 className="text-sm font-semibold mb-3">Output Formats</h3>
          <div className="grid grid-cols-2 gap-2">
            {["PPTX", "PDF", "DOCX", "HTML", "CSV", "MD"].map((f) => (
              <Badge key={f} variant="secondary" className="justify-center">
                {f}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* ───────── right tabs ───────── */}
      <div className="flex-1 flex flex-col">
        <Tabs
          value={p.activeTab}
          onValueChange={(v) => p.onTabChange(v as TabType)}
        >
          <div className="bg-white border-b border-gray-200">
            <TabsList className="h-auto bg-transparent">
              {["chat", "logs", "artifacts"].map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary"
                >
                  {t === "chat" && "Chat & Responses"}
                  {t === "logs" && "Real‑time Logs"}
                  {t === "artifacts" && "Generated Artifacts"}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* CHAT */}
          <TabsContent value="chat" className="flex-1 m-0">
            <ScrollArea className="flex-1 p-6">
              <div className="space-y-4 max-w-4xl">
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
                        className={`max-w-xs lg:max-w-2xl px-4 py-3 rounded-lg ${bg}`}
                      >
                        {m.role === "assistant" && (
                          <div className="flex items-center space-x-2 mb-2">
                            <div className="w-6 h-6 bg-primary rounded-full flex justify-center items-center">
                              <span className="text-xs text-white">AI</span>
                            </div>
                            <span className="text-sm font-medium">
                              AgentFire
                            </span>
                            {m.status && (
                              <Badge
                                variant={
                                  m.status === "completed"
                                    ? "default"
                                    : "secondary"
                                }
                              >
                                {m.status}
                              </Badge>
                            )}
                          </div>
                        )}
                        <p className="text-sm whitespace-pre-wrap">
                          {m.content}
                        </p>
                        {m.steps?.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {m.steps.map((s) => (
                              <div
                                key={s.id}
                                className="flex items-center text-sm space-x-2"
                              >
                                <div
                                  className={`w-4 h-4 rounded-full flex justify-center items-center ${
                                    s.status === "completed"
                                      ? "bg-green-500"
                                      : s.status === "processing"
                                        ? "bg-blue-500 animate-spin"
                                        : "bg-gray-300"
                                  }`}
                                >
                                  {s.status === "completed" && (
                                    <span className="text-xs text-white">
                                      ✓
                                    </span>
                                  )}
                                </div>
                                <span
                                  className={
                                    s.status === "pending"
                                      ? "text-slate-400"
                                      : undefined
                                  }
                                >
                                  {s.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <span className="text-xs opacity-70 mt-2 block">
                          {formatDistanceToNow(m.timestamp, {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
              <ScrollBar orientation="vertical" />
            </ScrollArea>
          </TabsContent>

          {/* LOGS */}
          <TabsContent value="logs" className="flex-1 m-0">
            <ScrollArea className="flex-1 bg-slate-900 text-green-400 font-mono text-sm">
              <div className="p-4 space-y-1">
                {p.logs.map((l) => {
                  // ── guard: ensure ts is Date
                  const ts =
                    typeof l.timestamp === "string"
                      ? new Date(l.timestamp)
                      : l.timestamp;
                  return (
                    <div key={l.id} className="whitespace-pre-wrap">
                      <span className="text-slate-500">
                        [{ts.toISOString().slice(11, 19)}]
                      </span>
                      <span className={`ml-2 ${logColor(l.type)}`}>
                        [{l.type}] {l.message}
                      </span>
                    </div>
                  );
                })}
                {p.logs.length === 0 && (
                  <div className="text-slate-500 text-center py-8">
                    No logs yet. Start a task to see real‑time progress.
                  </div>
                )}
                <div ref={logEndRef} />
              </div>
              <ScrollBar orientation="vertical" />
            </ScrollArea>
          </TabsContent>

          {/* ARTIFACTS */}
          <TabsContent value="artifacts" className="flex-1 m-0">
            <ScrollArea className="flex-1 bg-gray-50">
              <div className="p-6">
                {p.artifacts.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No artifacts generated yet.</p>
                    <p className="text-sm">
                      Start a conversation to create content.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {p.artifacts.map((a) => (
                      <Card key={a.id}>
                        <CardContent className="pt-4">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <CardTitle className="text-base mb-2">
                                {icon(a.fileType)} {a.filename}
                              </CardTitle>
                              <CardDescription className="mb-3">
                                <span className="mr-4">
                                  {a.fileType.toUpperCase()}
                                </span>
                                <span className="mr-4">
                                  {fmtSize(a.fileSize)}
                                </span>
                                <span>
                                  {formatDistanceToNow(a.createdAt, {
                                    addSuffix: true,
                                  })}
                                </span>
                              </CardDescription>
                              <div className="flex flex-wrap gap-2">
                                {a.metadata?.slides && (
                                  <Badge variant="outline">
                                    ✅ {a.metadata.slides} slides
                                  </Badge>
                                )}
                                {a.metadata?.images && (
                                  <Badge variant="outline">
                                    ✅ {a.metadata.images} images
                                  </Badge>
                                )}
                                {a.metadata?.charts && (
                                  <Badge variant="outline">
                                    ✅ {a.metadata.charts} charts
                                  </Badge>
                                )}
                                {a.metadata?.pages && (
                                  <Badge variant="outline">
                                    ✅ {a.metadata.pages} pages
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex space-x-2 ml-4">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => p.onPreviewArtifact(a)}
                              >
                                <Eye className="w-4 h-4 mr-1" /> Preview
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => p.onDownloadArtifact(a)}
                              >
                                <Download className="w-4 h-4 mr-1" /> Download
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
              <ScrollBar orientation="vertical" />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
