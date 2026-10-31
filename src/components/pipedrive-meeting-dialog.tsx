import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dropdown } from "@/components/ui/dropdown";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dateValue, timeValue } from "@/lib/booking-slots";
import { updatePipedriveMeeting } from "@/lib/pipedrive-activity.functions";

export type EditableMeeting = { activityId: number; subject: string; startsAt: string; durationMin: number };

const DURATIONS = [15, 30, 45, 60, 90, 120];

/** Edit dialog for a Pipedrive meeting (managers and admins). The change is sent to Pipedrive. */
export function PipedriveMeetingDialog({
  meeting,
  country,
  onClose,
  onSaved,
}: {
  meeting: EditableMeeting | null;
  country: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(updatePipedriveMeeting);
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!meeting) return;
    const d = new Date(meeting.startsAt);
    setSubject(meeting.subject);
    setDate(dateValue(d));
    setTime(timeValue(d));
    setDuration(String(meeting.durationMin));
  }, [meeting]);

  async function submit() {
    if (!meeting || busy) return;
    const start = new Date(`${date}T${time}`);
    if (!subject.trim() || Number.isNaN(start.getTime())) {
      toast.error("Bitte Betreff, Datum und Uhrzeit eintragen.");
      return;
    }
    setBusy(true);
    try {
      const r = await save({
        data: { country, activityId: meeting.activityId, subject, startsAt: start.toISOString(), durationMin: Number(duration) },
      });
      toast.success(
        r.state === "synced"
          ? "Meeting gespeichert und in Pipedrive geändert."
          : "Testmodus: Das Meeting wurde im Tool geändert, nichts wurde an Pipedrive gesendet.",
      );
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message.slice(0, 160) : "Das Meeting konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  const options = [...new Set([...DURATIONS, meeting?.durationMin ?? 30])].sort((a, b) => a - b);
  return (
    <Dialog open={!!meeting} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Meeting bearbeiten</DialogTitle>
          <DialogDescription>Die Änderung wird an das Meeting in Pipedrive gesendet. Anrufe lassen sich nicht bearbeiten.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1">
            Betreff
            <Input value={subject} maxLength={255} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              Datum
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="grid gap-1">
              Uhrzeit
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <label className="grid gap-1">
            Dauer
            <Dropdown
              className="w-full"
              ariaLabel="Dauer"
              value={duration}
              onChange={setDuration}
              options={options.map((m) => ({ value: String(m), label: `${m} Minuten` }))}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? "Wird gespeichert …" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
