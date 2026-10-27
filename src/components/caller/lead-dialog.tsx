import { useState } from "react";
import { createPortal } from "react-dom";
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
import { ACTION_LABEL } from "@/lib/lead-actions";
import { ChevronLeft, ChevronRight } from "@/components/coldcaller/icons";
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
  /** Leads of the list the dialog was opened from, in display order. Enables the arrows and "next lead" after saving. */
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
  const open = !!leadId;
  return (
    <Dialog open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="cc-theme cc-detail-dialog">
        <DialogHeader>
          <DialogTitle>{lead?.company || "Lead-Details"}</DialogTitle>
          <DialogDescription>Kontaktdaten und Gesprächsergebnis.</DialogDescription>
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
                <StatusBadge tone="info">{STATUS_LABEL[lead.status] ?? lead.status}</StatusBadge>
              </p>
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
      {open && canNavigate && (
        <LeadArrows
          previous={previousId}
          next={nextId}
          position={index + 1}
          total={leadIds?.length ?? 0}
          onNavigate={(id) => onNavigate?.(id)}
        />
      )}
    </Dialog>
  );
}

/**
 * Arrows left and right of the dialog to go to the previous or next lead of the list. Rendered outside the dialog
 * (its content scrolls), so they are portaled to the page and stay clickable although the dialog is modal.
 */
function LeadArrows({
  previous,
  next,
  position,
  total,
  onNavigate,
}: {
  previous: string | null;
  next: string | null;
  position: number;
  total: number;
  onNavigate: (id: string) => void;
}) {
  if (typeof document === "undefined") return null;
  const base =
    "pointer-events-auto fixed z-[60] grid size-12 place-items-center rounded-full border bg-white text-foreground shadow-lg transition-colors hover:bg-[#2b2f36] hover:text-white disabled:pointer-events-none disabled:opacity-30 max-sm:bottom-3 sm:top-1/2 sm:-translate-y-1/2";
  return createPortal(
    <>
      <button
        type="button"
        aria-label={`Vorheriger Lead (${position} von ${total})`}
        title="Vorheriger Lead"
        disabled={!previous}
        onClick={() => previous && onNavigate(previous)}
        className={`${base} max-sm:left-3 sm:left-[max(8px,calc(50%-325px-64px))]`}
      >
        <ChevronLeft size={22} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Nächster Lead (${position} von ${total})`}
        title="Nächster Lead"
        disabled={!next}
        onClick={() => next && onNavigate(next)}
        className={`${base} max-sm:right-3 sm:right-[max(8px,calc(50%-325px-64px))]`}
      >
        <ChevronRight size={22} aria-hidden="true" />
      </button>
    </>,
    document.body,
  );
}
