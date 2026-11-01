import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SlotPicker } from "@/components/booking/slot-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type CallbackToMove = { id: string; due_at: string; lead_id: string; company: string | null };

/** Moves an open callback to another time: day on the left, free times on the right, like when it was booked. */
export function RescheduleCallbackDialog({
  callback,
  userId,
  country,
  onClose,
}: {
  callback: CallbackToMove | null;
  userId: string;
  country: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setChosen(null);
    onClose();
  };
  async function save() {
    if (!callback || !chosen) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("callbacks")
      .update({ due_at: new Date(chosen).toISOString() })
      .eq("id", callback.id)
      .eq("user_id", userId)
      .eq("done", false)
      .select("id");
    setBusy(false);
    if (error || !data?.length) {
      toast.error("Der Rückruf konnte nicht verschoben werden. Bitte lade die Seite neu und versuche es erneut.");
      return;
    }
    toast.success("Rückruf verschoben.");
    void qc.invalidateQueries({ queryKey: ["callbacks"] });
    void qc.invalidateQueries({ queryKey: ["lead-callback-due"] });
    void qc.invalidateQueries({ queryKey: ["external-activities"] });
    close();
  }
  return (
    <Dialog open={!!callback} onOpenChange={(o) => !o && close()}>
      <DialogContent className="cc-theme max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rückruf verschieben</DialogTitle>
          <DialogDescription>
            {callback?.company || "Ohne Firmenname"} · aktuell {callback ? new Date(callback.due_at).toLocaleString("de-DE") : ""}
          </DialogDescription>
        </DialogHeader>
        {callback && (
          <SlotPicker
            key={callback.id}
            kind="callback"
            country={country}
            value={chosen}
            onChange={setChosen}
            leadId={callback.lead_id}
            initialDay={new Date(callback.due_at)}
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
