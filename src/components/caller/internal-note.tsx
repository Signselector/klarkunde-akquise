import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Interne Notiz für dich" of a lead: kept in this tool only, never sent to Pipedrive.
 * A saved note is shown read-only with a pencil to edit it at any time; without one the field is ready to type.
 */
export function InternalNote({
  leadId,
  value,
}: {
  leadId: string;
  value: string | null | undefined;
}) {
  const qc = useQueryClient();
  const saved = value ?? "";
  const [text, setText] = useState(saved);
  const [editing, setEditing] = useState(saved.trim() === "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setText(saved);
    setEditing(saved.trim() === "");
  }, [leadId, saved]);

  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("update_lead_internal_note", {
      p_lead_id: leadId,
      p_internal_note: text.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("forbidden")
          ? "Dafür fehlt dir die Berechtigung."
          : "Die interne Notiz konnte nicht gespeichert werden.",
      );
      return;
    }
    toast.success("Interne Notiz gespeichert.");
    if (text.trim()) setEditing(false);
    void qc.invalidateQueries({ queryKey: ["lead-detail", leadId] });
    void qc.invalidateQueries({ queryKey: ["next-lead"] });
  }

  return (
    <details className="cc-detail-section cc-fold" open={saved.trim() !== "" || undefined}>
      <summary className="cursor-pointer font-semibold">Interne Notiz für dich</summary>
      <div className="space-y-2 pt-3">
        {editing ? (
          <>
            <Textarea
              aria-label="Interne Notiz"
              rows={4}
              maxLength={5000}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={busy || text.trim() === saved.trim()}
                onClick={() => void save()}
              >
                {busy ? "Speichert …" : "Speichern"}
              </Button>
              {saved.trim() !== "" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setText(saved);
                    setEditing(false);
                  }}
                >
                  Abbrechen
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <p className="flex-1 whitespace-pre-wrap">{saved}</p>
            <button
              type="button"
              aria-label="Interne Notiz bearbeiten"
              className="!min-h-0 rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
