import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL } from "@/lib/leads";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/stats")({
  head: () => ({ meta: [{ title: "Statistiken – Cold Call Tool" }] }),
  component: StatsPage,
});

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 text-muted-foreground">{i.label}</span>
          <div className="h-5 flex-1 rounded bg-muted"><div className="h-5 rounded bg-primary" style={{ width: `${(i.value / max) * 100}%` }} /></div>
          <span className="w-8 text-right tabular-nums">{i.value}</span>
        </div>
      ))}
    </div>
  );
}

function StatsPage() {
  const { user } = Route.useRouteContext();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [range, setRange] = useState<"today" | "30">("30");
  const { data } = useQuery({
    queryKey: ["stats", scope, range],
    queryFn: async () => {
      const from = new Date();
      if (range === "today") from.setHours(0, 0, 0, 0); else from.setDate(from.getDate() - 30);
      let sc = supabase.from("status_changes").select("new_status,created_at,user_id").gte("created_at", from.toISOString()).limit(5000);
      if (scope === "mine") sc = sc.eq("user_id", user.id);
      const [changes, total, open] = await Promise.all([
        sc,
        supabase.from("leads").select("id", { count: "exact", head: true }),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "open"),
      ]);
      return { changes: changes.data ?? [], total: total.count ?? 0, open: open.count ?? 0 };
    },
  });
  const ch = data?.changes ?? [];
  const calls = ch.length;
  const count = (s: string) => ch.filter((c) => c.new_status === s).length;
  const reached = calls - count("not_reached") - count("open");
  const byStatus = ["not_reached", "no_interest", "callback", "appointment", "production"].map((s) => ({ label: STATUS_LABEL[s] ?? s, value: count(s) }));
  const byDay = WEEKDAYS.map((label, d) => ({ label, value: ch.filter((c) => new Date(c.created_at).getDay() === d).length }));
  const tiles = [
    ["Anrufe", calls],
    ["Erreicht", reached],
    ["Termine", count("appointment")],
    ["Terminquote", calls ? `${Math.round((count("appointment") / calls) * 100)} %` : "–"],
    ["Offene Leads", data?.open ?? 0],
    ["Leads gesamt", data?.total ?? 0],
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Statistiken</h1>
        <div className="flex gap-2">
          <Tabs value={scope} onValueChange={(v) => setScope(v as "mine" | "all")}><TabsList><TabsTrigger value="mine">Meine</TabsTrigger><TabsTrigger value="all">Team</TabsTrigger></TabsList></Tabs>
          <Tabs value={range} onValueChange={(v) => setRange(v as "today" | "30")}><TabsList><TabsTrigger value="today">Heute</TabsTrigger><TabsTrigger value="30">30 Tage</TabsTrigger></TabsList></Tabs>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([l, v]) => (
          <div key={l as string} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{l}</p><p className="font-display text-3xl font-bold">{v}</p></div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2 rounded-xl border bg-card p-4"><h2 className="font-semibold">Ergebnisse</h2><Bars items={byStatus} /></section>
        <section className="space-y-2 rounded-xl border bg-card p-4"><h2 className="font-semibold">Anrufe pro Wochentag</h2><Bars items={byDay} /></section>
      </div>
    </div>
  );
}
