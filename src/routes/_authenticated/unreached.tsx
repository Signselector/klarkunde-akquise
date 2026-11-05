import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logListExport, useLogListView } from "@/lib/audit";
import { CountryCell, useListScope } from "@/components/country-scope";
import { unreachedCsv, type UnreachedLead } from "@/lib/unreached-csv";
import { FeedbackState, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchMatches } from "@/lib/phone";

export const Route = createFileRoute("/_authenticated/unreached")({
  head: () => ({ meta: [{ title: "Nicht erreicht – Sign Selector Cold Caller" }] }),
  component: UnreachedPage,
});

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Vienna" }) : "–";

function UnreachedPage() {
  const { user } = Route.useRouteContext();
  const { scope: country, bar, isStaff: staff, showCountryColumn } = useListScope(user.id, user.email);
  useLogListView("unreached", "Nicht erreicht", country, staff);
  const [search, setSearch] = useState("");
  const q = useQuery({
    enabled: staff,
    queryKey: ["unreached", country],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_unreached_leads", { p_country: country });
      if (error) throw error;
      return (data ?? []) as unknown as UnreachedLead[];
    },
  });
  if (!staff) return <p className="text-muted-foreground">Diese Liste ist nur für Admins und Manager.</p>;
  const rows = (q.data ?? []).filter(
    (r) => searchMatches(search, [r.company, r.contact_name, r.email, r.city, r.caller, r.batch], r.phone),
  );
  function download() {
    logListExport("unreached", "Nicht erreicht", country, rows.length);
    const blob = new Blob([unreachedCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nicht-erreicht-${country}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="cc-page">
      <PageHeading
        title="Nicht erreicht"
        description="Leads, die 20 Tage lang nicht erreicht wurden. Sie sind bei den Callern nicht mehr unter Offene Leads. Als Liste herunterladbar und über Upload wieder ins Tool einspielbar."
      />
      <Surface
        title="Nicht erreichte Leads"
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
            placeholder="Firma, Kontakt, Telefon, Caller, Batch suchen"
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
              Sobald ein Lead 20 Tage lang als „Nicht erreicht“ unter Offene Leads lag, erscheint er hier.
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
                      "Batch",
                      "Caller",
                      "Versuche",
                      "Letzter Versuch",
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
                      <td className="px-3 py-3">{r.batch || "–"}</td>
                      <td className="px-3 py-3">{r.caller || "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{r.attempts}</td>
                      <td className="px-3 py-3">{when(r.last_attempt_at)}</td>
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
