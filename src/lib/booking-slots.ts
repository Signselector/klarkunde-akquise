/** Slots of the booking calendar: 30 minutes each, at most 2 appointments at the same time. */
export const APPOINTMENT_SLOT_MINUTES = 30;
export const CALLBACK_SLOT_MINUTES = 15;
/** Appointment length; kept under its old name for the appointment pages. */
export const SLOT_MINUTES = APPOINTMENT_SLOT_MINUTES;
export const APPOINTMENT_CAPACITY = 2;
/** Appointments can be booked at the earliest this many days ahead (callbacks have no such limit). */
export const MIN_APPOINTMENT_LEAD_DAYS = 3;
export const FIRST_SLOT_HOUR = 8;
export const LAST_SLOT_HOUR = 18; // the last slot starts at 18:30 and ends at 19:00

export type Availability = { slot: string; used: number; capacity: number };
export type SlotKind = "appointment" | "callback";

export const slotDurationMinutes = (kind: SlotKind) =>
  kind === "callback" ? CALLBACK_SLOT_MINUTES : APPOINTMENT_SLOT_MINUTES;

/** All slot start times of one day (local time): every 15 minutes for callbacks, every 30 for appointments. */
export function daySlots(day: Date, kind: SlotKind = "appointment"): Date[] {
  const minutes = kind === "callback" ? [0, 15, 30, 45] : [0, 30];
  const out: Date[] = [];
  for (let h = FIRST_SLOT_HOUR; h <= LAST_SLOT_HOUR; h++)
    for (const m of minutes)
      out.push(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m));
  return out;
}

export type SlotState = "free" | "partial" | "full" | "past";

/** `used` comes from the server per slot start; a slot missing from the list is completely free. */
export function slotState(
  start: Date,
  used: Map<number, Availability>,
  now = Date.now(),
): { state: SlotState; used: number; capacity: number } {
  const a = used.get(start.getTime());
  const capacity = a?.capacity ?? APPOINTMENT_CAPACITY;
  const n = a?.used ?? 0;
  if (start.getTime() <= now) return { state: "past", used: n, capacity };
  if (n >= capacity) return { state: "full", used: n, capacity };
  return { state: n > 0 ? "partial" : "free", used: n, capacity };
}

export const toAvailabilityMap = (rows: Availability[] | undefined) =>
  new Map((rows ?? []).map((r) => [new Date(r.slot).getTime(), r]));

const pad = (n: number) => String(n).padStart(2, "0");
export const dateValue = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
