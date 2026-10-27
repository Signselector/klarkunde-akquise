import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { CalendarPlus } from "lucide-react";
import { ChevronLeft, ChevronRight } from "@/components/coldcaller/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Monday 00:00 of the week the date is in. */
export const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

/** ISO calendar week number (weeks start on Monday, week 1 contains the first Thursday). */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - first.getTime()) / 86_400_000 + 1) / 7);
}

export const inWeek = (d: Date, weekStart: Date) => d >= weekStart && d < addDays(weekStart, 7);

const short = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" });
const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const longDay = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function weekTitle(weekStart: Date) {
  const end = addDays(weekStart, 6);
  const a =
    weekStart.getFullYear() === end.getFullYear()
      ? short.format(weekStart)
      : full.format(weekStart);
  return `KW ${isoWeek(weekStart)} · ${a.replace(/\.$/, "")} – ${full.format(end)}`;
}

export type WeekEntry = {
  id: string;
  at: Date;
  title: string;
  /** Tailwind classes of the status dot. */
  dot: string;
};

/**
 * Week view (Monday to Sunday) with week navigation, shared by the callback and the appointment calendar.
 * Desktop: seven day columns with the entries of the day. Mobile: day tabs and the entries of the selected day.
 * Keyboard: ← → move the selected day (across weeks), Page Up / Page Down switch the week.
 */
