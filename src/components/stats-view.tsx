import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { COUNTRIES, isCountry, useAllowedCountries, useCountry, type Country } from "@/lib/country";
import { ROLE_LABEL, useRoles, type RoleName } from "@/lib/use-admin";
import { STATUS_LABEL } from "@/lib/leads";
import {
  addDaysKey,
  customPeriod,
  dayCount,
  MAX_CUSTOM_DAYS,
  monthOptions,
  periodOf,
  shiftAnchor,
  todayKey,
  type PeriodMode,
} from "@/lib/stats-period";
import { Flag } from "@/components/flag";
import { ChevronLeft, ChevronRight } from "@/components/coldcaller/icons";
import { FeedbackState } from "@/components/coldcaller/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui/dropdown";
import { ChoiceButtons } from "@/components/ui/choice-buttons";

type Totals = {
  calls: number;
  reached: number;
  reach_rate: number | null;
  appointments: number;
  appointment_rate: number | null;
  deals: number;
};
type TeamRow = {
  user_id: string;
  name: string;
  role: RoleName;
  calls: number;
  reached: number;
  appointments: number;
  deals: number;
  low_q?: number;
  high_q?: number;
  on_hold?: number;
  reference_mail?: number;
  not_reached?: number;
  no_interest?: number;
};
type Stats = {
  totals: Totals;
  by_outcome: Record<string, number>;
  timeline: { bucket: string; calls: number; reached: number }[];
  team: TeamRow[] | null;
};

