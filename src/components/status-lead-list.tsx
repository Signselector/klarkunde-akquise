import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL } from "@/lib/leads";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function StatusLeadList({ userId, title, statuses }: { userId: string; title: string; statuses: string[] }) {
  const [mine, setMine] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["lead-list", statuses, mine],
    queryFn: async () => {
      let q = supabase.from("leads").select("*").in("status", statuses).order("last_called_at", { ascending: false }).limit(300);
      if (mine) q = q.eq("last_called_by", userId);
      return (await q).data ?? [];
    },
  });
  const items = data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">{title} ({items.length})</h1>
        <div className="flex items-center gap-2"><Switch id="m" checked={mine} onCheckedChange={setMine} /><Label htmlFor="m">Nur von mir</Label></div>
      </div>
      {isLoading && <p className="text-muted-foreground">Lädt …</p>}
      <div className="divide-y rounded-xl border bg-card">
        {!isLoading && items.length === 0 && <p className="p-3 text-sm text-muted-foreground">Keine Einträge.</p>}
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
    </div>
  );
}
