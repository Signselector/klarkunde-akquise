import { backendEnabled } from "@/lib/backend";
import { useCountry } from "@/lib/country";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL } from "@/lib/leads";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FeedbackState, StatusBadge, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { LeadDialog } from "@/components/caller/lead-dialog";
import { LeadsTable } from "@/components/caller/leads-table";
import { CustomersBoard } from "@/components/caller/customers-board";

/** Order of the categories on "Abgeschlossene Leads". */
const GROUP_ORDER = [
  "Rückruf vereinbart",
  "In Bearbeitung",
  "Zukunftsprojekt",
  "Logo ausstehend",
  "Nicht erreicht",
  "Kein Interesse",
];
const groupRank = (label: string) => {
  const i = GROUP_ORDER.indexOf(label);
  return i === -1 ? GROUP_ORDER.length : i;
};

export function StatusLeadList({
  userId,
  title,
  statuses,
  customers = false,
}: {
  userId: string;
  title: string;
  statuses: string[];
  customers?: boolean;
}) {
  const country = useCountry();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const query = useQuery({
    queryKey: ["lead-list", userId, country, statuses],
    queryFn: async () => {
      let q = supabase
        .from("leads")
        .select("*,lead_batches!inner(country)")
        .eq("lead_batches.country", country)
        .eq("last_called_by", userId)
        .order("last_called_at", { ascending: false })
        .limit(300);
      if (backendEnabled) q = q.is("archived_at", null);
      if (customers) q = q.in("status", statuses);
      else
        q = q.or("status.neq.open,attempts.gt.0").not("status", "in", "(appointment,production)");
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
  const resultLabel = (status: string) =>
    !customers && status === "open" ? "Nicht erreicht" : (STATUS_LABEL[status] ?? status);
  const rows = (query.data ?? []).filter(
    (l) =>
      (!search ||
        [l.company, l.city, l.phone]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())) &&
      (filter === "all" || resultLabel(l.status) === filter),
  );
  const groups = [...new Set(rows.map((l) => resultLabel(l.status)))].sort(
    (a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b, "de"),
  );
  return (
    <div className="cc-page">
      <PageHeading
        title={title}
        description={
          customers
            ? "Deine bearbeiteten Kunden mit Kontaktdaten, Notizen und Verlauf."
            : "Deine bearbeiteten Kontakte nach Kategorie: Rückruf vereinbart, In Bearbeitung, Zukunftsprojekt, Logo ausstehend, Nicht erreicht, Kein Interesse."
        }
      />
      {customers && (
        <Surface
          title="Pipedrive-Stages"
          description="Anzeigenamen für die kommende CRM-Stage-Anbindung"
        >
          <div className="cc-surface-body">
            <div className="flex flex-wrap gap-2">
              {[
                "Logo ausstehend",
                "Zukunftsprojekt",
                "Logo Render",
                "Realismus Render",
                "Gewonnen",
              ].map((label) => (
                <StatusBadge key={label}>{label}</StatusBadge>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Die synchronisierte Stage und berechtigte Wechsel sind noch nicht verfügbar.
              Anrufergebnisse unten sind keine CRM-Stages. „Gewonnen“ fasst Andere Prozente,
              Produktionsplanung und 0% Anzahlung zusammen.
            </p>
          </div>
        </Surface>
      )}
      <Surface
        title={customers ? "Meine Kunden nach Ergebnis" : "Abgeschlossene Erstkontakte"}
        description="Bis zu 300 aktuelle Kontakte · ausgewähltes Land"
      >
        <div className="cc-surface-body">
          <div className="flex flex-wrap gap-3">
            <Input
              className="max-w-sm"
              aria-label="Kontakte suchen"
              placeholder="Firma, Stadt oder Telefon suchen"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              aria-label="Ergebnis filtern"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Alle Ergebnisse</option>
              {[...new Set((query.data ?? []).map((l) => resultLabel(l.status)))]
                .sort()
                .map((label) => (
                  <option key={label}>{label}</option>
                ))}
            </select>
          </div>
          {query.isLoading ? (
            <FeedbackState kind="loading" title="Kontakte werden geladen" />
          ) : query.isError ? (
            <FeedbackState
              kind="error"
              title="Kontakte nicht verfügbar"
              action={<Button onClick={() => query.refetch()}>Erneut versuchen</Button>}
            />
          ) : !rows.length && !customers ? (
            <FeedbackState kind="empty" title="Keine passenden Kontakte">
              Sobald du Kontakte bearbeitet hast, erscheinen sie hier.
            </FeedbackState>
          ) : customers ? (
            <CustomersBoard leads={rows} onOpen={setSelected} />
          ) : (
            <div className="space-y-5">
              {groups.map((group) => {
                const items = rows.filter((l) => resultLabel(l.status) === group);
                return (
                  <section key={group} aria-label={group}>
                    <h2 className="mb-2 font-semibold">
                      {group} ({items.length})
                    </h2>
                    <div className="overflow-hidden rounded-[10px] border">
                      <LeadsTable
                        leads={items}
                        onOpen={setSelected}
                        resultLabel={() => group}
                        processed
                      />
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </Surface>
      <LeadDialog
        leadId={selected}
        userId={userId}
        admin={false}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
