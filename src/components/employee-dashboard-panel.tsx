import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FeedbackState } from "@/components/coldcaller/primitives";
import { formatNumber, formatPer100, monthStart } from "@/lib/dashboard";
import { currentMonth, monthLabel, shiftMonth } from "@/lib/monthly-stats";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { leadAvgTier } from "@/lib/kpi-tiers";
import "@/components/coldcaller/saas.css";

type Metrics = {
  attempts: number;
  reached: number;
  no_interest: number;
  not_reached: number;
  low_q: number;
  high_q: number;
  waiting_3d: number;
  callback: number;
  total_leads: number;
};
type Quality = {
  month: string;
  processed: number;
  qualified: number;
  per_100: number | null;
  final: boolean;
};
type TeamMetrics = {
  period: string;
  lead_quality: number | null;
  leads_contributed: number | null;
} | null;

const PERIOD_TILES: { key: keyof Metrics; label: string }[] = [
  { key: "total_leads", label: "Bearbeitete Leads" },
  { key: "attempts", label: "Anrufe" },
  { key: "reached", label: "Erreicht" },
  { key: "not_reached", label: "Nicht erreicht" },
  { key: "no_interest", label: "Kein Interesse" },
  { key: "low_q", label: "Logo Render" },
  { key: "high_q", label: "Realismus Render" },
  { key: "waiting_3d", label: "Logo ausstehend" },
  { key: "callback", label: "Rückrufe" },
];

/**
 * The figures of the caller dashboard for one employee. They come from the same database functions as the dashboard
 * itself (get_employee_stats for the period, get_monthly_quality and get_team_metrics for the monthly figures), so
 * both always show the same values.
 */
export function EmployeeDashboardPanel({
  country,
  userId,
  name,
  from,
  to,
}: {
  country: string;
  userId: string;
  name: string;
  from: string;
  to: string;
}) {
  const [offset, setOffset] = useState(0);
  const last = shiftMonth(currentMonth(), offset);
  const period = useQuery({
    queryKey: ["employee-stats", country, userId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_employee_stats", {
        p_country: country,
        p_user: userId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data as unknown as { metrics: Metrics }).metrics;
    },
  });
  const quality = useQuery({
    queryKey: ["employee-quality", userId, monthStart(last)],
    refetchInterval: offset === 0 ? 30_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_monthly_quality", {
        p_month: monthStart(last),
        p_user: userId,
      });
      if (error) throw error;
      return data as unknown as Quality;
    },
  });
  const team = useQuery({
    queryKey: ["employee-team-metrics", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_team_metrics", { p_user: userId });
      if (error) throw error;
      return data as unknown as TeamMetrics;
    },
  });
  const m = period.data;
  const t = team.data;
  const teamPeriod = t
    ? monthLabel({ year: Number(t.period.slice(0, 4)), month: Number(t.period.slice(5, 7)) })
    : null;
  const avg = quality.data?.per_100 ?? 0;
  const monthly: [string, string, string | null][] = [
    ["Leadqualität", t?.lead_quality != null ? formatPer100(t.lead_quality) : "–", teamPeriod],
    [
      "Eingebrachte Leads",
      t?.leads_contributed != null ? formatNumber(t.leads_contributed) : "–",
      teamPeriod,
    ],
  ];
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-4"
      aria-label={`Dashboard-Kennzahlen ${name}`}
    >
      <h2 className="font-semibold">Dashboard-Kennzahlen von {name}</h2>
      <p className="text-xs text-muted-foreground">
        Dieselben Zahlen, die {name} im eigenen Dashboard sieht. Die Anzahlen gelten für den
        gewählten Zeitraum, der Leadschnitt für den laufenden Monat (live).
      </p>
      {period.isError ? (
        <FeedbackState kind="error" title="Kennzahlen nicht verfügbar">
          Bitte versuche es erneut.
        </FeedbackState>
      ) : (
        <div
          className={cn(
            "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5",
            period.isLoading && "animate-pulse opacity-60",
          )}
        >
          {PERIOD_TILES.map((tile) => (
            <div key={tile.key} className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">{tile.label}</p>
              <p className="text-2xl tabular-nums">{m ? formatNumber(m[tile.key]) : "–"}</p>
            </div>
          ))}
          <div className="rounded-lg border bg-background p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Ø Leads pro 100</span>
              <span className="flex items-center gap-1">
                <button type="button" aria-label="Vorheriger Monat" className="px-1 hover:text-foreground" onClick={() => setOffset((o) => o - 1)}>‹</button>
                <button type="button" aria-label="Nächster Monat" className="px-1 hover:text-foreground disabled:opacity-30" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))}>›</button>
              </span>
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              <span className={`cc-tier cc-tier--${leadAvgTier(avg)}`}>{formatPer100(avg)}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              {monthLabel(last)} · {offset === 0 ? "live" : "eingefroren"}
            </p>
          </div>
          {monthly.map(([label, value, sub]) => (
            <div key={label} className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl tabular-nums">{value}</p>
              {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
