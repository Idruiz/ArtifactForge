import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Send, Link as LinkIcon, CheckCircle2, Clock, Users, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CalendarPanelProps {
  userId: string;
}

interface Alias {
  alias: string;
  email?: string;
  icsUrl?: string;
}

export function CalendarPanel({ userId }: CalendarPanelProps) {
  const { toast } = useToast();
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [command, setCommand] = useState("");
  const [eventResult, setEventResult] = useState<any>(null);
  const [findFreeResult, setFindFreeResult] = useState<any>(null);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [showAliasForm, setShowAliasForm] = useState(false);
  const [newAlias, setNewAlias] = useState({ alias: "", email: "", icsUrl: "" });
  
  const inputRef = useRef<HTMLInputElement>(null);

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/calendar/config");
      const config = await response.json();
      
      if (!config.webAppUrl || !config.sharedToken) {
        toast({
          title: "Configuration Error",
          description: "Google Apps Script credentials not configured on server.",
          variant: "destructive",
        });
        return;
      }

      await apiRequest("POST", "/calendar-proxy/register", {
        userId,
        webAppUrl: config.webAppUrl,
        sharedToken: config.sharedToken,
      });

      setIsRegistered(true);
      loadAliases();
      toast({
        title: "Success",
        description: "Calendar connected successfully!",
      });
    } catch (error: any) {
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect calendar",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadAliases = async () => {
    try {
      const response = await apiRequest("GET", "/calendar-proxy/alias/list");
      const data = await response.json();
      setAliases(data.aliases || []);
    } catch (error) {
      console.error("Failed to load aliases:", error);
    }
  };

  const handleAddAlias = async () => {
    if (!newAlias.alias.trim() || (!newAlias.email.trim() && !newAlias.icsUrl.trim())) {
      toast({
        title: "Validation Error",
        description: "Please provide an alias name and either an email or ICS URL",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      await apiRequest("POST", "/calendar-proxy/alias/upsert", {
        alias: newAlias.alias,
        email: newAlias.email || undefined,
        icsUrl: newAlias.icsUrl || undefined,
      });

      toast({
        title: "Alias Saved",
        description: `You can now use "${newAlias.alias}" in your commands`,
      });

      setNewAlias({ alias: "", email: "", icsUrl: "" });
      setShowAliasForm(false);
      loadAliases();
    } catch (error: any) {
      toast({
        title: "Failed to Save Alias",
        description: error.message || "Could not save alias",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommand = async () => {
    if (!command.trim()) return;

    setIsLoading(true);
    setEventResult(null);
    setFindFreeResult(null);
    
    try {
      const response = await apiRequest("POST", "/calendar-proxy/command", {
        userId,
        text: command,
        tz: "America/Los_Angeles",
        workHours: { start: "09:00", end: "18:00" },
      });

      const data = await response.json();

      if (data.intent === "schedule" && data.success) {
        setEventResult(data.event);
        toast({
          title: "Event Scheduled",
          description: `Successfully created: ${data.event.title || "Meeting"}`,
        });
        setCommand("");
      } else if (data.intent === "find_free") {
        setFindFreeResult(data);
        toast({
          title: "Search Request",
          description: data.message || "Ready to find free slots",
        });
      }
    } catch (error: any) {
      toast({
        title: "Command Failed",
        description: error.message || "Could not process command. Try: 'book a 30 min meeting at 2pm today'",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAutoBook = async () => {
    if (!findFreeResult?.params) return;

    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/calendar-proxy/free", findFreeResult.params);
      const freeData = await response.json();

      if (freeData.free && freeData.free.length > 0) {
        const firstSlot = freeData.free[0];
        const scheduleResponse = await apiRequest("POST", "/calendar-proxy/schedule", {
          ...findFreeResult.params,
          title: "Meeting",
          description: "Auto-scheduled",
          preferredStart: firstSlot.start.split('T')[1],
        });

        const scheduleData = await scheduleResponse.json();
        setEventResult(scheduleData);
        setFindFreeResult(null);
        toast({
          title: "Event Scheduled",
          description: `Booked at ${firstSlot.start}`,
        });
      } else {
        toast({
          title: "No Free Slots",
          description: "Could not find any available time",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Auto-Book Failed",
        description: error.message || "Could not auto-schedule",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-50 dark:bg-slate-900">
      <div className="max-w-2xl mx-auto space-y-4">
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 dark:text-white">
              <Calendar className="w-5 h-5" />
              Calendar Agent (Beta)
            </CardTitle>
            <CardDescription className="dark:text-slate-400">
              Schedule meetings using natural language commands
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isRegistered ? (
              <div className="space-y-3">
                <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-900 dark:text-blue-100">
                    Connect your Google Calendar to start scheduling meetings with natural language commands.
                  </p>
                </div>
                <Button
                  onClick={handleConnect}
                  disabled={isLoading}
                  className="w-full"
                  data-testid="button-connect-calendar"
                >
                  <LinkIcon className="w-4 h-4 mr-2" />
                  {isLoading ? "Connecting..." : "Connect Google Calendar"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm text-green-900 dark:text-green-100">Calendar connected</span>
                </div>

                {/* Quick Command Input */}
                <div className="space-y-2">
                  <Label htmlFor="quick-command" className="dark:text-white">
                    Quick Command
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      ref={inputRef}
                      id="quick-command"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !isLoading && handleCommand()}
                      placeholder='Try: "book a 30 min with colleague calendar at 2pm today"'
                      className="flex-1 dark:bg-slate-700 dark:text-white dark:border-slate-600"
                      disabled={isLoading}
                      data-testid="input-quick-command"
                    />
                    <Button
                      onClick={handleCommand}
                      disabled={isLoading || !command.trim()}
                      data-testid="button-run-command"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground dark:text-slate-400">
                    Examples: "schedule team meeting tomorrow at 3pm 60 min" • "find free 30 min slot with colleague calendar"
                  </p>
                </div>

                {/* Aliases Section */}
                <Card className="bg-white dark:bg-slate-700 border dark:border-slate-600">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm dark:text-white">Contact Aliases</CardTitle>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowAliasForm(!showAliasForm)}
                        data-testid="button-toggle-alias-form"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {showAliasForm && (
                      <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-800 rounded border dark:border-slate-600">
                        <Input
                          placeholder="Alias (e.g., colleague calendar)"
                          value={newAlias.alias}
                          onChange={(e) => setNewAlias({ ...newAlias, alias: e.target.value })}
                          className="dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                          data-testid="input-alias-name"
                        />
                        <Input
                          placeholder="Email (optional)"
                          type="email"
                          value={newAlias.email}
                          onChange={(e) => setNewAlias({ ...newAlias, email: e.target.value })}
                          className="dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                          data-testid="input-alias-email"
                        />
                        <Input
                          placeholder="ICS URL (optional)"
                          type="url"
                          value={newAlias.icsUrl}
                          onChange={(e) => setNewAlias({ ...newAlias, icsUrl: e.target.value })}
                          className="dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                          data-testid="input-alias-ics"
                        />
                        <Button
                          size="sm"
                          onClick={handleAddAlias}
                          disabled={isLoading}
                          className="w-full"
                          data-testid="button-save-alias"
                        >
                          Save Alias
                        </Button>
                      </div>
                    )}
                    {aliases.length > 0 ? (
                      <div className="space-y-1">
                        {aliases.map((alias, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded text-sm"
                            data-testid={`alias-item-${idx}`}
                          >
                            <Users className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                            <span className="font-medium dark:text-white">{alias.alias}</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {alias.email || alias.icsUrl}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground dark:text-slate-400">
                        No aliases yet. Add contacts to use in commands.
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Find Free Result */}
                {findFreeResult && (
                  <Card className="bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2 text-amber-900 dark:text-amber-100">
                        <Clock className="w-4 h-4" />
                        Free Slot Search
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm text-amber-900 dark:text-amber-100">
                        {findFreeResult.message}
                      </p>
                      <Button
                        size="sm"
                        onClick={handleAutoBook}
                        disabled={isLoading}
                        data-testid="button-auto-book"
                      >
                        Auto-Book First Available
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Event Result */}
                {eventResult && (
                  <Card className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2 text-green-900 dark:text-green-100">
                        <CheckCircle2 className="w-4 h-4" />
                        Event Created
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm text-green-900 dark:text-green-100">
                        <strong>Title:</strong> {eventResult.title || "Meeting"}
                      </p>
                      <p className="text-sm text-green-900 dark:text-green-100">
                        <strong>Time:</strong> {eventResult.start} - {eventResult.end}
                      </p>
                      {eventResult.htmlLink && (
                        <a
                          href={eventResult.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                          data-testid="link-calendar-event"
                        >
                          <LinkIcon className="w-3 h-3" />
                          View in Google Calendar
                        </a>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
