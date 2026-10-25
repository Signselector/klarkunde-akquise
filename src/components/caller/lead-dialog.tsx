import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { backendEnabled } from "@/lib/backend";
import { STATUS_LABEL } from "@/lib/leads";
import { useServerFn } from "@tanstack/react-start";
import { syncLeadAction } from "@/lib/crm-sync.functions";
import { crmErrorMessage } from "@/lib/crm-sync";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FeedbackState, StatusBadge } from "@/components/coldcaller/primitives";
import { LeadContact } from "@/components/coldcaller/workspace-parts";
import { LeadActions } from "@/components/caller/lead-actions";
import { ACTION_LABEL } from "@/lib/lead-actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function LeadDialog({
  leadId,
  userId,
  onClose,
}: {
  leadId: string | null;
  userId: string;
  /** Kept for the callers; the dialog no longer offers admin-only actions. */
  admin?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const note = leadId ? (drafts[leadId] ?? "") : "";
  const setNote = (value: string) => {
    if (leadId) setDrafts((current) => ({ ...current, [leadId]: value }));
  };
  const { data, isLoading, isError, refetch } = useQuery({
    enabled: !!leadId,
    queryKey: ["lead-detail", leadId],
    queryFn: async () => {
      const [l, n, s, act] = await Promise.all([
        supabase.from("leads").select("*").eq("id", leadId!).maybeSingle(),
        supabase
          .from("lead_notes")
          .select("*")
          .eq("lead_id", leadId!)
          .order("created_at", { ascending: false }),
        supabase
          .from("status_changes")
          .select("*")
          .eq("lead_id", leadId!)
          .order("created_at", { ascending: false }),
        backendEnabled
          ? supabase
              .from("lead_actions")
              .select("*")
              .eq("lead_id", leadId!)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);
      // The action history is optional: before migration 0010 the table does not exist yet.
      const error = [l.error, n.error, s.error].find(Boolean);
      if (error) throw error;
      return {
        lead: l.data,
        notes: n.data ?? [],
        history: s.data ?? [],
        actions: act.data ?? [],
      };
    },
  });
  const callerName = useQuery({
    enabled: !!leadId && backendEnabled,
    queryKey: ["profile-name", userId],
    queryFn: async () =>
      (await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle()).data
        ?.display_name ?? "",
  });
  const sync = useServerFn(syncLeadAction);
  const [retrying, setRetrying] = useState<string | null>(null);
  async function retry(actionId: string) {
    setRetrying(actionId);
    try {
      const result = await sync({ data: { actionId } });
      if (result.state === "error")
        toast.error(crmErrorMessage(result.error) || "Übertragung fehlgeschlagen.");
      else toast.success("An Pipedrive übertragen.");
    } catch {
      toast.error("Übertragung fehlgeschlagen. Bitte später erneut versuchen.");
    } finally {
      setRetrying(null);
      refresh();
    }
  }
  const lead = data?.lead;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lead-detail", leadId] });
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["batches"] });
    qc.invalidateQueries({ queryKey: ["lead-list"] });
  };

  async function addNote() {
    if (!note.trim() || !leadId) return;
    const { error } = await supabase
      .from("lead_notes")
      .insert({ lead_id: leadId, user_id: userId, body: note.trim() });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNote("");
    refresh();
  }
  async function reopen() {
    if (!lead) return;
    const { error } = await (backendEnabled
      ? supabase.rpc("reopen_lead", {
          p_request_id: crypto.randomUUID(),
          p_lead_id: lead.id,
          p_expected_version: lead.version,
          p_reason: note.trim() || "Manuell wieder geöffnet",
        })
      : supabase.from("leads").update({ status: "open" }).eq("id", lead.id));
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!backendEnabled)
      await supabase
        .from("status_changes")
        .insert({ lead_id: lead.id, user_id: userId, old_status: lead.status, new_status: "open" });
    toast.success("Lead wieder geöffnet.");
    refresh();
  }
  return (
    <Dialog open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="cc-theme cc-detail-dialog">
        <DialogHeader>
          <DialogTitle>{lead?.company || "Lead-Details"}</DialogTitle>
          <DialogDescription>Kontaktdaten, Notizen und bisherige Bearbeitung.</DialogDescription>
        </DialogHeader>
        {isLoading && <FeedbackState kind="loading" title="Kundenakte wird geladen" />}
        {isError && (
          <FeedbackState
            kind="error"
            title="Kundenakte nicht verfügbar"
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Erneut versuchen
              </Button>
            }
          />
        )}
        {!isLoading && !isError && !lead && (
          <FeedbackState kind="empty" title="Lead nicht mehr verfügbar">
            Die Liste wurde möglicherweise inzwischen geändert.
          </FeedbackState>
        )}
        {lead && (
          <>
            <div className="space-y-1 text-sm">
              <p>{[lead.contact_name, lead.city].filter(Boolean).join(" · ")}</p>
              <LeadContact
                phone={lead.phone}
                email={lead.email}
                city={lead.city}
                extra={(lead.extra ?? {}) as Record<string, unknown>}
              />
              <p>
                <StatusBadge tone="info">{STATUS_LABEL[lead.status] ?? lead.status}</StatusBadge> ·
                Versuche: {lead.attempts}
              </p>
            </div>
            {backendEnabled && (
              <LeadActions
                key={lead.id}
                lead={lead}
                userId={userId}
                callerName={callerName.data ?? ""}
                onDone={refresh}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {lead.status !== "open" && (
                <Button size="sm" onClick={reopen}>
                  Wieder öffnen
                </Button>
              )}
            </div>
            <div className="cc-detail-section">
              <label htmlFor="lead-note" className="cc-field-label">
                Notizen
              </label>
              <Textarea
                id="lead-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Neue Notiz …"
              />
              <Button size="sm" onClick={addNote} disabled={!note.trim()}>
                Notiz speichern
              </Button>
              {data?.notes.map((n) => (
                <p key={n.id} className="cc-note-item">
                  <time dateTime={n.created_at}>
                    {new Date(n.created_at).toLocaleString("de-DE")}
                  </time>
                  {n.body}
                </p>
              ))}
            </div>
            <div className="cc-detail-section">
              <h3>Verlauf</h3>
              <ul className="cc-history">
                {data?.actions.map((a) => (
                  <li key={a.id}>
                    {new Date(a.created_at).toLocaleString("de-DE")}:{" "}
                    {ACTION_LABEL[a.action] ?? a.action}
                    {a.crm_sync_state === "queued" && " · für Pipedrive vorgemerkt"}
                    {a.crm_sync_state === "syncing" && " · wird an Pipedrive übertragen"}
                    {a.crm_sync_state === "synced" && " · in Pipedrive angelegt"}
                    {a.crm_sync_state === "simulated" &&
                      " · Testmodus, nicht an Pipedrive gesendet"}
                    {a.crm_sync_state === "error" &&
                      ` · Pipedrive-Übertragung fehlgeschlagen: ${crmErrorMessage(a.crm_error) || "Fehler"}`}
                    {(a.crm_sync_state === "error" || a.crm_sync_state === "queued") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2"
                        disabled={retrying === a.id}
                        onClick={() => void retry(a.id)}
                      >
                        {retrying === a.id ? "Läuft …" : "Erneut übertragen"}
                      </Button>
                    )}
                  </li>
                ))}
                {data?.history.map((h) => (
                  <li key={h.id}>
                    {new Date(h.created_at).toLocaleString("de-DE")}:{" "}
                    {STATUS_LABEL[h.old_status ?? ""] ?? h.old_status ?? "–"} →{" "}
                    {STATUS_LABEL[h.new_status] ?? h.new_status}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