const OUTCOMES = [
  "low_q",
  "high_q",
  "waiting_3d",
  "on_hold",
  "reference_mail",
  "callback",
  "not_reached",
  "no_interest",
] as const;
const pct = (v: number | null) => (v === null ? "–" : `${String(v).replace(".", ",")} %`);
const roleLabel = (r: string) => ROLE_LABEL[(r === "caller" ? "recruit" : r) as RoleName] ?? r;

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-sm">
          <span className="w-36 shrink-0 text-muted-foreground">{i.label}</span>
          <div className="h-5 flex-1 rounded bg-muted">
            <div className="h-5 rounded bg-primary" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
          <span className="w-8 text-right tabular-nums">{i.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical bars over time: days of a month, the seven days of a week, or the hours of a day. */
function Timeline({ points }: { points: { label: string; value: number; title: string }[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="flex h-44 items-end gap-1" role="img" aria-label="Gespräche im zeitlichen Verlauf">
      {points.map((p) => (
        <div key={p.title} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center" title={p.title}>
          <span className="text-[10px] tabular-nums text-muted-foreground">{p.value || ""}</span>
          <div
            className={cn("w-full rounded-t", p.value ? "bg-primary" : "bg-muted")}
            style={{ height: `${Math.max(p.value ? 6 : 2, (p.value / max) * 100)}%` }}
          />
          <span className="mt-1 truncate text-[10px] text-muted-foreground">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

const weekdayShort = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" });

/**
 * Statistics cockpit for admins and managers: pick the country, then the whole country or one employee, then
 * month, week or day with free navigation. All figures come from `get_country_period_stats` (Vienna time).
 */
export function StatsView({ userId, title = "Statistik" }: { userId: string; title?: string }) {
  const roles = useRoles(userId);
  const activeCountry = useCountry();
  const allowed = useAllowedCountries();
  const countries = COUNTRIES.filter((c) => (allowed.data ?? []).includes(c.code));
  const [country, setCountry] = useState<Country>(activeCountry);
  const [employee, setEmployee] = useState<string | null>(null);
  const [mode, setMode] = useState<PeriodMode>("month");
  const [anchor, setAnchor] = useState(() => todayKey());
  const [customFrom, setCustomFrom] = useState(() => addDaysKey(todayKey(), -29));
  const [customTo, setCustomTo] = useState(() => todayKey());
  const customTooLong = dayCount(customFrom, customTo) > MAX_CUSTOM_DAYS;

  // The first allowed country is used when the remembered one is not available to this user.
  useEffect(() => {
    if (countries.length && !countries.some((c) => c.code === country)) setCountry(countries[0]!.code);
  }, [countries, country]);
  useEffect(() => setEmployee(null), [country]);

  const period = useMemo(
    () => (mode === "custom" ? customPeriod(customFrom, customTo) : periodOf(mode, anchor)),
    [mode, anchor, customFrom, customTo],
  );
  const run = async (user: string | null) => {
    const { data, error } = await supabase.rpc("get_country_period_stats", {
      p_country: country,
      p_from: period.from,
      p_to: period.to,
      p_bucket: period.bucket,
      ...(user ? { p_user_id: user } : {}),
    });
    if (error) throw error;
    return data as unknown as Stats;
  };
  const enabled = roles.isStaff && isCountry(country) && !(mode === "custom" && customTooLong);
  const overall = useQuery({
    enabled,
    queryKey: ["country-stats", country, period.from, period.to, null],
    queryFn: () => run(null),
  });
  const single = useQuery({
    enabled: enabled && !!employee,
    queryKey: ["country-stats", country, period.from, period.to, employee],
    queryFn: () => run(employee),
  });
  const team = overall.data?.team ?? [];
  const data = employee ? single.data : overall.data;
  const loading = employee ? single.isLoading : overall.isLoading;
  const failed = employee ? single.isError : overall.isError;
  const today = todayKey();

  if (roles.ready && !roles.isStaff)
    return <p className="text-muted-foreground">Die Statistik ist nur für Admins und Manager.</p>;

  const timeline =
    data?.timeline.map((p) => {
      if (mode === "day") return { label: `${p.bucket}`, value: p.calls, title: `${p.bucket}:00 Uhr · ${p.calls} Gespräche` };
      const d = new Date(`${p.bucket}T12:00:00Z`);
      return {
        label: mode === "week" ? weekdayShort.format(d).replace(".", "") : mode === "custom" && (data?.timeline.length ?? 0) > 31 ? "" : String(d.getUTCDate()),
        value: p.calls,
        title: `${p.bucket} · ${p.calls} Gespräche`,
      };
    }) ?? [];
  // A day shows the working hours; calls outside them are counted separately.
  const shown = mode === "day" ? timeline.filter((p) => Number(p.label) >= 8 && Number(p.label) <= 18) : timeline;
  const outside = mode === "day" ? timeline.reduce((s, p) => s + p.value, 0) - shown.reduce((s, p) => s + p.value, 0) : 0;
  const months = monthOptions(today);
  const t = data?.totals;
  const tiles: [string, string | number, string?][] = [
    ["Gespräche", t?.calls ?? 0],
    ["Erreicht", t?.reached ?? 0, `Quote ${pct(t?.reach_rate ?? null)}`],
    ["Termine", t?.appointments ?? 0, `Quote ${pct(t?.appointment_rate ?? null)}`],
    ["Pipedrive Deals", t?.deals ?? 0],
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-semibold">{title}</h1>

      <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Auswahl">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Land</span>
          <div role="tablist" aria-label="Land wählen" className="flex gap-1.5">
            {countries.map((c) => (
              <button
                key={c.code}
                type="button"
                role="tab"
                aria-selected={country === c.code}
                onClick={() => setCountry(c.code)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm",
                  country === c.code ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted",
                )}
              >
                <Flag code={c.code} size={20} /> {c.code}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <span className="font-medium">Ebene</span>
            <Dropdown
              value={employee ?? ""}
              onChange={(v) => setEmployee(v || null)}
              ariaLabel="Gesamtes Land oder Mitarbeiter"
              options={[
                { value: "", label: "Gesamtes Land (alle Mitarbeiter)" },
                ...team.map((m) => ({ value: m.user_id, label: `${m.name} · ${roleLabel(m.role)}` })),
              ]}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <ChoiceButtons<PeriodMode>
            ariaLabel="Zeitraum"
            value={mode}
            onChange={setMode}
            options={[
              { value: "month", label: "Monatlich" },
              { value: "week", label: "Wöchentlich" },
              { value: "day", label: "Täglich" },
              { value: "custom", label: "Von – Bis" },
            ]}
          />
          {mode === "custom" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                Von
                <input type="date" aria-label="Von" className="min-h-10 rounded-md border bg-background px-3 text-sm"
                  value={customFrom} max={customTo} onChange={(e) => e.target.value && setCustomFrom(e.target.value)} />
              </label>
              <label className="flex items-center gap-2">
                Bis
                <input type="date" aria-label="Bis" className="min-h-10 rounded-md border bg-background px-3 text-sm"
                  value={customTo} min={customFrom} max={today} onChange={(e) => e.target.value && setCustomTo(e.target.value)} />
              </label>
              {customTooLong && <span className="text-destructive">Höchstens {MAX_CUSTOM_DAYS} Tage.</span>}
            </div>
          ) : (<>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Zurück" onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))}>
              <ChevronLeft />
            </Button>
            {mode === "month" ? (
              <Dropdown
                className="capitalize"
                contentClassName="capitalize"
                ariaLabel="Monat wählen"
                value={period.start}
                onChange={setAnchor}
                options={[
                  ...(months.some((m) => m.key === period.start) ? [] : [{ value: period.start, label: period.label }]),
                  ...months.map((m) => ({ value: m.key, label: m.label })),
                ]}
              />
            ) : mode === "day" ? (
              <input
                type="date"
                aria-label="Tag wählen"
                className="min-h-10 rounded-md border bg-background px-3 text-sm"
                value={period.start}
                max={today}
                onChange={(e) => e.target.value && setAnchor(e.target.value)}
              />
            ) : (
              <span className="min-w-56 text-center text-sm font-semibold" aria-live="polite">
                {period.label}
              </span>
            )}
            <Button variant="ghost" size="icon" aria-label="Weiter" onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))}>
              <ChevronRight />
            </Button>
          </div>
          {mode === "day" && <span className="text-sm text-muted-foreground">{period.label}</span>}
          </>)}
        </div>
      </section>

      {failed && (
        <FeedbackState
          kind="error"
          title="Statistik nicht verfügbar"
          action={<Button onClick={() => (employee ? single.refetch() : overall.refetch())}>Erneut versuchen</Button>}
        >
          Ist die Datenbank-Migration 0030 eingespielt?
        </FeedbackState>
      )}

      <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", loading && "animate-pulse opacity-60")}>
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-[30px] font-normal tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">Ergebnisse im Detail</h2>
          <Bars items={OUTCOMES.map((k) => ({ label: STATUS_LABEL[k] ?? k, value: data?.by_outcome[k] ?? 0 }))} />
        </section>
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">
            {mode === "month" || mode === "custom" ? "Gespräche pro Tag" : mode === "week" ? "Gespräche pro Wochentag" : "Gespräche pro Stunde"}
          </h2>
          <Timeline points={shown} />
          {outside > 0 && (
            <p className="text-xs text-muted-foreground">Außerhalb von 08:00–18:59 Uhr: {outside} Gespräche.</p>
          )}
        </section>
      </div>

      {!employee && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 font-semibold">Mitarbeiter in {country}</h2>
          {team.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine aktiven Mitarbeiter in diesem Land.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max whitespace-nowrap text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    {["Mitarbeiter", "Rolle", "Logo Render", "Realismus Render", "Zukunftsprojekte", "Referenzmail", "Nicht erreicht", "Kein Interesse"].map((h, i) => (
                      <th key={h} className={cn("px-3 py-2 font-medium", i > 1 && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...team]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((m) => (
                      <tr key={m.user_id}>
                        <td className="px-3 py-2">
                          <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setEmployee(m.user_id)}>
                            {m.name}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{roleLabel(m.role)}</td>
<td className="px-3 py-2 text-right tabular-nums">{m.low_q ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.high_q ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.on_hold ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.reference_mail ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.not_reached ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.no_interest ?? 0}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
