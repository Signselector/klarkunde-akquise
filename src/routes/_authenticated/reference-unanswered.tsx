import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CountryCell, useListScope } from "@/components/country-scope";
import { unansweredCsv, type UnansweredLead } from "@/lib/reference-unanswered-csv";
import { FeedbackState, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/reference-unanswered")({
  head: () => ({ meta: [{ title: "Referenzmail ohne Antwort – Sign Selector Cold Caller" }] }),
  component: ReferenceUnansweredPage,
});

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Vienna" }) : "–";

function ReferenceUnansweredPage() {
  const { user } = Route.useRouteContext();
  // Managers: their country. Global admins: a country or all countries.
  const { scope: country, bar, isStaff: staff, showCountryColumn } = useListScope(user.id, user.email);
  const [search, setSearch] = useState("");
  const q = useQuery({
    enabled: staff,
    queryKey: ["reference-unanswered", country],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_unanswered_reference_leads", {
        p_country: country,
      });
      if (error) throw error;
      return (data ?? []) as unknown as UnansweredLead[];
    },
  });
  if (!staff)
    return <p className="text-muted-foreground">Diese Liste ist nur für Admins und Manager.</p>;
  const rows = (q.data ?? []).filter(
    (r) =>
      !search ||
      [r.company, r.contact_name, r.phone, r.email, r.city, r.caller, r.caller_id]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  function download() {
    const blob = new Blob([unansweredCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `referenzmail-ohne-antwort-${country}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="cc-page">
      <PageHeading
        title="Referenzmail ohne Antwort"
        description="Leads, die auf die Referenzmail seit mehr als 3 Monaten nicht geantwortet haben. Jede Zeile enthält die ID des ursprünglichen Callers, damit der Lead wieder an ihn gehen kann."
      />
      <Surface
        title="Ohne Antwort seit 3 Monaten"
        description={`${country === "ALL" ? "Alle Länder" : country} · ${q.data?.length ?? 0} Leads`}
        action={
          <Button variant="outline" onClick={download} disabled={!rows.length}>
            CSV herunterladen
          </Button>
        }
      >
        <div className="cc-surface-body">
          {bar}
          <Input
            className="max-w-sm"
            aria-label="Leads suchen"
            placeholder="Firma, Kontakt, Telefon, Caller suchen"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {q.isLoading ? (
            <FeedbackState kind="loading" title="Liste wird geladen" />
          ) : q.isError ? (
            <FeedbackState
              kind="error"
              title="Liste nicht verfügbar"
              action={<Button onClick={() => q.refetch()}>Erneut versuchen</Button>}
            />
          ) : !rows.length ? (
            <FeedbackState kind="empty" title="Keine Leads">
              Sobald eine Referenzmail 3 Monate ohne Antwort geblieben ist, erscheint der Lead hier.
            </FeedbackState>
          ) : (
            <div className="overflow-x-auto rounded-[10px] border">
              <table className="w-full min-w-max whitespace-nowrap text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    {[
                      ...(showCountryColumn ? ["Land"] : []),
                      "Firma",
                      "Kontakt",
                      "Telefon",
                      "E-Mail",
                      "Stadt",
                      "Caller",
                      "Caller-ID",
                      "Mail gesendet",
                      "Betreff",
                    ].map((h) => (
                      <th key={h} className="px-3 py-3 font-medium first:px-4">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.lead_id} className="align-top">
                      {showCountryColumn && (

                        <td className="px-4 py-3">

                          <CountryCell code={r.country} />

                        </td>

                      )}
                      <td className="px-4 py-3 font-medium">{r.company || "–"}</td>
                      <td className="px-3 py-3">{r.contact_name || "–"}</td>
                      <td className="px-3 py-3">{r.phone || "–"}</td>
                      <td className="px-3 py-3">{r.email || "–"}</td>
                      <td className="px-3 py-3">{r.city || "–"}</td>
                      <td className="px-3 py-3">{r.caller || "–"}</td>
                      <td className="px-3 py-3 font-mono text-xs">{r.caller_id || "–"}</td>
                      <td className="px-3 py-3">{when(r.sent_at)}</td>
                      <td className="max-w-[24rem] truncate px-3 py-3" title={r.subject ?? ""}>
                        {r.subject || "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Surface>
    </div>
  );
}
