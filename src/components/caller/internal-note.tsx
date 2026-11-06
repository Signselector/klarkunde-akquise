import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Interne Notiz (nur im Tool)" of a lead: kept in this tool only, never sent to Pipedrive. It can be changed,
 * extended or emptied at any time.
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
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Another lead, or a newer version from the server: start from it (unless the user is typing something else).
  useEffect(() => {
    setText(saved);
    setDone(false);
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
    setDone(true);
    toast.success("Interne Notiz gespeichert.");
    void qc.invalidateQueries({ queryKey: ["lead-detail", leadId] });
    void qc.invalidateQueries({ queryKey: ["next-lead"] });
  }

  return (
    <details className="cc-detail-section cc-fold" open>
      <summary className="cursor-pointer font-semibold">Interne Notiz (nur im Tool)</summary>
      <div className="space-y-2 pt-3">
        <p className="text-xs text-muted-foreground">
          Bleibt rein intern im Tool – wird nicht an Pipedrive übertragen.
        </p>
        <Textarea
          aria-label="Interne Notiz"
          rows={4}
          maxLength={5000}
          placeholder="Persönliche Gedanken, Eigenheiten des Ansprechpartners, interne Merkzettel..."
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            setDone(false);
          }}
        />
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={busy || text.trim() === saved.trim()}
            onClick={() => void save()}
          >
            {busy ? "Speichert …" : "Interne Notiz speichern"}
          </Button>
          {done && !busy && <span className="text-xs text-emerald-700">Gespeichert</span>}
        </div>
      </div>
    </details>
  );
}
