/** Formatting and small calculations for the dashboard. All numbers themselves come from the server. */
const per100 = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const plain = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/** `18,85` – no percent sign, the unit is "Leads / 100". */
export const formatPer100 = (value: number) => per100.format(value);
export const formatNumber = (value: number) => plain.format(value);

/** Change against the previous month, only when both months have a value. */
export function per100Delta(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  const diff = Math.round((current - previous) * 100) / 100;
  return `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${per100.format(Math.abs(diff))}`;
}

/** First day of a month as `YYYY-MM-01`, the format the database functions expect. */
export const monthStart = ({ year, month }: { year: number; month: number }) =>
  `${year}-${String(month).padStart(2, "0")}-01`;

/** Monday of the week containing `date`, shifted by whole weeks, as `YYYY-MM-DD`. */
export function weekStart(date: Date, shiftWeeks = 0) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + shiftWeeks * 7);
  return d.toISOString().slice(0, 10);
}

/** `14.–20.9.` for a week starting on the given Monday. */
export function weekLabel(start: string) {
  const from = new Date(`${start}T12:00:00Z`);
  const to = new Date(from.getTime() + 6 * 86_400_000);
  const f = (d: Date) => `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
  return `${f(from)}–${f(to)}`;
}
