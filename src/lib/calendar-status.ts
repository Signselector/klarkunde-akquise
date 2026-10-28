/** Status dot of a calendar entry: light green while it is coming up, red when open and overdue, grey when done. */
export type CalendarStatus = "upcoming" | "overdue" | "done";

export function calendarStatus(
  at: string | Date,
  done: boolean,
  now: Date = new Date(),
): CalendarStatus {
  if (done) return "done";
  return new Date(at) < now ? "overdue" : "upcoming";
}

export const STATUS_DOT: Record<CalendarStatus, string> = {
  upcoming: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]",
  overdue: "bg-rose-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
  done: "bg-muted-foreground/40",
};

/**
 * Dot of an appointment by origin and time, independent of the type: green while a tool appointment is coming up,
 * yellow for one that comes from Pipedrive, grey once it has started.
 */
export function appointmentDotClass(
  startsAt: string | Date,
  isExternal: boolean = false,
  now: Date = new Date(),
): string {
  if (new Date(startsAt) < now) return "bg-muted-foreground/40";
  if (isExternal) return "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]";
  return "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]";
}
