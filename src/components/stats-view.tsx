import { backendEnabled, backendRpc } from "@/lib/backend";
import { useIsAdmin } from "@/lib/use-admin";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL } from "@/lib/leads";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 text-muted-foreground">{i.label}</span>
          <div className="h-5 flex-1 rounded bg-muted">
            <div
              className="h-5 rounded bg-primary"
              style={{ width: `${(i.value / max) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right tabular-nums">{i.value}</span>
        </div>
      ))}
    </div>
  );
}

export type StatsMode = "overview" | "daily";

export function StatsView({
  userId,
  mode,
  title,
}: {
  userId: string;
  mode: StatsMode;
  title: string;
}) {
  const admin = useIsAdmin(userId);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [range, setRange] = useState<"today" | "30">(mode === "daily" ? "today" : "30");
  type Summary = {
    attempts: number;
    reached: number;
    appointments: number;
    production: number;
    not_reached: number;
    no_interest: number;
    callback: number;
    daily: { day: string; attempts: number }[];
  };
  const effectiveScope = backendEnabled && !admin ? "mine" : scope;
  const summary = useQuery({
    queryKey: ["stats-summary", userId, effectiveScope, range],
    enabled: backendEnabled,
    queryFn: async () => {
      const today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Vienna",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const from = new Date(today + "T12:00:00Z");
      if (range !== "today") from.setUTCDate(from.getUTCDate() - 29);
      return (await backendRpc("get_dashboard", {
        p_from: from.toISOString().slice(0, 10),
        p_to: today,
        p_scope: effectiveScope === "all" ? "team" : "mine",
      })) as Summary;
    },
  });
  const { data } = useQuery({
    queryKey: ["stats", scope, range],
    enabled: !backendEnabled,
    queryFn: async () => {
      const from = new Date();
      if (range === "today") from.setHours(0, 0, 0, 0);
      else from.setDate(from.getDate() - 30);
      let sc = supabase
        .from("status_changes")
        .select("new_status,created_at,user_id")
        .gte("created_at", from.toISOString())
        .limit(5000);
      if (scope === "mine") sc = sc.eq("user_id", userId);
      const [changes, total, open] = await Promise.all([
        sc,
        supabase.from("leads").select("id", { count: "exact", head: true }),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "open"),
      ]);
      return { changes: changes.data ?? [], total: total.count ?? 0, open: open.count ?? 0 };
    },
  });
  const ch = data?.changes ?? [];
  const calls = backendEnabled ? (summary.data?.attempts ?? 0) : ch.length;
  const count = (s: string) =>
    backendEnabled
      ? Number(summary.data?.[(s === "appointment" ? "appointments" : s) as keyof Summary] ?? 0)
      : ch.filter((c) => c.new_status === s).length;
  const reached = calls - count("not_reached") - count("open");
  const byStatus = ["not_reached", "no_interest", "callback", "appointment", "production"].map(
    (s) => ({ label: STATUS_LABEL[s] ?? s, value: count(s) }),
  );
  const byDay = WEEKDAYS.map((label, d) => ({
    label,
    value: backendEnabled
      ? (summary.data?.daily ?? [])
          .filter((x) => new Date(x.day + "T12:00:00Z").getUTCDay() === d)
          .reduce((sum, x) => sum + x.attempts, 0)
      : ch.filter((c) => new Date(c.created_at).getDay() === d).length,
  }));
  const tiles = [
    ["Anrufe", calls],
    ["Erreicht", reached],
    ["Termine", count("appointment")],
    ["Terminquote", calls ? `${Math.round((count("appointment") / calls) * 100)} %` : "–"],
    ...(!backendEnabled
      ? [
          ["Offene Leads", data?.open ?? 0],
          ["Leads gesamt", data?.total ?? 0],
        ]
      : []),
  ];
  if (backendEnabled && summary.isError) return <p>Statistik konnte nicht geladen werden.</p>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-semibold">{title}</h1>
        <div className="flex gap-2">
          {(!backendEnabled || admin) && (
            <Tabs value={scope} onValueChange={(v) => setScope(v as "mine" | "all")}>
              <TabsList>
                <TabsTrigger value="mine">Meine</TabsTrigger>
                <TabsTrigger value="all">Team</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {mode === "overview" && (
            <Tabs value={range} onValueChange={(v) => setRange(v as "today" | "30")}>
              <TabsList>
                <TabsTrigger value="today">Heute</TabsTrigger>
                <TabsTrigger value="30">30 Tage</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([l, v]) => (
          <div key={l as string} className="py-2">
            <p className="text-sm text-muted-foreground">{l}</p>
            <p className="text-[28px] font-normal tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {
          <section className="space-y-2 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Ergebnisse</h2>
            <Bars items={byStatus} />
          </section>
        }
        {mode !== "daily" && (
          <section className="space-y-2 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Anrufe pro Wochentag</h2>
            <Bars items={byDay} />
          </section>
        )}
      </div>
    </div>
  );
}
