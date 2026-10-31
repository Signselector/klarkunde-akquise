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
import { ShowroomResults, type ShowroomAppointment } from "@/components/caller/showroom-results";
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
function Fold({ enabled, title, children }: { enabled: boolean; title: string; children: React.ReactNode }) {
  if (!enabled)
    return (
      <div className="cc-detail-section">
        <h3>{title}</h3>
        {children}
      </div>
    );
  return (
    <details className="cc-detail-section cc-fold">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

export function LeadDialog({
  leadId,
  userId,
  onClose,
  leadIds,
  onNavigate,
  appointment,
  foldHistory = false,
}: {
  /** Completed leads: notes and history are folded and open on click. */
  foldHistory?: boolean;
  /** Opened from an appointment: shows the showroom results instead of the call results. */
  appointment?: ShowroomAppointment | null;
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
  const noteEntries = [
    ...(data?.actions ?? [])
      .filter((a) => a.note?.trim())
      .map((a) => ({ id: `a${a.id}`, at: a.created_at, label: ACTION_LABEL[a.action] ?? a.action, text: a.note as string })),
    ...(data?.notes ?? []).map((n) => ({ id: `n${n.id}`, at: n.created_at, label: "", text: n.body })),
  ].sort((x, y) => y.at.localeCompare(x.at));
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
              className="cc-detail-avatar grid size-14 shrink-0 place-items-center rounded-2xl"
              aria-hidden="true"
            >
              <Building2 size={28} />
            </span>
            <div className="min-w-0">
              <DialogTitle>{lead?.company || "Lead-Details"}</DialogTitle>
              <DialogDescription>
                {appointment ? "Kontaktdaten und Showroom-Ergebnis." : "Kontaktdaten und Gesprächsergebnis."}
              </DialogDescription>
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
            {backendEnabled && appointment && (
              <ShowroomResults
                key={appointment.id}
                appointment={appointment}
                onDone={() => {
                  refresh();
                  onClose();
                }}
              />
            )}
            {backendEnabled && !appointment && (
              <LeadActions
                key={lead.id}
                lead={lead}
                userId={userId}
                callerName={callerName.data ?? ""}
                onDone={afterAction}
              />
            )}
            {foldHistory && (
              <details className="cc-detail-section cc-fold">
                <summary className="cursor-pointer font-semibold">
                  {`Notizen (${noteEntries.length})`}
                </summary>
                {noteEntries.length === 0 ? (
                  <p className="pt-2 text-sm text-muted-foreground">Keine Notizen vorhanden.</p>
                ) : (
                  <ul className="cc-history pt-2">
                    {noteEntries.map((n) => (
                      <li key={n.id}>
                        <span className="text-muted-foreground">
                          {new Date(n.at).toLocaleString("de-DE")}
                          {n.label ? ` · ${n.label}` : ""}:
                        </span>{" "}
                        <span className="whitespace-pre-wrap break-words">{n.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}
            <Fold enabled={foldHistory} title="Verlauf">
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
            </Fold>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
