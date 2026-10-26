import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export type CalendarMarker = { id: string; dot: string };

/** Month grid with day markers, as used on the appointment calendar. */
export function MonthCalendar({
  markersOf,
  selected,
  onSelect,
  loading = false,
  footer,
  ariaLabel = "Monatsansicht",
}: {
  markersOf: (day: Date) => CalendarMarker[];
  selected: Date | null;
  onSelect: (day: Date | null) => void;
  loading?: boolean;
  footer?: ReactNode;
  ariaLabel?: string;
}) {
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const y = month.getFullYear();
  const m = month.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: days }, (_, i) => new Date(y, m, i + 1)),
  ];
  const today = new Date();

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5" aria-label={ariaLabel}>
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Vorheriger Monat"
          onClick={() => setMonth(new Date(y, m - 1, 1))}
        >
          <ChevronLeft />
        </Button>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold capitalize">
            {new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(month)}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              onSelect(today);
            }}
          >
            Heute
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Nächster Monat"
          onClick={() => setMonth(new Date(y, m + 1, 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase text-muted-foreground">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className={cn("mt-1 grid grid-cols-7 gap-1", loading && "animate-pulse opacity-60")}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const items = markersOf(day);
          const isToday = sameDay(day, today);
          const isSel = selected != null && sameDay(day, selected);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect(isSel ? null : day)}
              className={cn(
                "flex min-h-12 flex-col items-center gap-1 rounded-md border border-transparent p-1.5 text-sm transition-colors hover:border-primary/40 sm:min-h-16",
                isSel && "border-primary bg-accent/40",
                isToday && !isSel && "border-border bg-secondary",
              )}
            >
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full",
                  isToday && "bg-primary font-bold text-primary-foreground",
                )}
              >
                {day.getDate()}
              </span>
              {items.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {items.slice(0, 3).map((e) => (
                    <span key={e.id} className={cn("size-1.5 rounded-full", e.dot)} />
                  ))}
                  {items.length > 3 && (
                    <span className="text-[9px] text-muted-foreground">+{items.length - 3}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {footer && <div className="mt-4 border-t pt-4">{footer}</div>}
    </section>
  );
}
