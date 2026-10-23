import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Übersicht – Cold Call Tool" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: batches, isLoading } = useQuery({
    queryKey: ["batches"],
    queryFn: async () => {
      const { data } = await supabase.from("lead_batches").select("id,name,created_at").order("created_at", { ascending: false });
      return Promise.all(
        (data ?? []).map(async (b) => {
          const [t, o] = await Promise.all([
            supabase.from("leads").select("id", { count: "exact", head: true }).eq("batch_id", b.id),
            supabase.from("leads").select("id", { count: "exact", head: true }).eq("batch_id", b.id).eq("status", "open"),
          ]);
          const total = t.count ?? 0;
          return { ...b, total, done: total - (o.count ?? 0) };
        }),
      );
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Lead Batches</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link to="/import">CSV importieren</Link></Button>
          <Button asChild><Link to="/call">Anrufen starten</Link></Button>
        </div>
      </div>
      {isLoading && <p className="text-muted-foreground">Lädt …</p>}
      {batches?.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          Noch keine Leads. Importiere eine CSV-Datei, um loszulegen.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {batches?.map((b) => {
          const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
          return (
            <div key={b.id} className="space-y-2 rounded-xl border bg-card p-4">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{b.name}</span>
                <span className="text-sm text-muted-foreground">{new Date(b.created_at).toLocaleDateString("de-DE")}</span>
              </div>
              <Progress value={pct} />
              <p className="text-sm text-muted-foreground">
                {b.done} von {b.total} bearbeitet ({pct} %)
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
