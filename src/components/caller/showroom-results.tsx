import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, Flame, Meh, ThumbsDown, Trash2, UserX } from "lucide-react";
import { Phone } from "@/components/coldcaller/icons";
import { SlotPicker } from "@/components/booking/slot-picker";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCountry } from "@/lib/country";
import { recordAppointmentOutcome, type ShowroomOutcome } from "@/lib/appointment-outcome.functions";

export type ShowroomAppointment = { id: string; title: string; startsAt: string; outcome: string | null };

const OPTIONS: { key: ShowroomOutcome; label: string; icon: typeof Phone; hint: string }[] = [
  { key: "no_show", label: "Termin nicht wahrgenommen", icon: UserX as never, hint: "Deal geht auf „No Show“, der Lead geht an den ursprünglichen Caller zurück (Termin versäumt)." },
  { key: "low_interest", label: "Wenig interessiert", icon: ThumbsDown as never, hint: "Deal geht auf „Wenig Interesse“, Aufgabe am Deal, optional Folgetermin." },
  { key: "medium_interest", label: "Mittleres Interesse", icon: Meh as never, hint: "Deal geht auf „Mittleres Interesse“, Aufgabe am Deal, optional Folgetermin." },
  { key: "high_interest", label: "Sehr interessiert", icon: Flame as never, hint: "Deal geht auf „Sehr interessiert“, Aufgabe am Deal, optional Folgetermin." },
  { key: "deleted", label: "Löschen", icon: Trash2 as never, hint: "Der Termin wird aus dem Kalender gelöscht, Aufgabe am Deal." },
  { key: "rescheduled", label: "Verschieben", icon: CalendarClock as never, hint: "Der Termin bekommt eine neue Zeit (kein neuer Termin), Notiz am Deal." },
];

const OUTCOME_LABEL: Record<string, string> = {
  no_show: "Termin nicht wahrgenommen",
  low_interest: "Wenig interessiert",
  medium_interest: "Mittleres Interesse",
  high_interest: "Sehr interessiert",
};

const ERRORS: Record<string, string> = {
  note_required: "Bitte eine Notiz eintragen.",
  appointment_required: "Bitte die neue Zeit wählen.",
  already_decided: "Für diesen Termin wurde schon ein Ergebnis erfasst.",
  forbidden: "Dafür fehlt dir die Berechtigung.",
  lead_required: "Zu diesem Termin gibt es keine Kundenakte.",
  slot_full: "Zu dieser Zeit ist kein Termin mehr frei.",
  slot_conflict: "Zu dieser Zeit ist die zuständige Person schon belegt.",
  appointment_too_soon: "Termine können frühestens in 3 Tagen liegen.",
  invalid_schedule: "Bitte eine Zeit in der Zukunft wählen.",
};

const PIPEDRIVE_PROBLEM: Record<string, string> = {
  stage_not_mapped: "Die Stage ist in den Einstellungen (Stage Mapping) nicht zugeordnet. Das Ergebnis ist gespeichert, aber nicht in Pipedrive.",
  unauthorized: "Pipedrive hat die Anmeldung abgelehnt. Das Ergebnis ist gespeichert, aber nicht in Pipedrive.",
};

