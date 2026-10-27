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
import { FeedbackState, StatusBadge } from "@/components/coldcaller/primitives";
import { LeadContact } from "@/components/coldcaller/workspace-parts";
import { LeadActions } from "@/components/caller/lead-actions";
import { Building2 } from "@/components/coldcaller/icons";
import { LeadContactEditor } from "@/components/caller/lead-contact-editor";
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
  leadIds,
  onNavigate,
}: {
  leadId: string | null;
  userId: string;
  /** Kept for the callers; the dialog no longer offers admin-only actions. */
  admin?: boolean;
  onClose: () => void;
  /** Leads of the list the dialog was opened from, in display order. After saving an outcome the dialog moves on to the next one. */
  leadIds?: string[];
  onNavigate?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const index = leadId && leadIds ? leadIds.indexOf(leadId) : -1;
  const previousId = index > 0 ? (leadIds?.[index - 1] ?? null) : null;
  const nextId = index >= 0 ? (leadIds?.[index + 1] ?? null) : null;
  const canNavigate = !!onNavigate && index >= 0;
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

  /** After an outcome was saved the dialog moves on to the next lead of the list (or the previous one at the end). */
  function afterAction(summary?: string) {
    refresh();
    if (!summary || !canNavigate) return;
    const target = nextId ?? previousId;
    if (!target) return;
    toast.success(summary);
    onNavigate?.(target);
  }
  async function reopen() {
    if (!lead) return;
    const { error } = await (backendEnabled
      ? supabase.rpc("reopen_lead", {
          p_request_id: crypto.randomUUID(),
          p_lead_id: lead.id,
          p_expected_version: lead.version,
          p_reason: "Manuell wieder geöffnet",
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
        {lead && (
          <div className="absolute right-14 top-4 flex h-8 items-center">
            <StatusBadge tone="info">
              {lead.status === "open" && lead.attempts > 0
                ? "Nicht erreicht"
                : (STATUS_LABEL[lead.status] ?? lead.status)}
            </StatusBadge>
          </div>
        )}
        <DialogHeader className="pr-32">
          <div className="flex items-center gap-4">
            <span
              className="grid size-14 shrink-0 place-items-center rounded-2xl bg-black/5"
              aria-hidden="true"
            >
              <Building2 size={28} />
            </span>
            <div className="min-w-0">
              <DialogTitle>{lead?.company || "Lead-Details"}</DialogTitle>
              <DialogDescription>Kontaktdaten und Gesprächsergebnis.</DialogDescription>
            </div>
          </div>
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
              {backendEnabled && (
                <LeadContactEditor
                  key={`${lead.id}-${lead.version}`}
                  lead={lead}
                  onSaved={refresh}
                />
              )}
            </div>
            {backendEnabled && (
              <LeadActions
                key={lead.id}
                lead={lead}
                userId={userId}
                callerName={callerName.data ?? ""}
                onDone={afterAction}
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
