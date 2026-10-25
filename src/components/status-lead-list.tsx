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
      else q = q.or("status.neq.open,attempts.gt.0").neq("status", "callback");
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
  const groups = [...new Set(rows.map((l) => resultLabel(l.status)))].sort();
  return (
    <div className="cc-page">
      <PageHeading
        title={title}
        description={
          customers
            ? "Deine bearbeiteten Kunden mit Kontaktdaten, Notizen und Verlauf."
            : "Deine bearbeiteten Kontakte, nach dem aktuellen Anrufergebnis gruppiert. Rückrufe findest du separat."
        }
      />
      {customers && (
        <Surface
          title="Pipedrive-Stages"
          description="Anzeigenamen für die kommende CRM-Stage-Anbindung"
        >
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
        </Surface>
      )}
      <Surface
        title={customers ? "Meine Kundenakte" : "Abgeschlossene Erstkontakte"}
        description="Bis zu 300 aktuelle Kontakte · ausgewähltes Land"
      >
        <div className="flex flex-wrap gap-3 pb-4">
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
        ) : !rows.length ? (
          <FeedbackState kind="empty" title="Keine passenden Kontakte">
            Sobald du Kontakte bearbeitet hast, erscheinen sie hier.
          </FeedbackState>
        ) : (
          groups.map((group) => (
            <section key={group} className="mb-5">
              <h2 className="mb-2 font-semibold">{group}</h2>
              <div className="divide-y rounded-xl border">
                {rows
                  .filter((l) => resultLabel(l.status) === group)
                  .map((l) => (
                    <button
                      key={l.id}
                      className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-muted focus-visible:outline-2"
                      onClick={() => setSelected(l.id)}
                    >
                      <span>
                        <strong className="block">{l.company || "Ohne Firmenname"}</strong>
                        <span className="text-sm text-muted-foreground">
                          {[l.contact_name, l.city, l.phone].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <StatusBadge>{group}</StatusBadge>
                    </button>
                  ))}
              </div>
            </section>
          ))
        )}
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
