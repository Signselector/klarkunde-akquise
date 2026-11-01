import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { stripHtml } from "@/lib/deal-detail";
import { updatePipedriveActivityNote } from "@/lib/pipedrive-activity.functions";

/** Note of a Pipedrive calendar entry (full text, not shortened) with inline editing for those who may edit it. */
export function PdNoteBlock({
  activityId,
  country,
  html,
  fallback,
  editable,
}: {
  activityId: number;
  country: string;
  html: string | null | undefined;
  fallback?: string | null;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const save = useServerFn(updatePipedriveActivityNote);
  const text = html ? stripHtml(html) : (fallback ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  if (!text && !editable) return null;
  async function submit() {
    setBusy(true);
    try {
      const r = await save({ data: { country, activityId, note: draft } });
      toast.success(
        r.state === "synced" ? "Notiz gespeichert und in Pipedrive aktualisiert." : "Notiz gespeichert (Testmodus, nicht an Pipedrive gesendet).",
      );
      void qc.invalidateQueries({ queryKey: ["external-activities"] });
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Die Notiz konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <div className="space-y-2">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} disabled={busy} className="bg-white" />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || draft.trim() === text} onClick={() => void submit()}>
            {busy ? "Speichert …" : "Speichern"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
            Abbrechen
          </Button>
        </div>
      </div>
    );
  return (
    <div className="flex items-start gap-2">
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{text || "Keine Notiz."}</p>
      {editable && (
        <button
          type="button"
          aria-label="Notiz bearbeiten"
          className="!min-h-0 shrink-0 rounded p-1 opacity-70 hover:bg-black/5 hover:opacity-100"
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}
