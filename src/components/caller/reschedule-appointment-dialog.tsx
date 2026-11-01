import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SlotPicker } from "@/components/booking/slot-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AppointmentToMove = { id: string; title: string; startsAt: string };

const PROBLEM: Record<string, string> = {
  slot_full: "Zu dieser Zeit ist kein Termin mehr frei.",
  slot_conflict: "Zu dieser Zeit ist die zuständige Person schon belegt.",
  appointment_too_soon: "Termine können frühestens in 3 Tagen liegen.",
  invalid_schedule: "Bitte eine Zeit in der Zukunft wählen.",
  forbidden: "Dafür fehlt dir die Berechtigung.",
};

/** Moves an appointment of the tool to another slot (manager, admin or the assigned Senior Caller). */
export function RescheduleAppointmentDialog({
  appointment,
  country,
  onClose,
  onMoved,
}: {
  appointment: AppointmentToMove | null;
  country: string;
  onClose: () => void;
  /** Called after the move, e.g. to push the new time to Pipedrive. */
  onMoved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setChosen(null);
    onClose();
  };
  async function save() {
    if (!appointment || !chosen) return;
    setBusy(true);
    const { error } = await supabase.rpc("reschedule_appointment", {
      p_appointment_id: appointment.id,
      p_starts_at: new Date(chosen).toISOString(),
    });
    setBusy(false);
    if (error) {
      const code = Object.keys(PROBLEM).find((k) => error.message.includes(k));
      toast.error(code ? PROBLEM[code]! : "Der Termin konnte nicht verschoben werden.");
      return;
    }
    toast.success("Termin verschoben.");
    void qc.invalidateQueries({ queryKey: ["appointments"] });
    onMoved(appointment.id);
    close();
  }
  return (
    <Dialog open={!!appointment} onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent className="cc-theme max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Termin verschieben</DialogTitle>
          <DialogDescription>
            {appointment?.title} · aktuell{" "}
            {appointment ? new Date(appointment.startsAt).toLocaleString("de-DE") : ""}
          </DialogDescription>
        </DialogHeader>
        {appointment && (
          <SlotPicker
            key={appointment.id}
            kind="appointment"
            country={country}
            value={chosen}
            onChange={setChosen}
            initialDay={new Date(appointment.startsAt)}
            disabled={busy}
          />
        )}
        <div className="flex gap-2">
          <Button disabled={!chosen || busy} onClick={() => void save()}>
            {busy ? "Speichert …" : "Verschieben"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={close}>
            Abbrechen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
