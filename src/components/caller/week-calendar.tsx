import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarPlus,
  CheckCircle2,
  Circle,
  Clock,
  Flag,
  Mail,
  Phone,
  StickyNote,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { ChevronLeft, ChevronRight } from "@/components/coldcaller/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Sunday 00:00 of the week the date is in (like Pipedrive: Sunday–Saturday). */
export const startOfWeek = (d: Date) => addDays(d, -d.getDay());

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
const monthShort = new Intl.DateTimeFormat("de-DE", { month: "short" });
const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const longDay = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });

export function weekTitle(weekStart: Date) {
  const end = addDays(weekStart, 6);
  const a =
    weekStart.getFullYear() === end.getFullYear() ? short.format(weekStart) : full.format(weekStart);
  return `KW ${isoWeek(addDays(weekStart, 1))} · ${a.replace(/\.$/, "")} – ${full.format(end)}`;
}

/** Activity types as in Pipedrive. */
export type EntryKind = "call" | "meeting" | "task" | "deadline" | "email" | "lunch";
export const KIND_META: Record<EntryKind, { label: string; icon: LucideIcon }> = {
  call: { label: "Anruf", icon: Phone },
  meeting: { label: "Meeting", icon: Users },
  task: { label: "Aufgabe", icon: Clock },
  deadline: { label: "Deadline", icon: Flag },
  email: { label: "E-Mail-Adresse", icon: Mail },
  lunch: { label: "Lunch", icon: UtensilsCrossed },
};
export const toEntryKind = (type: string | null | undefined): EntryKind =>
  type && type in KIND_META ? (type as EntryKind) : "task";

export type WeekEntry = {
  id: string;
  at: Date;
  title: string;
  /** Tailwind classes of the status dot (mobile list). */
  dot: string;
  badge?: string;
  kind?: EntryKind;
  durationMin?: number;
  done?: boolean;
  /** Shown in the top row (no time of day). */
  allDay?: boolean;
};

export const fmtRange = (at: Date, durationMin = 30) =>
  `${time.format(at)} → ${time.format(new Date(at.getTime() + durationMin * 60_000))}`;

const HOUR = 56; // px per hour
const HOUR_M = 44; // px per hour on phones
const DAY_START = 0;
const DAY_END = 24;

/** Lays out overlapping entries of one day side by side. */
function lanes(list: WeekEntry[]) {
  const sorted = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: { e: WeekEntry; lane: number; lanes: number }[] = [];
  let cluster: { e: WeekEntry; lane: number; end: number }[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const n = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => out.push({ e: c.e, lane: c.lane, lanes: n }));
    cluster = [];
  };
  for (const e of sorted) {
    const s = e.at.getTime();
    const end = s + Math.max(e.durationMin ?? 30, 20) * 60_000;
    if (cluster.length && s >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.end > s).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ e, lane, end });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) flush();
  return out;
}

