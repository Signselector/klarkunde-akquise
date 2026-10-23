import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL } from "@/lib/leads";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/completed")({
  head: () => ({ meta: [{ title: "Erledigt – Cold Call Tool" }] }),
  component: CompletedPage,
});

function CompletedPage() {
  const { user } = Route.useRouteContext();
  const [mine, setMine] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["completed", mine],
    queryFn: async () => {
      let q = supabase.from("leads").select("*").in("status", ["no_interest", "appointment", "production"]).order("last_called_at", { ascending: false }).limit(300);
      if (mine) q = q.eq("last_called_by", user.id);
      return (await q).data ?? [];
    },
  });
  const groups = [
    ["Meine Kunden / Termine & Produktion", (data ?? []).filter((l) => l.status !== "no_interest")],
    ["Kein Interesse", (data ?? []).filter((l) => l.status === "no_interest")],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Kunden & erledigte Leads</h1>
        <div className="flex items-center gap-2"><Switch id="m" checked={mine} onCheckedChange={setMine} /><Label htmlFor="m">Nur von mir</Label></div>
      </div>
      {isLoading && <p className="text-muted-foreground">Lädt …</p>}
      {groups.map(([label, items]) => (
        <section key={label} className="space-y-2">
          <h2 className="font-semibold">{label} ({items.length})</h2>
          <div className="divide-y rounded-xl border bg-card">
            {items.length === 0 && <p className="p-3 text-sm text-muted-foreground">Keine Einträge.</p>}
            {items.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 p-3">
                <span>
                  <span className="block font-medium">{l.company || "Ohne Firmenname"}</span>
                  <span className="text-sm text-muted-foreground">{[l.contact_name, l.city, l.phone].filter(Boolean).join(" · ")}</span>
                </span>
                <Badge variant="secondary">{STATUS_LABEL[l.status]}</Badge>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
