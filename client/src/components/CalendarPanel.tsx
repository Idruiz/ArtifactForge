import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Send, Link as LinkIcon, CheckCircle2, Trash2, Plus, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CalendarPanelProps {
  userId: string;
}

interface Colleague {
  alias: string;
  email?: string;
  ics_url?: string;
}

interface ConnectorState {
  user_id?: string;
  web_app_url?: string;
  shared_token?: string;
}

export function CalendarPanel({ userId }: CalendarPanelProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [connector, setConnector] = useState<ConnectorState | null>(null);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [command, setCommand] = useState("");
  const [eventResult, setEventResult] = useState<any>(null);
  
  // Connector form
  const [webAppUrl, setWebAppUrl] = useState("");
  const [sharedToken, setSharedToken] = useState("");
  
  // Colleague form
  const [showColleagueForm, setShowColleagueForm] = useState(false);
  const [newColleague, setNewColleague] = useState({ alias: "", email: "", icsUrl: "" });

  // Load existing credentials and colleagues
  useEffect(() => {
    loadCredentials();
  }, [userId]);

  const loadCredentials = async () => {
    try {
      const response = await apiRequest("GET", `/calendar-cred/state?userId=${userId}`);
      const data = await response.json();
      
      if (data.connector) {
        setConnector(data.connector);
        setWebAppUrl(data.connector.web_app_url || "");
        setSharedToken(data.connector.shared_token || "");
      }
      
      setColleagues(data.colleagues || []);
    } catch (error) {
      console.error("Failed to load credentials:", error);
    }
  };

  const handleSaveConnector = async () => {
    if (!webAppUrl.trim() || !sharedToken.trim()) {
      toast({
        title: "Validation Error",
        description: "Please provide both Web App URL and Shared Token",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      await apiRequest("POST", "/calendar-cred/user", {
        userId,
        webAppUrl: webAppUrl.trim(),
        sharedToken: sharedToken.trim(),
      });

      toast({
        title: "Credentials Saved",
        description: "Your calendar is now connected!",
      });
      
      await loadCredentials();
    } catch (error: any) {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddColleague = async () => {
    if (!newColleague.alias.trim() || (!newColleague.email.trim() && !newColleague.icsUrl.trim())) {
      toast({
        title: "Validation Error",
        description: "Please provide an alias and either an email or ICS URL",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      await apiRequest("POST", "/calendar-cred/colleague", {
        alias: newColleague.alias.trim(),
        email: newColleague.email.trim() || undefined,
        icsUrl: newColleague.icsUrl.trim() || undefined,
      });

      toast({
        title: "Colleague Added",
        description: `You can now use "${newColleague.alias}" in commands`,
      });

      setNewColleague({ alias: "", email: "", icsUrl: "" });
      setShowColleagueForm(false);
      await loadCredentials();
    } catch (error: any) {
      toast({
        title: "Failed to Add Colleague",
        description: error.message || "Could not save colleague",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteColleague = async (alias: string) => {
    setIsLoading(true);
    try {
      await apiRequest("DELETE", `/calendar-cred/colleague/${alias}`);
      toast({
        title: "Colleague Removed",
        description: `"${alias}" has been removed`,
      });
      await loadCredentials();
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error.message || "Could not delete colleague",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommand = async () => {
    if (!command.trim()) return;

    if (!connector) {
      toast({
        title: "Not Connected",
        description: "Please save your calendar credentials first",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setEventResult(null);
    
    try {
      const response = await apiRequest("POST", "/calendar-book/command", {
        userId,
        text: command,
        tz: "America/Vancouver",
        workHours: { start: "09:00", end: "18:00" },
      });

      const data = await response.json();

      if (data.eventId || data.htmlLink) {
        setEventResult(data);
        toast({
          title: "Event Scheduled",
          description: `Successfully created calendar event`,
        });
        setCommand("");
      } else if (data.intent === "find_free") {
        toast({
          title: "Free Slots Found",
          description: `Found ${data.windows?.length || 0} available time slots`,
        });
      } else {
        toast({
          title: "Command Processed",
          description: data.message || "Check your calendar for updates",
        });
      }
    } catch (error: any) {
      toast({
        title: "Command Failed",
        description: error.message || "Could not process command",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const hasConnector = !!connector;

  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-50 dark:bg-slate-900">
      <div className="max-w-2xl mx-auto space-y-4">
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 dark:text-white">
              <Calendar className="w-5 h-5" />
              Calendar Credentials
            </CardTitle>
            <CardDescription className="dark:text-slate-400">
              Configure your Google Apps Script calendar connector
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="web-app-url" className="dark:text-white">
                  Web App URL
                </Label>
                <Input
                  id="web-app-url"
                  type="url"
                  value={webAppUrl}
                  onChange={(e) => setWebAppUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/..."
                  className="dark:bg-slate-700 dark:text-white dark:border-slate-600"
                  data-testid="input-web-app-url"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="shared-token" className="dark:text-white">
                  Shared Token
                </Label>
                <Input
                  id="shared-token"
                  type="password"
                  value={sharedToken}
                  onChange={(e) => setSharedToken(e.target.value)}
                  placeholder="Your shared secret token"
                  className="dark:bg-slate-700 dark:text-white dark:border-slate-600"
                  data-testid="input-shared-token"
                />
              </div>

              <Button
                onClick={handleSaveConnector}
                disabled={isLoading}
                className="w-full"
                data-testid="button-save-connector"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {hasConnector ? "Update Connector" : "Save Connector"}
                  </>
                )}
              </Button>

              {hasConnector && (
                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm text-green-900 dark:text-green-100">Calendar connected</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Colleagues Section */}
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="dark:text-white">Colleagues</CardTitle>
                <CardDescription className="dark:text-slate-400">
                  Add people to reference in your commands (up to 10)
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowColleagueForm(!showColleagueForm)}
                disabled={colleagues.length >= 10}
                data-testid="button-toggle-colleague-form"
                className="dark:border-slate-600 dark:text-white"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {showColleagueForm && (
              <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-900 rounded border dark:border-slate-600">
                <Input
                  placeholder='Alias (e.g., "boss")'
                  value={newColleague.alias}
                  onChange={(e) => setNewColleague({ ...newColleague, alias: e.target.value })}
                  className="dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                  data-testid="input-colleague-alias"
                />
                <Input
                  placeholder="Email (optional)"
                  type="email"
                  value={newColleague.email}
                  onChange={(e) => setNewColleague({ ...newColleague, email: e.target.value })}
                  className="dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                  data-testid="input-colleague-email"
                />
                <Input
                  placeholder="ICS URL (optional)"
                  type="url"
                  value={newColleague.icsUrl}
                  onChange={(e) => setNewColleague({ ...newColleague, icsUrl: e.target.value })}
                  className="dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                  data-testid="input-colleague-ics"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAddColleague}
                    disabled={isLoading}
                    className="flex-1"
                    data-testid="button-save-colleague"
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowColleagueForm(false);
                      setNewColleague({ alias: "", email: "", icsUrl: "" });
                    }}
                    className="dark:border-slate-600 dark:text-white"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            
            {colleagues.length > 0 ? (
              <div className="space-y-2">
                {colleagues.map((colleague, idx) => (
                  <div
                    key={colleague.alias}
                    className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded border dark:border-slate-600"
                    data-testid={`colleague-item-${idx}`}
                  >
                    <div className="flex-1">
                      <div className="font-medium dark:text-white">"{colleague.alias}"</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {colleague.email || colleague.ics_url || "No contact info"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteColleague(colleague.alias)}
                      disabled={isLoading}
                      className="dark:text-slate-400 dark:hover:text-white"
                      data-testid={`button-delete-colleague-${idx}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground dark:text-slate-400 text-center py-4">
                No colleagues added yet. Add someone to use in natural language commands.
              </p>
            )}
            
            {colleagues.length >= 10 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Maximum of 10 colleagues reached
              </p>
            )}
          </CardContent>
        </Card>

        {/* Quick Command Section */}
        {hasConnector && (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="dark:text-white">Quick Command</CardTitle>
              <CardDescription className="dark:text-slate-400">
                Use natural language to schedule meetings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !isLoading && handleCommand()}
                  placeholder='e.g., "create a meeting with boss today at 2pm for 30 min"'
                  className="flex-1 dark:bg-slate-700 dark:text-white dark:border-slate-600"
                  disabled={isLoading}
                  data-testid="input-quick-command"
                />
                <Button
                  onClick={handleCommand}
                  disabled={isLoading || !command.trim()}
                  data-testid="button-run-command"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
              
              <p className="text-xs text-muted-foreground dark:text-slate-400">
                Examples: "schedule team meeting tomorrow at 3pm for 60 min" • "find free 30 min slot with boss"
              </p>

              {eventResult && (
                <Card className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex items-center gap-2 text-green-900 dark:text-green-100">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="font-medium">Event Created</span>
                    </div>
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
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
