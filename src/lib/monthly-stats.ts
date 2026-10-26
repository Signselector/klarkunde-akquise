/** Monthly numbers of one caller, built from the recorded status changes. Months follow Vienna time. */
export type StatusEvent = { new_status: string; created_at: string };
export type YearMonth = { year: number; month: number }; // month 1-12

/** Status changes that are a result of a call. Reopening a lead (`open`) is not one. */
export const OUTCOME_LABEL: Record<string, string> = {
  low_q: "Logo Render",
  high_q: "Realismus Render",
  waiting_3d: "Logo ausstehend",
  on_hold: "Zukunftsprojekt",
  reference_mail: "Referenzmail",
  callback: "Rückruf vereinbart",
  no_interest: "Kein Interesse",
  not_reached: "Nicht erreicht",
  appointment: "Termin",
  production: "Deal in Produktion",
};
/** Results that put a deal into Pipedrive. */
export const DEAL_OUTCOMES = ["low_q", "high_q", "waiting_3d", "on_hold"];

const viennaDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` of an instant in Vienna. */
export const viennaDate = (iso: string) => viennaDay.format(new Date(iso));

export const monthLabel = ({ year, month }: YearMonth) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 15)),
  );
export const monthValue = ({ year, month }: YearMonth) =>
  `${year}-${String(month).padStart(2, "0")}`;
export const parseMonth = (value: string): YearMonth => {
  const [y, m] = value.split("-").map(Number);
  return { year: y as number, month: m as number };
};
export const shiftMonth = ({ year, month }: YearMonth, by: number): YearMonth => {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};
export const currentMonth = (now = new Date()): YearMonth => {
  const [y, m] = viennaDay.format(now).split("-").map(Number);
  return { year: y as number, month: m as number };
};
/** The last `count` months, newest first. */
export const monthOptions = (now = new Date(), count = 24) =>
  Array.from({ length: count }, (_, i) => shiftMonth(currentMonth(now), -i));
export const daysInMonth = ({ year, month }: YearMonth) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A query window that safely contains the whole Vienna month (one day of slack on each side). */
export function monthWindow(ym: YearMonth) {
  const from = new Date(Date.UTC(ym.year, ym.month - 1, 1) - 86_400_000);
  const to = new Date(Date.UTC(ym.year, ym.month, 1) + 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function summarize(events: StatusEvent[], ym: YearMonth) {
  const prefix = monthValue(ym);
  const inMonth = events.filter(
    (e) => e.new_status in OUTCOME_LABEL && viennaDate(e.created_at).startsWith(prefix),
  );
  const count = (status: string) => inMonth.filter((e) => e.new_status === status).length;
  const calls = inMonth.length;
  const reached = calls - count("not_reached");
  const perDay = Array.from({ length: daysInMonth(ym) }, (_, i) => {
    const day = `${prefix}-${String(i + 1).padStart(2, "0")}`;
    return { day: i + 1, value: inMonth.filter((e) => viennaDate(e.created_at) === day).length };
  });
  return {
    calls,
    reached,
    reachRate: calls ? Math.round((reached / calls) * 100) : null,
    deals: DEAL_OUTCOMES.reduce((sum, s) => sum + count(s), 0),
    byOutcome: Object.entries(OUTCOME_LABEL).map(([status, label]) => ({
      status,
      label,
      value: count(status),
    })),
    perDay,
    activeDays: perDay.filter((d) => d.value > 0).length,
  };
}
