import { backendEnabled } from "@/lib/backend";
import { useCountry } from "@/lib/country";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ACTION_LABEL } from "@/lib/lead-actions";
import { stageLabel } from "@/lib/crm-stage-labels";
import { STATUS_LABEL } from "@/lib/leads";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRoles } from "@/lib/use-admin";
import { FeedbackState, StatusBadge, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { LeadDialog } from "@/components/caller/lead-dialog";
import { Dropdown } from "@/components/ui/dropdown";

export type CompletedLead = {
  lead_id: string;
  company: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  origin_caller_name: string | null;
  action: string | null;
  crm_stage_key: string | null;
  deal_id: number | null;
  deal_status: string | null;
  sync_state: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
};

const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("de-DE", {
        timeZone: "Europe/Vienna",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "–";

const SYNC_LABEL: Record<string, string> = {
  pending: "Ausstehend",
  syncing: "Wird übertragen",
  synced: "Synchronisiert",
  failed: "Fehlgeschlagen",
};

export function StatusLeadList({ userId, title }: { userId: string; title: string }) {
  const country = useCountry();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  // Only managers and admins may open the customer file of a completed lead.
  const roles = useRoles(userId);
  const canOpen = roles.ready && roles.isStaff;
  const [filter, setFilter] = useState("all");
  const query = useQuery({
    queryKey: ["lead-list", userId, country],
    queryFn: async (): Promise<CompletedLead[]> => {
      if (backendEnabled) {
        const { data, error } = await supabase.rpc("get_completed_overview", {
          p_country: country,
          p_limit: 300,
        });
        if (error) throw error;
        return (data ?? []) as unknown as CompletedLead[];
      }
      const { data, error } = await supabase
        .from("leads")
        .select("*,lead_batches!inner(country)")
        .eq("lead_batches.country", country)
        .eq("last_called_by", userId)
        .not("status", "in", "(open,callback)")
        .order("last_called_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((l) => ({
        lead_id: l.id,
        company: l.company,
        contact_name: l.contact_name,
        phone: l.phone,
        email: l.email,
        status: l.status,
        origin_caller_name: null,
        action: l.status,
        crm_stage_key: null,
        deal_id: null,
        deal_status: null,
        sync_state: null,
        completed_at: l.last_called_at,
        last_activity_at: l.last_called_at,
      }));
    },
  });
  const actionName = (l: CompletedLead) =>
    ACTION_LABEL[l.action ?? ""] ?? STATUS_LABEL[l.status] ?? l.status;
  const rows = (query.data ?? []).filter(
    (l) =>
      (!search ||
        [l.company, l.contact_name, l.phone, l.email]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())) &&
      (filter === "all" || actionName(l) === filter),
  );
  return (
    <div className="cc-page">
      <PageHeading
        title={title}
        description="Alle abgeschlossenen Leads mit Aktion, ursprünglichem Caller und aktuellem CRM-Stand. Der Verlauf bleibt erhalten, auch wenn sich der Deal weiterbewegt."
      />
      <Surface
        title="Abgeschlossene Erstkontakte"
        description="Bis zu 300 aktuelle Kontakte · ausgewähltes Land"
      >
        <div className="cc-surface-body">
          <div className="flex flex-wrap gap-3">
            <Input
              className="max-w-sm"
              aria-label="Kontakte suchen"
              placeholder="Firma, Kontakt, Telefon oder E-Mail suchen"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Dropdown
              ariaLabel="Aktion filtern"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "Alle Aktionen" },
                ...[...new Set((query.data ?? []).map(actionName))].sort().map((label) => ({ value: label, label })),
              ]}
            />
          </div>
          {query.isLoading ? (
            <FeedbackState kind="loading" title="Kontakte werden geladen" />
          ) : query.isError ? (
            <FeedbackState
              kind="error"
              title="Kontakte nicht verfügbar"
              action={<Button onClick={() => query.refetch()}>Erneut versuchen</Button>}
            />
          ) : !rows.length ? (
            <FeedbackState kind="empty" title="Keine passenden Kontakte">
              Sobald du Leads abgeschlossen hast, erscheinen sie hier.
            </FeedbackState>
          ) : (
            <div className="overflow-x-auto rounded-[10px] border">
              <table className="w-full min-w-max whitespace-nowrap text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    {[
                      "Firma",
                      "Kontakt",
                      "Ursprünglicher Caller",
                      "Aktion",
                      "CRM-Stage",
                      "Deal-ID",
                      "Abgeschlossen",
                      "Letzte Aktivität",
                    ].map((h) => (
                      <th key={h} className="px-3 py-3 font-medium first:px-4">
                        {h}
                      </th>
                    ))}
                    {canOpen && (
                      <th className="sticky right-0 bg-[#faf8f4] px-4 py-3 text-right font-medium">
                        <span className="sr-only">Aktionen</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((l) => (
                    <tr key={l.lead_id} className="align-top hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{l.company || "Ohne Firmenname"}</td>
                      <td className="px-3 py-3">
                        <div className="flex min-w-[11rem] max-w-[18rem] flex-col gap-1">
                          {l.contact_name && <span className="truncate">{l.contact_name}</span>}
                          <span className="truncate text-muted-foreground">
                            {l.phone || "Keine Nummer"}
                          </span>
                          {l.email && (
                            <span className="truncate text-muted-foreground">{l.email}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">{l.origin_caller_name || "–"}</td>
                      <td className="px-3 py-3">
                        <StatusBadge tone="info">{actionName(l)}</StatusBadge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <span>{stageLabel(l.crm_stage_key)}</span>
                          {l.sync_state && l.sync_state !== "synced" && (
                            <span className="text-xs text-muted-foreground">
                              {SYNC_LABEL[l.sync_state] ?? l.sync_state}
                            </span>
                          )}
                          {l.deal_status === "won" && (
                            <span className="text-xs text-emerald-700">Gewonnen</span>
                          )}
                          {l.deal_status === "lost" && (
                            <span className="text-xs text-destructive">Verloren</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums">{l.deal_id ?? "–"}</td>
                      <td className="px-3 py-3">{when(l.completed_at)}</td>
                      <td className="px-3 py-3">{when(l.last_activity_at)}</td>
                      {canOpen && (
                        <td className="cc-sticky-action sticky right-0 px-4 py-3 text-right">
                          <button
                            type="button"
                            className="cc-record-btn"
                            onClick={() => setSelected(l.lead_id)}
                            aria-label={`Kundenakte ${l.company || "Ohne Firmenname"} öffnen`}
                          >
                            Kundenakte
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Surface>
      {canOpen && (
        <LeadDialog
          leadId={selected}
          userId={userId}
          admin={roles.isGlobalAdmin}
          foldHistory
          leadIds={rows.map((l) => l.lead_id)}
          onNavigate={setSelected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