export function WeekCalendar({
  entries,
  weekStart,
  onWeekChange,
  selected,
  onSelect,
  loading = false,
  footer,
  ariaLabel = "Wochenansicht",
  onAddForDay,
  addLabel = "Termin anlegen",
}: {
  entries: WeekEntry[];
  weekStart: Date;
  onWeekChange: (monday: Date) => void;
  selected: Date | null;
  onSelect: (day: Date | null) => void;
  loading?: boolean;
  footer?: ReactNode;
  ariaLabel?: string;
  /** Shows a "+" per day that opens the booking form for that day. */
  onAddForDay?: (day: Date) => void;
  addLabel?: string;
}) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const entriesOf = (d: Date) =>
    entries.filter((e) => sameDay(e.at, d)).sort((a, b) => a.at.getTime() - b.at.getTime());
  const thisWeek = sameDay(weekStart, startOfWeek(today));
  const focusDay = useRef<number | null>(null);

  // After a keyboard move across weeks the new day button gets the focus again.
  useEffect(() => {
    if (focusDay.current === null) return;
    const el = document.querySelector<HTMLElement>(`[data-week-day="${focusDay.current}"]`);
    focusDay.current = null;
    el?.focus();
  }, [weekStart, selected]);

  function move(day: Date, delta: number) {
    const next = addDays(day, delta);
    focusDay.current = (next.getDay() + 6) % 7;
    onSelect(next);
    if (!inWeek(next, weekStart)) onWeekChange(startOfWeek(next));
  }
  function onKey(e: KeyboardEvent<HTMLElement>) {
    const base = selected ?? (thisWeek ? today : weekStart);
    if (e.key === "ArrowRight") move(base, 1);
    else if (e.key === "ArrowLeft") move(base, -1);
    else if (e.key === "PageDown") onWeekChange(addDays(weekStart, 7));
    else if (e.key === "PageUp") onWeekChange(addDays(weekStart, -7));
    else return;
    e.preventDefault();
  }

  const activeDay = selected && inWeek(selected, weekStart) ? selected : null;
  const mobileDay = activeDay ?? (thisWeek ? today : weekStart);

  return (
    <section
      className="rounded-lg border bg-card p-4 sm:p-5"
      aria-label={ariaLabel}
      onKeyDown={onKey}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Vorherige Woche"
            onClick={() => onWeekChange(addDays(weekStart, -7))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Nächste Woche"
            onClick={() => onWeekChange(addDays(weekStart, 7))}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={thisWeek && !!selected && sameDay(selected, today)}
            onClick={() => {
              onWeekChange(startOfWeek(today));
              onSelect(today);
            }}
          >
            Heute
          </Button>
        </div>
        <h2 className="text-sm font-semibold sm:text-base" aria-live="polite">
          {weekTitle(weekStart)}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={thisWeek}
          onClick={() => onWeekChange(startOfWeek(today))}
          className="hidden sm:inline-flex"
        >
          Diese Woche
        </Button>
      </div>

      {/* Mobile: day tabs, entries of the chosen day below */}
      <div className="mt-4 md:hidden">
        <div role="tablist" aria-label="Tage der Woche" className="grid grid-cols-7 gap-1">
          {days.map((d, i) => {
            const n = entriesOf(d).length;
            const isSel = sameDay(d, mobileDay);
            return (
              <button
                key={d.toISOString()}
                type="button"
                role="tab"
                aria-selected={isSel}
                data-week-day={i}
                onClick={() => onSelect(d)}
                className={cn(
                  "flex flex-col items-center rounded-md border border-transparent py-1.5 text-xs",
                  isSel && "border-primary bg-accent/40",
                  sameDay(d, today) && !isSel && "border-border bg-secondary",
                )}
              >
                <span className="uppercase text-muted-foreground">
                  {weekday.format(d).replace(".", "")}
                </span>
                <span className="text-sm font-semibold">{d.getDate()}</span>
                <span className="mt-0.5 h-1.5">
                  {n > 0 && (
                    <span
                      className="block size-1.5 rounded-full bg-emerald-500"
                      aria-hidden="true"
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 space-y-1.5">
          <p className="text-sm font-medium">{longDay.format(mobileDay)}</p>
          {entriesOf(mobileDay).length === 0 && (
            <p className="text-sm text-muted-foreground">Keine Einträge.</p>
          )}
          {entriesOf(mobileDay).map((e) => (
            <EntryLine key={e.id} entry={e} />
          ))}
          {onAddForDay && (
            <Button variant="outline" size="sm" onClick={() => onAddForDay(mobileDay)}>
              <CalendarPlus /> {addLabel}
            </Button>
          )}
        </div>
      </div>

      {/* Desktop: seven columns */}
      <div
        className={cn(
          "mt-4 hidden gap-2 md:grid md:grid-cols-7",
          loading && "animate-pulse opacity-60",
        )}
      >
        {days.map((d, i) => {
          const list = entriesOf(d);
          const isToday = sameDay(d, today);
          const isSel = !!activeDay && sameDay(d, activeDay);
          const open = list.filter((e) => e.at >= today).length;
          return (
            <div
              key={d.toISOString()}
              role="group"
              aria-label={longDay.format(d)}
              className={cn(
                "flex min-h-40 min-w-0 flex-col rounded-md border p-1.5",
                isSel
                  ? "border-primary bg-accent/30"
                  : isToday
                    ? "border-border bg-secondary"
                    : "border-transparent bg-muted/30",
              )}
            >
              <button
                type="button"
                data-week-day={i}
                aria-pressed={isSel}
                onClick={() => onSelect(isSel ? null : d)}
                className="flex w-full flex-col items-start rounded px-1 py-1 text-left hover:bg-background/60 focus-visible:outline-2"
              >
                <span className="flex w-full items-center justify-between gap-1">
                  <span
                    className={cn(
                      "text-xs font-semibold uppercase",
                      isToday ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {weekday.format(d).replace(".", "")} {d.getDate()}.
                  </span>
                  {isToday && (
                    <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      Heute
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {list.length === 0 ? "Frei" : `${open} anstehend`}
                </span>
              </button>
              <div className="mt-1 flex flex-1 flex-col gap-1">
                {list.map((e) => (
                  <EntryLine key={e.id} entry={e} compact />
                ))}
              </div>
              {onAddForDay && (
                <button
                  type="button"
                  aria-label={`${addLabel} am ${longDay.format(d)}`}
                  title={addLabel}
                  onClick={() => onAddForDay(d)}
                  className="mt-1 grid h-7 place-items-center rounded border border-dashed text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-2"
                >
                  <CalendarPlus size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {footer && <div className="mt-4 border-t pt-4">{footer}</div>}
    </section>
  );
}

function EntryLine({ entry, compact = false }: { entry: WeekEntry; compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-1.5 rounded bg-background/70 px-1.5 py-1",
        compact ? "text-[11px] leading-4" : "text-sm",
      )}
      title={`${time.format(entry.at)} · ${entry.title}`}
    >
      <span className={cn("mt-1 size-2 shrink-0 rounded-full", entry.dot)} aria-hidden="true" />
      <span className="min-w-0">
        <span className="font-semibold tabular-nums">{time.format(entry.at)}</span>{" "}
        <span className="break-words">{entry.title}</span>
      </span>
    </div>
  );
}