/** "Showroom-Ergebnisse": what happened at the appointment. Every result needs a note. */
export function ShowroomResults({
  appointment,
  onDone,
}: {
  appointment: ShowroomAppointment;
  onDone: () => void;
}) {
  const country = useCountry();
  const qc = useQueryClient();
  const save = useServerFn(recordAppointmentOutcome);
  const [active, setActive] = useState<ShowroomOutcome | null>(null);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (appointment.outcome)
    return (
      <section className="cc-detail-section space-y-2" aria-labelledby="showroom-title">
        <h3 id="showroom-title" className="flex items-center gap-3 text-lg">
          <Phone size={22} aria-hidden="true" className="text-primary" />
          Showroom-Ergebnisse
        </h3>
        <p className="rounded-md border bg-muted/40 p-3 text-sm">
          Für diesen Termin ist das Ergebnis „{OUTCOME_LABEL[appointment.outcome] ?? appointment.outcome}“ erfasst.
        </p>
      </section>
    );

  const current = OPTIONS.find((o) => o.key === active) ?? null;
  const interest = active === "low_interest" || active === "medium_interest" || active === "high_interest";

  function pick(key: ShowroomOutcome) {
    if (busy) return;
    setActive(key);
    setNote("");
    setWhen(null);
  }

  async function submit() {
    if (!current || busy) return;
    if (!note.trim()) {
      toast.error(ERRORS["note_required"]!);
      return;
    }
    if (current.key === "rescheduled" && !when) {
      toast.error(ERRORS["appointment_required"]!);
      return;
    }
    setBusy(true);
    try {
      const r = await save({
        data: {
          appointmentId: appointment.id,
          outcome: current.key,
          note: note.trim(),
          newStart: current.key === "rescheduled" ? when : null,
          followupAt: interest ? when : null,
        },
      });
      toast.success(
        current.key === "deleted"
          ? "Termin gelöscht."
          : current.key === "rescheduled"
            ? "Termin verschoben. Der Eintrag in Pipedrive wird angepasst."
            : `Ergebnis „${current.label}“ gespeichert.`,
      );
      if (r.state === "error")
        toast.error(PIPEDRIVE_PROBLEM[r.error ?? ""] ?? "Die Übertragung an Pipedrive ist fehlgeschlagen. Das Ergebnis ist gespeichert.");
      else if (r.state === "no_deal")
        toast.message("Zu diesem Termin gibt es noch keinen Deal in Pipedrive. Das Ergebnis ist im Tool gespeichert.");
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      void qc.invalidateQueries({ queryKey: ["slots"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["callbacks"] });
      onDone();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      const code = Object.keys(ERRORS).find((k) => m.includes(k));
      toast.error(code ? ERRORS[code]! : `Das Ergebnis konnte nicht gespeichert werden${m ? ` (${m.slice(0, 90)})` : ""}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cc-detail-section space-y-3" aria-labelledby="showroom-title">
      <h3 id="showroom-title" className="flex items-center gap-3 text-lg">
        <Phone size={22} aria-hidden="true" className="text-primary" />
        Showroom-Ergebnisse
      </h3>
      <div className="cc-outcome-grid">
        {OPTIONS.map((o) => {
          const Icon = o.icon as unknown as typeof UserX;
          return (
            <button
              key={o.key}
              type="button"
              disabled={busy}
              aria-pressed={active === o.key}
              title={o.hint}
              onClick={() => pick(o.key)}
              className="cc-outcome-btn"
            >
              <Icon size={22} aria-hidden="true" />
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
      {current && (
        <form
          className="space-y-3 rounded-[10px] border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="font-medium">{current.label}</p>
          <p className="text-xs text-muted-foreground">{current.hint}</p>
          <label className="block text-sm">
            Notiz (Pflicht, wird an den Deal angehängt)
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </label>
          {current.key === "rescheduled" && (
            <div className="space-y-1.5">
              <span className="block text-sm">Neue Zeit</span>
              <SlotPicker kind="appointment" country={country} value={when} onChange={setWhen} initialDay={new Date(appointment.startsAt)} />
            </div>
          )}
          {interest && (
            <Reveal
              title="Folgetermin planen (optional)"
              summary={when ? new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(when)) : null}
            >
              <p className="mb-2 text-xs text-muted-foreground">
                Der Folgetermin erscheint unter Termine wieder beim Manager.
              </p>
              <SlotPicker kind="appointment" country={country} value={when} onChange={setWhen} />
            </Reveal>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} variant={current.key === "deleted" ? "destructive" : "default"}>
              {busy ? "Wird gespeichert …" : current.key === "deleted" ? "Termin löschen" : "Bestätigen"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setActive(null)}>
              Abbrechen
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
