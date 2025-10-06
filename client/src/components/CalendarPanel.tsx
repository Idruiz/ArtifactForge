import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, Users, Link as LinkIcon, CheckCircle2, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CalendarPanelProps {
  userId: string;
}

interface FreeSlot {
  start: string;
  end: string;
}

export function CalendarPanel({ userId }: CalendarPanelProps) {
  const { toast } = useToast();
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  
  const [date, setDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [preferredStart, setPreferredStart] = useState("09:00");
  const [duration, setDuration] = useState(30);
  const [attendeeEmail, setAttendeeEmail] = useState("");
  const [coworkerICS, setCoworkerICS] = useState("");
  const [title, setTitle] = useState("");
  const [eventResult, setEventResult] = useState<any>(null);

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

  const handleFindFreeSlots = async () => {
    setIsLoading(true);
    setFreeSlots([]);
    try {
      const response = await apiRequest("POST", "/calendar-proxy/free", {
        userId,
        date,
        durationMins: duration,
        tz: "America/Los_Angeles",
        workHours: { start: "09:00", end: "18:00" },
        coworkerICS: coworkerICS || undefined,
      });

      const data = await response.json();
      setFreeSlots(data.free || []);
      
      toast({
        title: "Free Slots Found",
        description: `Found ${data.free?.length || 0} available time slots`,
      });
    } catch (error: any) {
      toast({
        title: "Search Failed",
        description: error.message || "Failed to find free slots",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSchedule = async () => {
    if (!title.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter an event title",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setEventResult(null);
    try {
      const response = await apiRequest("POST", "/calendar-proxy/schedule", {
        userId,
        title,
        description: "Scheduled via Calendar Agent",
        date,
        preferredStart,
        durationMins: duration,
        tz: "America/Los_Angeles",
        workHours: { start: "09:00", end: "18:00" },
        attendeeEmail: attendeeEmail || undefined,
        coworkerICS: coworkerICS || undefined,
      });

      const data = await response.json();
      setEventResult(data);
      
      toast({
        title: "Event Scheduled",
        description: `Event "${title}" created successfully!`,
      });
    } catch (error: any) {
      toast({
        title: "Scheduling Failed",
        description: error.message || "Failed to schedule event",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-50">
      <div className="max-w-2xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Calendar Agent
            </CardTitle>
            <CardDescription>
              Schedule meetings using your Google Calendar via Apps Script
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isRegistered ? (
              <div className="space-y-3">
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-900">
                    Connect your Google Calendar to start scheduling meetings automatically.
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
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-green-900">Calendar connected</span>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label htmlFor="event-title">Event Title</Label>
                    <Input
                      id="event-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Team meeting"
                      data-testid="input-event-title"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="event-date">Date</Label>
                      <Input
                        id="event-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        data-testid="input-event-date"
                      />
                    </div>
                    <div>
                      <Label htmlFor="preferred-time">Preferred Time</Label>
                      <Input
                        id="preferred-time"
                        type="time"
                        value={preferredStart}
                        onChange={(e) => setPreferredStart(e.target.value)}
                        data-testid="input-preferred-time"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="duration">Duration (minutes)</Label>
                    <Input
                      id="duration"
                      type="number"
                      value={duration}
                      onChange={(e) => setDuration(parseInt(e.target.value) || 30)}
                      min={15}
                      step={15}
                      data-testid="input-duration"
                    />
                  </div>

                  <div>
                    <Label htmlFor="attendee-email">Attendee Email (optional)</Label>
                    <Input
                      id="attendee-email"
                      type="email"
                      value={attendeeEmail}
                      onChange={(e) => setAttendeeEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      data-testid="input-attendee-email"
                    />
                  </div>

                  <div>
                    <Label htmlFor="coworker-ics">Coworker ICS URL (optional)</Label>
                    <Input
                      id="coworker-ics"
                      type="url"
                      value={coworkerICS}
                      onChange={(e) => setCoworkerICS(e.target.value)}
                      placeholder="https://..."
                      data-testid="input-coworker-ics"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleFindFreeSlots}
                    disabled={isLoading}
                    variant="outline"
                    className="flex-1"
                    data-testid="button-find-free"
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Find Free Slots
                  </Button>
                  <Button
                    onClick={handleSchedule}
                    disabled={isLoading || !title.trim()}
                    className="flex-1"
                    data-testid="button-schedule"
                  >
                    <Calendar className="w-4 h-4 mr-2" />
                    Schedule
                  </Button>
                </div>

                {freeSlots.length > 0 && (
                  <Card className="bg-white">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Available Slots</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {freeSlots.slice(0, 3).map((slot, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 bg-slate-50 rounded border"
                        >
                          <span className="text-sm">
                            {slot.start.split('T')[1]} - {slot.end.split('T')[1]}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPreferredStart(slot.start.split('T')[1])}
                            data-testid={`button-select-slot-${idx}`}
                          >
                            Select
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {eventResult && (
                  <Card className="bg-green-50 border-green-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2 text-green-900">
                        <CheckCircle2 className="w-4 h-4" />
                        Event Created
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm">
                        <strong>Title:</strong> {eventResult.title}
                      </p>
                      <p className="text-sm">
                        <strong>Time:</strong> {eventResult.start} - {eventResult.end}
                      </p>
                      {eventResult.htmlLink && (
                        <a
                          href={eventResult.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
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
