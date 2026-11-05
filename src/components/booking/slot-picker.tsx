import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { de } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Calendar } from "@/components/ui/calendar";
import { refreshBookingSlots } from "@/lib/calendar-sync.functions";
import {
  appointmentCapacity,
  MIN_APPOINTMENT_LEAD_DAYS,
  daySlots,
  slotDurationMinutes,
  slotState,
  toAvailabilityMap,
  type Availability,
  type SlotKind,
} from "@/lib/booking-slots";

const dayLabel = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const hhmm = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

const ITEM_H = 36;
const VISIBLE_ROWS = 5;
const COMMIT_DELAY_MS = 120;
const two = (n: number) => String(n).padStart(2, "0");
const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * One drum of the iOS alarm picker: a snapping scroll column with the value in the middle. Mouse wheel, trackpad,
 * touch, click on a number and the arrow keys all move it; the value is reported after the scrolling has settled
 * (short debounce), so fast flicks do not lose a value. Nothing here touches `window` while rendering.
 */
export function WheelColumn({
  count,
  value,
  label,
  active,
  disabled,
  onCommit,
}: {
  count: number;
  value: number;
  label: string;
  /** False until the user picked something: the middle number then looks quiet. */
  active: boolean;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const [live, setLive] = useState(value);
  const placed = useRef(false);
  // Where the drum is heading after key presses: fast repeated keys add up instead of each starting from the old spot.
  const target = useRef<number | null>(null);
  const clamp = (n: number) => Math.min(count - 1, Math.max(0, n));
  const indexAt = (el: HTMLElement) => clamp(Math.round(el.scrollTop / ITEM_H));
  const scrollToIndex = (i: number, smooth: boolean) => {
    ref.current?.scrollTo?.({ top: clamp(i) * ITEM_H, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  };

  // The value changed from outside (quick pick, other day): turn the drum there.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setLive(value);
    // The first placement is instant, later changes turn the drum.
    if (indexAt(el) !== value) scrollToIndex(value, placed.current);
    placed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    },
    [],
  );

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (frame.current === null)
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        setLive(indexAt(el));
      });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      target.current = null;
      const i = indexAt(el);
      setLive(i);
      if (i !== value) onCommit(i);
    }, COMMIT_DELAY_MS);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : e.key === "PageUp" ? -5 : e.key === "PageDown" ? 5 : 0;
    if (step) {
      e.preventDefault();
      target.current = clamp((target.current ?? live) + step);
      scrollToIndex(target.current, true);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      target.current = e.key === "Home" ? 0 : count - 1;
      scrollToIndex(target.current, true);
    }
  }

  return (
    <div className="relative" style={{ height: ITEM_H * VISIBLE_ROWS }}>
      {/* The two hairlines around the active row. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-y border-border/60"
        style={{ height: ITEM_H }}
      />
      <div
        ref={ref}
        role="spinbutton"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={count - 1}
        aria-valuenow={live}
        aria-valuetext={two(live)}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="h-full w-16 snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-md [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-scrollbar]:hidden"
        style={{
          paddingBlock: (ITEM_H * (VISIBLE_ROWS - 1)) / 2,
          maskImage: "linear-gradient(transparent, black 30%, black 70%, transparent)",
          WebkitMaskImage: "linear-gradient(transparent, black 30%, black 70%, transparent)",
          perspective: 400,
          ...(disabled ? { pointerEvents: "none", opacity: 0.6 } : {}),
        }}
      >
        {Array.from({ length: count }, (_, i) => {
          const dist = Math.abs(i - live);
          const centre = dist === 0;
          return (
            <div
              key={i}
              role="presentation"
              onClick={() => scrollToIndex(i, true)}
              className={`flex cursor-pointer snap-center items-center justify-center text-xl tabular-nums transition-colors ${
                centre ? (active ? "font-semibold text-primary" : "font-semibold text-foreground/60") : "text-muted-foreground"
              }`}
              style={{
                height: ITEM_H,
                transform: `rotateX(${Math.min(dist, 3) * (i < live ? 22 : -22)}deg) scale(${1 - Math.min(dist, 3) * 0.06})`,
              }}
            >
              {two(i)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Callbacks: any minute-exact time on the chosen day (iOS alarm wheels), overlaps allowed. Quick picks for common times. */
export function CallbackTimeInput({
  day,
  chosen,
  disabled,
  onChange,
}: {
  day: Date;
  chosen: number | null;
  disabled: boolean;
  onChange: (iso: string | null) => void;
}) {
  const sameDay = chosen !== null && new Date(chosen).toDateString() === day.toDateString();
  const chosenDate = sameDay ? new Date(chosen as number) : null;
  const [hm, setHm] = useState({ h: chosenDate?.getHours() ?? 10, m: chosenDate?.getMinutes() ?? 0 });
  const [touched, setTouched] = useState(sameDay);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(hm);

  // A time chosen elsewhere (quick pick, reopened form) turns the wheels there.
  useEffect(() => {
    if (!chosenDate) return;
    const next = { h: chosenDate.getHours(), m: chosenDate.getMinutes() };
    if (next.h !== latest.current.h || next.m !== latest.current.m) {
      latest.current = next;
      setHm(next);
    }
    setTouched(true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  // 10:00 is selected as soon as a day is chosen; the wheels only change it.
  useEffect(() => {
    if (!sameDay) apply(10, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (h: number, m: number) => {
    latest.current = { h, m };
    setHm({ h, m });
    setTouched(true);
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
    if (d.getTime() < Date.now() - 60_000) {
      setError("Dieser Zeitpunkt liegt in der Vergangenheit.");
      onChange(null);
      return;
    }
    setError(null);
    onChange(d.toISOString());
  };
  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Uhrzeit wählen"
        className="flex items-center justify-center gap-1 rounded-lg border bg-muted/30 px-3 py-2"
      >
        <WheelColumn
          count={24}
          value={hm.h}
          label="Stunde"
          active={touched}
          disabled={disabled}
          onCommit={(h) => apply(h, latest.current.m)}
        />
        <span aria-hidden="true" className="pb-0.5 text-xl font-semibold text-muted-foreground">
          :
        </span>
        <WheelColumn
          count={60}
          value={hm.m}
          label="Minute"
          active={touched}
          disabled={disabled}
          onCommit={(m) => apply(latest.current.h, m)}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Small booking calendar: pick a day, then a 30-minute slot. Free/busy only shows how many appointments exist at
 * a time (never which ones). Full slots can not be chosen. For callbacks a slot is blocked by the user's own entries.
 */
export function SlotPicker({
  kind,
  country,
  value,
  onChange,
  leadId,
  optional,
  disabled,
  initialDay,
  minLeadDays = MIN_APPOINTMENT_LEAD_DAYS,
}: {
  kind: SlotKind;
  country: string;
  /** Chosen start as ISO string. */
  value: string | null;
  onChange: (iso: string | null) => void;
  /** The lead the callback is for: its own old callback does not block the new time. */
  leadId?: string;
  optional?: boolean;
  disabled?: boolean;
  /** Day that is preselected when nothing is chosen yet. */
  initialDay?: Date | null;
  /** Appointments only: earliest bookable day, counted from today. */
  minLeadDays?: number;
}) {
  const initial = value ? new Date(value) : (initialDay ?? undefined);
  const [day, setDay] = useState<Date | undefined>(initial);
  // Start in the month of the first bookable day: when nothing in the current month can be booked any more (e.g. on
  // the 29th with a three-day lead time) the next month is shown right away.
  const [month, setMonth] = useState<Date>(() => {
    const earliest = new Date();
    earliest.setHours(0, 0, 0, 0);
    if (kind === "appointment") earliest.setDate(earliest.getDate() + minLeadDays);
    return initial && initial >= earliest ? initial : earliest;
  });

  // Appointments: bring the company free/busy from Pipedrive up to date once per opening (the server throttles it).
  const fresh = useQuery({
    enabled: kind === "appointment",
    queryKey: ["booking-refresh", country],
    staleTime: 3 * 60_000,
    retry: false,
    queryFn: async () => {
      try {
        await refreshBookingSlots({ data: { country } });
      } catch {
        // The slots still show what the tool knows.
      }
      return true;
    },
  });

  const from = day ? new Date(day.getFullYear(), day.getMonth(), day.getDate()) : null;
  const to = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1) : null;
  const availability = useQuery({
    enabled: !!from && kind === "appointment" && fresh.isFetched,
    queryKey: ["slots", kind, country, from?.toDateString(), leadId ?? null],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_slot_availability", {
        p_country: country,
        p_from: (from as Date).toISOString(),
        p_to: (to as Date).toISOString(),
        p_kind: kind,
        ...(leadId ? { p_lead: leadId } : {}),
      });
      if (error) throw error;
      return (data ?? []) as unknown as Availability[];
    },
  });
  // Until the free/busy list is there every slot is locked, so nobody picks a time that is already taken.
  const loading = availability.isPending && !availability.isError;
  const used = useMemo(() => toAvailabilityMap(availability.data), [availability.data]);
  const slots = useMemo(() => (day ? daySlots(day, kind) : []), [day, kind]);
  const chosen = value ? new Date(value).getTime() : null;

  // A slot that became full while it was selected is deselected.
  useEffect(() => {
    if (chosen === null || !availability.data) return;
    if (slotState(new Date(chosen), used, Date.now(), kind === "appointment" ? appointmentCapacity(country) : 1).state === "full") onChange(null);
  }, [chosen, used, availability.data, onChange]);

  // Appointments (not callbacks) can be booked at the earliest for the day after tomorrow.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (kind === "appointment") today.setDate(today.getDate() + minLeadDays);
  const end = chosen !== null ? new Date(chosen + slotDurationMinutes(kind) * 60_000) : null;

  return (
    <div className="@container space-y-3 rounded-[10px] border p-3" data-slot-picker={kind}>
      {/* Date on the left, times on the right (stacked when the space is narrow). */}
      <div className="flex flex-col gap-4 @lg:flex-row @lg:items-start">
        <Calendar
          mode="single"
          selected={day}
          month={month}
          onMonthChange={setMonth}
          onSelect={(d) => {
            setDay(d);
            if (d && chosen !== null) onChange(null);
          }}
          disabled={[{ before: today }, ...(disabled ? [() => true] : [])]}
          weekStartsOn={1}
          locale={de}
          className="mx-auto shrink-0 rounded-md border p-2 @lg:mx-0"
        />
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-sm font-medium">
            {day ? dayLabel.format(day) : "Bitte zuerst einen Tag wählen"}
          </p>
          {day && kind === "callback" && (
            <CallbackTimeInput
              key={day.toDateString()}
              day={day}
              chosen={chosen}
              disabled={!!disabled}
              onChange={onChange}
            />
          )}
          {day && kind === "appointment" && (
            <div
              className="grid grid-cols-3 gap-1.5 @sm:grid-cols-4"
              role="listbox"
              aria-label="Uhrzeit wählen"
              aria-busy={availability.isFetching}
            >
              {slots.map((s) => {
                const st = slotState(s, used, Date.now(), kind === "appointment" ? appointmentCapacity(country) : 1);
                const blocked = st.state === "past" || st.state === "full" || !!disabled || loading;
                const selected = chosen === s.getTime();
                return (
                  <button
                    key={s.getTime()}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={blocked}
                    title={
                      st.state === "full"
                        ? kind === "appointment"
                          ? "Ausgebucht"
                          : "Du hast hier schon einen Eintrag"
                        : st.state === "partial"
                          ? `${st.used} von ${st.capacity} Terminen belegt`
                          : undefined
                    }
                    onClick={() => onChange(s.toISOString())}
                    className={`relative rounded-md border px-1 py-2 text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : blocked
                          ? "cursor-not-allowed bg-muted/40 text-muted-foreground/60 line-through"
                          : "hover:border-primary hover:bg-primary/10"
                    }`}
                  >
                    {hhmm(s)}
                    {kind === "appointment" && st.state === "partial" && !selected && (
                      <span
                        className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-amber-500"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {availability.isError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              Die Belegung konnte nicht geladen werden. Beim Speichern wird sie trotzdem geprüft.
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {kind === "appointment" ? "Ein Punkt markiert einen bereits angelegten Termin." : null}
      </p>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span aria-live="polite">
          {kind === "callback" ? null : chosen !== null && end ? (
            <strong>
              {dayLabel.format(new Date(chosen))}, {hhmm(new Date(chosen))}–{hhmm(end)} Uhr
            </strong>
          ) : (
            <span className="text-muted-foreground">Noch kein Zeitpunkt gewählt</span>
          )}
        </span>
        {optional && chosen !== null && (
          <button
            type="button"
            className="text-xs underline"
            onClick={() => {
              onChange(null);
              setDay(undefined);
            }}
          >
            Auswahl entfernen
          </button>
        )}
      </div>
    </div>
  );
}
