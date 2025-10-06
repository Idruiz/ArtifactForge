import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Conversation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, Download, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { nanoid } from "nanoid";

interface ConversationSidebarProps {
  currentConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
}

export function ConversationSidebar({
  currentConversationId,
  onSelectConversation,
  onNewConversation,
}: ConversationSidebarProps) {
  const { toast } = useToast();

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    queryFn: async () => {
      const res = await fetch("/api/conversations?limit=10");
      if (!res.ok) throw new Error("Failed to load conversations");
      return res.json();
    },
  });

  const exportMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await fetch(`/api/conversations/${conversationId}/export`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to export conversation");
      return res.json();
    },
    onSuccess: (data) => {
      const a = document.createElement("a");
      a.href = data.url;
      a.download = data.filename;
      a.click();
      toast({
        title: "Exported!",
        description: "Conversation exported to CSV",
      });
    },
    onError: () => {
      toast({
        title: "Export failed",
        description: "Could not export conversation",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete conversation");
      return res.json();
    },
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (currentConversationId === conversationId) {
        onNewConversation();
      }
      toast({
        title: "Deleted",
        description: "Conversation deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Could not delete conversation",
        variant: "destructive",
      });
    },
  });

  const formatDate = (dateString: Date | string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <Button
          onClick={onNewConversation}
          className="w-full"
          data-testid="button-new-conversation"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Conversation
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading && (
            <div className="text-center p-4 text-sm text-slate-500 dark:text-slate-400">
              Loading conversations...
            </div>
          )}

          {!isLoading && conversations.length === 0 && (
            <div className="text-center p-4 text-sm text-slate-500 dark:text-slate-400">
              No conversations yet. Start a new one!
            </div>
          )}

          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group relative p-3 rounded-lg cursor-pointer transition-colors ${
                currentConversationId === conv.id
                  ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700"
                  : "hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
              onClick={() => onSelectConversation(conv.id)}
              data-testid={`conversation-item-${conv.id}`}
            >
              <div className="flex items-start gap-2">
                <MessageSquare className="w-4 h-4 mt-1 flex-shrink-0 text-slate-500 dark:text-slate-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate text-slate-900 dark:text-slate-100">
                    {conv.title}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {formatDate(conv.updatedAt)}
                  </div>
                </div>
              </div>

              <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    exportMutation.mutate(conv.id);
                  }}
                  data-testid={`button-export-${conv.id}`}
                >
                  <Download className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this conversation?")) {
                      deleteMutation.mutate(conv.id);
                    }
                  }}
                  data-testid={`button-delete-${conv.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
