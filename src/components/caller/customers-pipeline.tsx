import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { withViewAsRead } from "@/lib/view-as";
import { supabase } from "@/integrations/supabase/client";
import { useCountry } from "@/lib/country";
import { loadMyCustomers } from "@/lib/customers.functions";
import { crmErrorMessage } from "@/lib/crm-sync";
import { placeDeals, type CustomerDeal } from "@/lib/customer-stages";
import { Mail, Phone } from "@/components/coldcaller/icons";
import { FeedbackState, StatusBadge, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function since(iso: string | null) {
  if (!iso) return "Noch nicht kontaktiert";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return days === 0 ? "heute" : days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

/** Information only: the card does not open the customer file. */
function Card({ deal }: { deal: CustomerDeal }) {
  return (
    <li>
      <div className="w-full space-y-2 rounded-[10px] border bg-card p-3 text-left">
        <strong className="block break-words">{deal.company || "Ohne Firmenname"}</strong>
        {deal.contact_name && <span className="block text-sm">{deal.contact_name}</span>}
        <span className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{since(deal.last_called_at)}</span>
          <span className="flex gap-2">
            {deal.phone && <Phone size={14} aria-label="Telefon vorhanden" />}
            {deal.email && <Mail size={14} aria-label="E-Mail vorhanden" />}
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * "Meine Kunden": the caller's deals in their current Pipedrive stage. The stage is read from Pipedrive on every
 * refresh, so changes made there show up here. When Pipedrive cannot be read the last stage recorded in this tool
 * is shown and clearly marked.
 */
export function CustomersPipeline({ userId }: { userId: string }) {
  const country = useCountry();
  const load = useServerFn(loadMyCustomers);
  const [search, setSearch] = useState("");

  const mapping = useQuery({
    queryKey: ["stage-mapping", country],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipedrive_stage_mapping")
        .select("mapping")
        .eq("country", country)
        .maybeSingle();
      if (error) throw error;
      return (data?.mapping ?? {}) as Record<string, number>;
    },
  });
  const customers = useQuery({
    queryKey: ["customers", country, userId],
    queryFn: () => withViewAsRead(() => load({ data: { country } })),
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });

  const term = search.trim().toLocaleLowerCase();
  const deals = (customers.data?.deals ?? []).filter(
    (d) =>
      !term ||
      [d.company, d.contact_name, d.phone, d.email].join(" ").toLocaleLowerCase().includes(term),
  );
  const placed = placeDeals(deals, mapping.data ?? {}, country);
  const stageNames = customers.data?.stageNames ?? {};
  const fetchedAt = customers.data ? new Date(customers.data.fetchedAt) : null;
  const loading = customers.isLoading || mapping.isLoading;

  return (
    <div className="cc-page">
      <PageHeading
        title="Meine Kunden"
        description="Deine Deals mit der aktuellen Pipedrive-Stage. Änderungen in Pipedrive erscheinen nach dem Aktualisieren hier."
        action={
          <Button
            variant="outline"
            onClick={() => void customers.refetch()}
            disabled={customers.isFetching}
          >
            {customers.isFetching ? "Aktualisiert …" : "Aktualisieren"}
          </Button>
        }
      />
      <Surface
        title={`Pipedrive · ${country}`}
        description={
          fetchedAt
            ? `${customers.data?.deals.length ?? 0} Deals · Stand ${fetchedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`
            : "Deals werden geladen"
        }
      >
        <div className="cc-surface-body">
          <Input
            className="max-w-sm"
            aria-label="Kunden suchen"
            placeholder="Firma, Ansprechpartner, Telefon oder E-Mail suchen"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {customers.data?.error && (
            <div
              role="alert"
              className="rounded-[10px] border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <strong>Nicht mit Pipedrive synchronisiert.</strong>{" "}
              {crmErrorMessage(customers.data.error)} Angezeigt wird die zuletzt in diesem Tool
              gespeicherte Stage.
            </div>
          )}
          {customers.data?.truncated && (
            <p className="text-sm text-muted-foreground">
              Es werden die ersten 300 Deals angezeigt.
            </p>
          )}
          {loading ? (
            <FeedbackState kind="loading" title="Deals werden aus Pipedrive geladen" />
          ) : customers.isError ? (
            <FeedbackState
              kind="error"
              title="Kunden nicht verfügbar"
              action={<Button onClick={() => void customers.refetch()}>Erneut versuchen</Button>}
            />
          ) : (
            <>
              {!customers.data?.deals.length && (
                <FeedbackState kind="empty" title="Noch keine Deals">
                  Sobald du ein Gesprächsergebnis mit Pipedrive-Stage speicherst (zum Beispiel Logo
                  Render), erscheint der Deal hier.
                </FeedbackState>
              )}
              <div className="flex gap-3 overflow-x-auto pb-2">
                {placed.columns.map(({ column, stageIds, deals: items }) => (
                  <section
                    key={column.key}
                    aria-label={column.label}
                    className="w-64 shrink-0 rounded-[10px] border bg-muted/40 p-3"
                  >
                    <h3 className="flex items-center justify-between gap-2 px-1 pb-3 text-sm font-semibold">
                      {column.label}
                      <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                        {items.length}
                      </span>
                    </h3>
                    {!stageIds.length && (
                      <p className="px-1 pb-2 text-xs text-muted-foreground">
                        Stage nicht zugeordnet (Einstellungen → Stage Mapping)
                      </p>
                    )}
                    {items.length === 0 ? (
                      <p className="px-1 py-4 text-center text-sm text-muted-foreground">
                        Keine Kunden
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {items.map((d) => (
                          <Card key={d.deal_id} deal={d} />
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
                {placed.other.length > 0 && (
                  <section
                    aria-label="Weitere Stages"
                    className="w-64 shrink-0 rounded-[10px] border bg-muted/40 p-3"
                  >
                    <h3 className="flex items-center justify-between gap-2 px-1 pb-3 text-sm font-semibold">
                      Weitere Stages
                      <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                        {placed.other.length}
                      </span>
                    </h3>
                    <ul className="space-y-2">
                      {placed.other.map((d) => (
                        <div key={d.deal_id} className="space-y-1">
                          <Card deal={d} />
                          <StatusBadge tone="neutral">
                            {d.stage_id !== null && stageNames[d.stage_id]
                              ? stageNames[d.stage_id]
                              : "Stage unbekannt"}
                          </StatusBadge>
                        </div>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </>
          )}
        </div>
      </Surface>
    </div>
  );
}
