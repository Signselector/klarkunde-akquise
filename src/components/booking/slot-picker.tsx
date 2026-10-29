import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { de } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Calendar } from "@/components/ui/calendar";
import { refreshBookingSlots } from "@/lib/calendar-sync.functions";
import {
  APPOINTMENT_CAPACITY,
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
    enabled: !!from && (kind === "callback" || fresh.isFetched),
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
    if (slotState(new Date(chosen), used).state === "full") onChange(null);
  }, [chosen, used, availability.data, onChange]);

  // Appointments (not callbacks) can be booked at the earliest for the day after tomorrow.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (kind === "appointment") today.setDate(today.getDate() + minLeadDays);
  const end = chosen !== null ? new Date(chosen + slotDurationMinutes(kind) * 60_000) : null;

  return (
    <div className="space-y-3 rounded-[10px] border p-3" data-slot-picker={kind}>
      <div className="flex flex-col gap-3">
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
          className="mx-auto shrink-0 rounded-md border p-2"
        />
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-sm font-medium">
            {day ? dayLabel.format(day) : "Bitte zuerst einen Tag wählen"}
          </p>
          {day && (
            <div
              className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8"
              role="listbox"
              aria-label="Uhrzeit wählen"
              aria-busy={availability.isFetching}
            >
              {slots.map((s) => {
                const st = slotState(s, used);
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
        {kind === "appointment"
          ? `Ein Termin dauert ${slotDurationMinutes("appointment")} Minuten, gleichzeitig sind höchstens ${APPOINTMENT_CAPACITY} möglich. Termine sind frühestens in ${minLeadDays} Tagen buchbar. Ein Punkt markiert einen Zeitpunkt, an dem schon ein Termin liegt.`
          : `Ein Rückruf belegt ${slotDurationMinutes("callback")} Minuten und ist nur für dich sichtbar. Zeiten, zu denen du bereits einen Termin oder Rückruf hast, sind gesperrt.`}
      </p>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span aria-live="polite">
          {chosen !== null && end ? (
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
