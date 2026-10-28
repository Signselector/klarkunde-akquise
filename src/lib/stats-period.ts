/** Periods of the statistics cockpit. Days, weeks and months are counted in Vienna time. */
export type PeriodMode = "month" | "week" | "day";
/** A calendar day as `YYYY-MM-DD` (no time zone involved). */
export type DayKey = string;

const TZ = "Europe/Vienna";
const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date): DayKey => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromKey = (k: DayKey) => {
  const [y, m, d] = k.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

export const addDaysKey = (k: DayKey, n: number): DayKey => {
  const d = fromKey(k);
  d.setUTCDate(d.getUTCDate() + n);
  return toKey(d);
};
export const addMonthsKey = (k: DayKey, n: number): DayKey => {
  const d = fromKey(k);
  return toKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
export const monthStartKey = (k: DayKey): DayKey => `${k.slice(0, 7)}-01`;
/** Monday of the week the day is in. */
export const weekStartKey = (k: DayKey): DayKey => addDaysKey(k, -((fromKey(k).getUTCDay() + 6) % 7));

/** Today in Vienna. */
export const todayKey = (now: Date = new Date()): DayKey =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** The instant at which the given day starts in Vienna (00:00 local time, summer and winter time respected). */
export function viennaStart(k: DayKey): Date {
  const [y, m, d] = k.split("-").map(Number) as [number, number, number];
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "2-digit", month: "2-digit", year: "numeric",
  });
  for (const offsetHours of [1, 2, 0, 3]) {
    const t = new Date(Date.UTC(y, m - 1, d, -offsetHours));
    const f = parts.format(t); // dd/mm/yyyy, hh:mm
    if (f === `${pad(d)}/${pad(m)}/${y}, 00:00`) return t;
  }
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoWeekOf(k: DayKey) {
  const t = fromKey(k);
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - first.getTime()) / 86_400_000 + 1) / 7);
}

const fmt = (k: DayKey, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", ...o }).format(fromKey(k));

export type Period = {
  mode: PeriodMode;
  /** First day of the period. */
  start: DayKey;
  /** Day after the last one. */
  end: DayKey;
  from: string;
  to: string;
  bucket: "day" | "hour";
  label: string;
};

/** The period around an anchor day. */
export function periodOf(mode: PeriodMode, anchor: DayKey): Period {
  const start = mode === "month" ? monthStartKey(anchor) : mode === "week" ? weekStartKey(anchor) : anchor;
  const end = mode === "month" ? addMonthsKey(start, 1) : mode === "week" ? addDaysKey(start, 7) : addDaysKey(start, 1);
  const label =
    mode === "month"
      ? fmt(start, { month: "long", year: "numeric" })
      : mode === "week"
        ? `KW ${isoWeekOf(start)} · ${fmt(start, { day: "2-digit", month: "short" })} – ${fmt(addDaysKey(end, -1), { day: "2-digit", month: "short", year: "numeric" })}`
        : fmt(start, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return {
    mode, start, end, label,
    from: viennaStart(start).toISOString(),
    to: viennaStart(end).toISOString(),
    bucket: mode === "day" ? "hour" : "day",
  };
}

/** Moves the anchor by whole periods. */
export function shiftAnchor(mode: PeriodMode, anchor: DayKey, n: number): DayKey {
  return mode === "month" ? addMonthsKey(monthStartKey(anchor), n) : addDaysKey(anchor, n * (mode === "week" ? 7 : 1));
}

/** The last `count` months up to and including the one of `anchor`'s year-month, newest first. */
export function monthOptions(today: DayKey, count = 24) {
  return Array.from({ length: count }, (_, i) => {
    const key = addMonthsKey(monthStartKey(today), -i);
    return { key, label: fmt(key, { month: "long", year: "numeric" }) };
  });
}
