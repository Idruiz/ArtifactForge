import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface CalendarQuickActionsProps {
  onInsertTemplate: (text: string) => void;
}

const dt = "<date: tomorrow | 2025-10-08 | next Tuesday>";
const tm = "<time: 3:00 pm | 15:00>";
const dur = "<duration: 30m | 45m | 1h>";
const who = "<attendee(s): email(s) or Name(s)>";
const cal = "<target calendar id/email>";
const eid = "<event link | id>";
const hrsS = "<start HH:mm>";
const hrsE = "<end HH:mm>";

export function CalendarQuickActions({ onInsertTemplate }: CalendarQuickActionsProps) {
  const actions = [
    {
      group: "Core Booking",
      items: [
        {
          id: "book-direct",
          label: "Book at specific time",
          template: `book a meeting titled "${'<title>'}" on ${dt} at ${tm} for ${dur} with ${who} google meet`,
        },
        {
          id: "book-firstfree",
          label: "Book first free slot",
          template: `find a free ${dur} slot on ${dt} within work hours and book it with ${who} google meet`,
        },
        {
          id: "book-colleague",
          label: "Book on colleague's calendar",
          template: `on ${cal} schedule "${'<title>'}" on ${dt} at ${tm} for ${dur} and invite ${who} google meet`,
        },
        {
          id: "book-recurring",
          label: "Book recurring series",
          template: `create a weekly recurring meeting titled "${'<title>'}" starting ${dt} at ${tm} for ${dur} with ${who} for <count: 6> occurrences google meet`,
        },
      ],
    },
    {
      group: "Free/Busy Discovery",
      items: [
        {
          id: "freebusy-mine",
          label: "Find my free slots",
          template: `show up to 5 free windows on ${dt} for ${dur} (use my work hours)`,
        },
        {
          id: "freebusy-colleague",
          label: "Find colleague's free slots",
          template: `using ${cal} show up to 5 free windows on ${dt} for ${dur}`,
        },
        {
          id: "freebusy-mutual",
          label: "Find mutual free slot",
          template: `find the first mutual free ${dur} slot on ${dt} between my calendar and ${cal} and book it with ${who}`,
        },
      ],
    },
    {
      group: "Event Operations",
      items: [
        {
          id: "event-addmeet",
          label: "Add Google Meet",
          template: `add a google meet link to event "${eid}"`,
        },
        {
          id: "event-update",
          label: "Update event details",
          template: `update event "${eid}" set title "${'<new title>'}", description "${'<notes>'}", location "${'<location>'}"`
        },
        {
          id: "event-addattendee",
          label: "Add attendee(s)",
          template: `add attendee(s) ${who} to event "${eid}" (send updates)`,
        },
        {
          id: "event-reschedule",
          label: "Reschedule event",
          template: `reschedule event "${eid}" to ${dt} at ${tm}`,
        },
        {
          id: "event-cancel",
          label: "Cancel event",
          template: `cancel event "${eid}" and notify attendees`,
        },
      ],
    },
    {
      group: "Agenda & Settings",
      items: [
        {
          id: "agenda-today",
          label: "Today's agenda",
          template: `list my agenda for today with links`,
        },
        {
          id: "prefs-hours",
          label: "Set work hours",
          template: `set my work hours to start ${hrsS} end ${hrsE} (weekdays)`,
        },
        {
          id: "creds-save",
          label: "Save connector",
          template: `save calendar connector { webAppUrl: "${"<apps script exec url>"}", token: "${"<shared token>"}" }`,
        },
        {
          id: "alias-add",
          label: "Add colleague alias",
          template: `add calendar alias "${'<name or handle>'}" -> "${"<email or calendar id>"}"`
        },
      ],
    },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start text-blue-600 border-blue-200 hover:bg-blue-50"
          data-testid="button-quick-calendar"
        >
          <Calendar className="w-4 h-4 mr-2" />
          Calendar Agent
          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5">
            Beta
          </Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-h-[500px] overflow-y-auto">
        {actions.map((group, groupIdx) => (
          <div key={group.group}>
            <DropdownMenuLabel className="text-xs font-semibold text-slate-500">
              {group.group}
            </DropdownMenuLabel>
            {group.items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onClick={() => onInsertTemplate(item.template)}
                className="text-sm cursor-pointer"
                data-testid={`calendar-action-${item.id}`}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
            {groupIdx < actions.length - 1 && <DropdownMenuSeparator />}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