/**
 * Week calendar in the style of Pipedrive: type filters on top, a scrollable time grid with the hours on the left,
 * a red line for the current time, and entries that open a detail card when clicked.
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
  renderDetail,
  kinds = ["call", "meeting", "task", "deadline", "email", "lunch"],
}: {
  entries: WeekEntry[];
  weekStart: Date;
  onWeekChange: (monday: Date) => void;
  selected: Date | null;
  onSelect: (day: Date | null) => void;
  loading?: boolean;
  footer?: ReactNode;
  ariaLabel?: string;
  onAddForDay?: (day: Date) => void;
  addLabel?: string;
  /** Content of the card that opens when an entry is clicked. */
  renderDetail?: (entry: WeekEntry, close: () => void) => ReactNode;
  kinds?: EntryKind[];
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const [active, setActive] = useState<Set<EntryKind>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const mScroller = useRef<HTMLDivElement>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const shown = useMemo(
    () => entries.filter((e) => active.size === 0 || active.has(e.kind ?? "meeting")),
    [entries, active],
  );
  const timed = (d: Date) => shown.filter((e) => !e.allDay && sameDay(e.at, d));
  const untimed = (d: Date) => shown.filter((e) => e.allDay && sameDay(e.at, d));
  const hasAllDay = days.some((d) => untimed(d).length > 0);
  const thisWeek = sameDay(weekStart, startOfWeek(now));

  // Scroll to shortly before the current time (or 8:00 in other weeks).
  useEffect(() => {
    const h = thisWeek ? Math.max(0, now.getHours() + now.getMinutes() / 60 - 2) : 8;
    if (scroller.current) scroller.current.scrollTop = (h - DAY_START) * HOUR;
    if (mScroller.current) mScroller.current.scrollTop = (h - DAY_START) * HOUR_M;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  const toggle = (k: EntryKind) =>
    setActive((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const nowTop = (now.getHours() + now.getMinutes() / 60 - DAY_START) * HOUR;

  const entryButton = (e: WeekEntry, style?: React.CSSProperties, tall = false, where = "d") => {
    const pid = `${where}:${e.id}`;
    const Icon = KIND_META[e.kind ?? "meeting"].icon;
    const past = e.at.getTime() + (e.durationMin ?? 30) * 60_000 < now.getTime();
    const btn = (
      <button
        type="button"
        onClick={renderDetail ? undefined : () => setOpenId(openId === pid ? null : pid)}
        style={style}
        title={`${e.title} · ${fmtRange(e.at, e.durationMin)}`}
        className={cn(
          "cc-pd-entry group flex w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-[4px] px-2 py-1 text-left text-[13px] leading-tight",
          !e.allDay && "absolute",
          e.allDay && "cc-pd-entry--allday",
          past && "opacity-75",
          openId === pid && "ring-2 ring-primary",
        )}
      >
        <span className="flex w-full items-center gap-1.5">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className={cn("min-w-0 flex-1 truncate font-semibold", e.done && "line-through decoration-1")}>
            {e.title}
          </span>
          {e.done ? (
            <CheckCircle2 className="size-4 shrink-0 fill-emerald-600 text-background" aria-label="Erledigt" />
          ) : (
            <Circle className="size-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          )}
        </span>
        {tall && !e.allDay && (
          <span className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
            {fmtRange(e.at, e.durationMin)}
          </span>
        )}
      </button>
    );
    if (!renderDetail) return <div key={e.id} className="contents">{btn}</div>;
    return (
      <Popover key={pid} open={openId === pid} onOpenChange={(o) => setOpenId((cur) => (o ? pid : cur === pid ? null : cur))}>
        <PopoverTrigger asChild>{btn}</PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-[400px] max-w-[92vw] overflow-hidden p-0">
          {renderDetail(e, () => setOpenId(null))}
        </PopoverContent>
      </Popover>
    );
  };

  /** Phone version of an entry: a small coloured block in the time grid, like the Google Calendar app. */
  const mobileEntry = (e: WeekEntry, style: React.CSSProperties, color: string) => {
    const pid = `p:${e.id}`;
    const past = e.at.getTime() + (e.durationMin ?? 30) * 60_000 < now.getTime();
    const btn = (
      <button
        type="button"
        onClick={renderDetail ? undefined : () => setOpenId(openId === pid ? null : pid)}
        style={{ ...style, background: color }}
        title={`${e.title} · ${fmtRange(e.at, e.durationMin)}`}
        aria-label={`${e.title}, ${fmtRange(e.at, e.durationMin)}`}
        className={cn(
          "cc-m-entry absolute overflow-hidden px-1 py-0.5 text-left text-[10px] font-semibold leading-tight text-white",
          past && "opacity-70",
          openId === pid && "ring-2 ring-foreground/60",
        )}
      >
        <span className={cn("block truncate", e.done && "line-through")}>{e.title}</span>
      </button>
    );
    if (!renderDetail) return <div key={pid} className="contents">{btn}</div>;
    return (
      <Popover key={pid} open={openId === pid} onOpenChange={(o) => setOpenId((cur) => (o ? pid : cur === pid ? null : cur))}>
        <PopoverTrigger asChild>{btn}</PopoverTrigger>
        <PopoverContent side="bottom" align="center" collisionPadding={8} className="w-[400px] max-w-[94vw] overflow-hidden p-0">
          {renderDetail(e, () => setOpenId(null))}
        </PopoverContent>
      </Popover>
    );
  };
  const kindColor = (k: EntryKind | undefined) =>
    k === "call" ? "#3b82f6" : k === "meeting" ? "#16a34a" : k === "deadline" ? "#dc2626" : "#f59e0b";

  return (
    <section className="cc-pd-cal rounded-lg border bg-card" aria-label={ariaLabel}>
      {/* Header: week navigation and type filters */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-2 md:px-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" aria-label="Vorherige Woche" onClick={() => onWeekChange(addDays(weekStart, -7))}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={() => { onWeekChange(startOfWeek(new Date())); onSelect(null); }}>
            Heute
          </Button>
          <Button variant="outline" size="sm" aria-label="Nächste Woche" onClick={() => onWeekChange(addDays(weekStart, 7))}>
            <ChevronRight />
          </Button>
        </div>
        <h2 className="mr-auto min-w-0 truncate px-1 text-xs font-semibold md:px-2 md:text-sm" aria-live="polite">{weekTitle(weekStart)}</h2>
        <div role="group" aria-label="Aktivitätstyp" className="flex w-full items-center gap-0.5 overflow-x-auto md:w-auto md:flex-wrap md:overflow-visible">
          <button
            type="button"
            aria-pressed={active.size === 0}
            onClick={() => setActive(new Set())}
            className={cn("cc-pd-filter", active.size === 0 && "cc-pd-filter--on")}
          >
            Alle
          </button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {kinds.map((k) => {
            const { icon: Icon, label } = KIND_META[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active.has(k)}
                onClick={() => toggle(k)}
                className={cn("cc-pd-filter", active.has(k) && "cc-pd-filter--on")}
              >
                <Icon className="size-4" aria-hidden="true" /> {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Phone: week grid like the Google Calendar app. The day buttons also choose the day of the list below. */}
      <div className={cn("md:hidden", loading && "animate-pulse opacity-60")}>
        <div role="tablist" aria-label="Tage der Woche" className="grid grid-cols-[30px_repeat(7,minmax(0,1fr))] border-b">
          <span className="self-end pb-1.5 text-center text-[9px] font-semibold uppercase text-muted-foreground">
            KW{isoWeek(addDays(weekStart, 1))}
          </span>
          {days.map((d) => {
            const isSel = !!selected && sameDay(d, selected);
            const isToday = sameDay(d, now);
            return (
              <button
                key={d.toISOString()}
                type="button"
                role="tab"
                aria-selected={isSel}
                aria-label={longDay.format(d)}
                onClick={() => onSelect(isSel ? null : d)}
                className={cn("flex flex-col items-center gap-0.5 py-1.5", isSel && "bg-accent")}
              >
                <span className={cn("grid size-7 place-items-center rounded-full text-base font-medium leading-none", isToday && "cc-pd-today")}>
                  {d.getDate()}
                </span>
                <span className="text-[10px] uppercase text-muted-foreground">{weekday.format(d).replace(".", "")}</span>
              </button>
            );
          })}
        </div>
        {hasAllDay && (
          <div className="grid grid-cols-[30px_repeat(7,minmax(0,1fr))] border-b text-[10px]">
            <span className="self-center text-center text-[9px] leading-tight text-muted-foreground">ohne Zeit</span>
            {days.map((d) => {
              const n = untimed(d).length;
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  disabled={!n}
                  onClick={() => onSelect(d)}
                  className="mx-0.5 my-1 rounded-[3px] bg-muted py-0.5 text-center font-semibold tabular-nums text-muted-foreground disabled:bg-transparent disabled:text-transparent"
                >
                  {n || "·"}
                </button>
              );
            })}
          </div>
        )}
        <div ref={mScroller} className="relative max-h-[min(52vh,420px)] overflow-y-auto">
          <div className="relative grid grid-cols-[30px_repeat(7,minmax(0,1fr))]" style={{ height: (DAY_END - DAY_START) * HOUR_M }}>
            <div className="relative">
              {Array.from({ length: DAY_END - DAY_START }, (_, i) => (
                <span
                  key={i}
                  className="absolute right-1 -translate-y-1/2 text-[9px] text-muted-foreground tabular-nums"
                  style={{ top: i * HOUR_M }}
                >
                  {i === 0 ? "" : `${String(DAY_START + i).padStart(2, "0")}`}
                </span>
              ))}
            </div>
            {days.map((d) => (
              <div
                key={d.toISOString()}
                role="group"
                aria-label={longDay.format(d)}
                className={cn("relative border-l", selected && sameDay(d, selected) && "bg-accent/50")}
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR_M}px)`,
                }}
              >
                {lanes(timed(d)).map(({ e, lane, lanes: n }) => {
                  const start = e.at.getHours() + e.at.getMinutes() / 60;
                  const h = Math.max(((e.durationMin ?? 30) / 60) * HOUR_M, 18);
                  return mobileEntry(
                    e,
                    {
                      top: (start - DAY_START) * HOUR_M + 1,
                      height: h - 2,
                      left: `calc(${(lane / n) * 100}% + 1px)`,
                      width: `calc(${100 / n}% - 2px)`,
                    },
                    kindColor(e.kind),
                  );
                })}
              </div>
            ))}
            {thisWeek && (
              <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: (now.getHours() + now.getMinutes() / 60 - DAY_START) * HOUR_M }} aria-hidden="true">
                <div className="cc-pd-now relative h-[2px]" style={{ marginLeft: 30, width: "calc(100% - 30px)" }}>
                  <span className="cc-pd-now absolute -left-[3px] -top-[3px] size-2 rounded-full" />
                </div>
              </div>
            )}
          </div>
        </div>
        {onAddForDay && (
          <div className="border-t p-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => onAddForDay(selected && inWeek(selected, weekStart) ? selected : thisWeek ? now : weekStart)}>
              <CalendarPlus /> {addLabel}
            </Button>
          </div>
        )}
      </div>

      {/* Desktop: time grid */}
      <div className={cn("hidden md:block", loading && "animate-pulse opacity-60")}>
        <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b">
          <div className="flex items-center px-3 py-3 text-sm font-bold uppercase">
            {monthShort.format(weekStart).replace(".", "")}
          </div>
          {days.map((d) => {
            const today = sameDay(d, now);
            return (
              <div key={d.toISOString()} className="group relative flex items-center justify-center gap-1.5 border-l py-3 text-sm font-semibold">
                <span>{weekday.format(d).replace(".", "")}</span>
                <span className={cn("grid size-7 place-items-center rounded-full", today && "cc-pd-today")}>
                  {d.getDate()}
                </span>
                {onAddForDay && (
                  <button
                    type="button"
                    aria-label={`${addLabel} am ${longDay.format(d)}`}
                    title={addLabel}
                    onClick={() => onAddForDay(d)}
                    className="absolute right-1.5 grid size-6 place-items-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <CalendarPlus size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {hasAllDay && (
          <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b">
            <div />
            {days.map((d) => (
              <div key={d.toISOString()} className="flex max-h-[132px] min-w-0 flex-col gap-1 overflow-y-auto border-l p-1.5">
                {untimed(d).map((e) => entryButton(e))}
              </div>
            ))}
          </div>
        )}
        <div ref={scroller} className="relative max-h-[640px] overflow-y-auto">
          <div className="relative grid grid-cols-[64px_repeat(7,minmax(0,1fr))]" style={{ height: (DAY_END - DAY_START) * HOUR }}>
            {/* hour labels */}
            <div className="relative">
              {Array.from({ length: DAY_END - DAY_START }, (_, i) => (
                <span
                  key={i}
                  className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
                  style={{ top: i * HOUR }}
                >
                  {i === 0 ? "" : `${String(DAY_START + i).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>
            {days.map((d) => (
              <div
                key={d.toISOString()}
                role="group"
                aria-label={longDay.format(d)}
                className="relative border-l"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR}px)`,
                }}
              >
                {lanes(timed(d)).map(({ e, lane, lanes: n }) => {
                  const start = e.at.getHours() + e.at.getMinutes() / 60;
                  const h = Math.max(((e.durationMin ?? 30) / 60) * HOUR, 26);
                  return entryButton(
                    e,
                    {
                      top: (start - DAY_START) * HOUR + 1,
                      height: h - 2,
                      left: `calc(${(lane / n) * 100}% + 2px)`,
                      width: `calc(${100 / n}% - 6px)`,
                    },
                    h >= 46,
                  );
                })}
              </div>
            ))}
            {/* current time */}
            {thisWeek && (
              <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop }} aria-hidden="true">
                <div className="cc-pd-now relative h-[2px]" style={{ marginLeft: 60 }}>
                  <span className="cc-pd-now absolute -left-[3px] -top-[3px] size-2 rounded-full" />
                </div>
                <span className="cc-pd-now-label absolute left-0 -top-2 w-[58px] bg-card pr-1 text-right text-[11px] font-semibold tabular-nums">
                  {time.format(now)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      {footer && <div className="border-t p-4">{footer}</div>}
    </section>
  );
}

/** Detail card of an entry, laid out like the Pipedrive activity card. */
export function EntryDetailCard({
  entry,
  note,
  rows,
  footer,
}: {
  entry: WeekEntry;
  note?: ReactNode;
  rows: { icon: LucideIcon; text: ReactNode }[];
  footer?: ReactNode;
}) {
  const Icon = KIND_META[entry.kind ?? "meeting"].icon;
  const date = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(entry.at);
  const end = new Date(entry.at.getTime() + (entry.durationMin ?? 30) * 60_000);
  return (
    <div className="text-sm">
      <div className="flex gap-4 px-5 py-4">
        <Icon className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-base font-semibold leading-snug">{entry.title}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {date}
            {!entry.allDay && ` · ${time.format(entry.at)} – ${time.format(end)}`}
          </p>
        </div>
      </div>
      {note && (
        <div className="cc-pd-note flex gap-4 border-y px-5 py-3">
          <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="max-h-[40vh] min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words pr-1">{note}</div>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="space-y-3 px-5 py-4">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-4">
              <r.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 break-words">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
      {footer && <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">{footer}</div>}
    </div>
  );
}
