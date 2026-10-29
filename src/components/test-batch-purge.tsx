import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { purgeTestBatch } from "@/lib/test-batch.functions";
import { Button } from "@/components/ui/button";

type Country = "AT" | "DE";
const NAMES: Record<Country, string> = { AT: "Österreich", DE: "Deutschland" };

/** Lists the batches of AT or DE and deletes one completely, including its deals and contacts in that Pipedrive account. */
export function TestBatchPurge() {
  const qc = useQueryClient();
  const purge = useServerFn(purgeTestBatch);
  const [country, setCountry] = useState<Country>("AT");
  const [busy, setBusy] = useState<string | null>(null);
  const batches = useQuery({
    queryKey: ["purge-batches", country],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_batches")
        .select("id,name,created_at,leads(count)")
        .eq("country", country)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function run(id: string, name: string) {
    if (
      !confirm(
        `„${name}“ (${country}) restlos löschen? Alle Leads, Verläufe, Termine sowie die Deals, Personen und Organisationen in Pipedrive ${country} werden entfernt.`,
      )
    )
      return;
    setBusy(id);
    try {
      const r = await purge({ data: { batchId: id } });
      if (!r.ok) {
        toast.error(
          `In Pipedrive konnte nicht alles gelöscht werden (${r.failed.length} Fehler). In der App wurde nichts gelöscht – bitte erneut versuchen.`,
        );
        console.error(r.failed);
      } else {
        toast.success(`Gelöscht: ${r.leads} Leads, ${r.removed} Einträge in Pipedrive.`);
      }
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Test-Batches restlos löschen</h2>
          <p className="text-sm text-muted-foreground">
            Löscht den Batch hier und alles, was daraus in Pipedrive {country} entstanden ist.
          </p>
        </div>
        <div className="flex gap-1">
          {(["AT", "DE"] as Country[]).map((c) => (
            <Button
              key={c}
              size="sm"
              variant={country === c ? "default" : "outline"}
              disabled={busy !== null}
              onClick={() => setCountry(c)}
            >
              {NAMES[c]}
            </Button>
          ))}
        </div>
      </div>
      {batches.data?.length ? (
        <ul className="divide-y text-sm">
          {batches.data.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {b.name}{" "}
                <span className="text-muted-foreground">
                  · {(b.leads as unknown as { count: number }[])[0]?.count ?? 0} Leads
                </span>
              </span>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy !== null}
                onClick={() => run(b.id, b.name)}
              >
                {busy === b.id ? "Lösche…" : "Restlos löschen"}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Keine {country}-Batches vorhanden.</p>
      )}
    </section>
  );
}
