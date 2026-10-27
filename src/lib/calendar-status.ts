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
