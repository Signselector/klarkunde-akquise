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
  weekStartKey,
  type PeriodMode,
} from "@/lib/stats-period";
import { Flag } from "@/components/flag";
import { leadAvgTier } from "@/lib/kpi-tiers";
import { formatPer100, monthStart } from "@/lib/dashboard";
import { currentMonth } from "@/lib/monthly-stats";
import "@/components/coldcaller/saas.css";
import { ChevronLeft, ChevronRight } from "@/components/coldcaller/icons";
import { FeedbackState } from "@/components/coldcaller/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui/dropdown";
import { EmployeeDashboardPanel } from "@/components/employee-dashboard-panel";
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
  waiting_3d?: number;
  callback?: number;
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
type SortKey = "avg" | "renders" | "calls" | (typeof OUTCOMES)[number] | "name";
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "avg", label: "Ø Schnitt" },
  { value: "renders", label: "Render gesamt" },
  { value: "calls", label: "Anrufe" },
  ...OUTCOMES.map((k) => ({ value: k, label: STATUS_LABEL[k] ?? k })),
  { value: "name", label: "Name (A–Z)" },
];
export function sortTeam<T extends { name: string; calls?: number; user_id?: string } & Partial<Record<(typeof OUTCOMES)[number], number>>>(
  team: T[],
  key: SortKey,
  avgs: Record<string, number> = {},
): T[] {
  const val = (m: T) =>
    key === "avg"
      ? avgs[m.user_id ?? ""] ?? 0
      : key === "renders" ? (m.low_q ?? 0) + (m.high_q ?? 0) : key === "name" ? 0 : ((m as Record<string, unknown>)[key] as number) ?? 0;
  return [...team].sort((a, b) => (key === "name" ? 0 : val(b) - val(a)) || a.name.localeCompare(b.name));
}
const pct = (v: number | null) => (v === null ? "–" : `${String(v).replace(".", ",")} %`);
const roleLabel = (r: string) => ROLE_LABEL[(r === "caller" ? "recruit" : r) as RoleName] ?? r;

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        // Phones: the name on top, the bar with its number below; from md on all in one row.
        <div key={i.label} className="flex flex-col gap-1 text-sm md:flex-row md:items-center md:gap-2">
          <span className="text-muted-foreground md:w-36 md:shrink-0">{i.label}</span>
          <div className="flex items-center gap-2 md:flex-1">
            <div className="h-5 flex-1 rounded bg-muted">
              <div className="h-5 rounded bg-primary" style={{ width: `${(i.value / max) * 100}%` }} />
            </div>
            <span className="w-8 text-right tabular-nums">{i.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Vertical bars over time: days of a month, the seven days of a week, or the hours of a day. */
function Timeline({ points }: { points: { label: string; value: number; title: string }[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="group/tl flex h-44 items-end gap-1" role="img" aria-label="Gespräche im zeitlichen Verlauf">
      {points.map((p) => (
        <div
          key={p.title}
          className="group/bar flex h-full min-w-0 flex-1 flex-col justify-end text-center transition-opacity duration-150 group-hover/tl:opacity-30 hover:!opacity-100"
          title={p.title}
        >
          <span className="text-[10px] font-medium tabular-nums text-foreground opacity-0 transition-opacity duration-150 group-hover/bar:opacity-100">
            {p.value || ""}
          </span>
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

/** Step and top value of the y axis (0, step, 2·step … top), so a week of calls gets two to four gridlines. */
export function niceScale(max: number): { step: number; top: number } {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const step = steps.find((s) => max / s <= 3) ?? 10000;
  return { step, top: Math.max(step, Math.ceil(max / step) * step) };
}

const monthName = new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: "UTC" });
const monthAbbr = new Intl.DateTimeFormat("de-DE", { month: "short", timeZone: "UTC" });
const keyDate = (k: string) => new Date(`${k}T12:00:00Z`);

/** "1. – 7. November", or "28. Okt. – 3. Nov." when the week spans two months. */
export function weekRangeLabel(startKey: string): string {
  const a = keyDate(startKey);
  const b = keyDate(addDaysKey(startKey, 6));
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}. – ${b.getUTCDate()}. ${monthName.format(b)}`
    : `${a.getUTCDate()}. ${monthAbbr.format(a)} – ${b.getUTCDate()}. ${monthAbbr.format(b)}`;
}

/** Splits day figures into Monday–Sunday weeks. Days of the week outside the period have no value (null). */
export function toWeeks(points: { key: string; value: number }[]) {
  const byKey = new Map(points.map((p) => [p.key, p.value]));
  const starts = [...new Set(points.map((p) => weekStartKey(p.key)))].sort();
  return starts.map((start) => ({
    start,
    days: Array.from({ length: 7 }, (_, i) => {
      const key = addDaysKey(start, i);
      return { key, value: byKey.has(key) ? (byKey.get(key) as number) : null };
    }),
  }));
}

/**
 * Phone chart "Gespräche pro Tag". Month: every day of the month in one chart (nothing of the neighbouring months).
 * Other periods: the seven days of one week with a pager. All bars are dark; a tap on a bar shows its exact number
 * and greys out the others, a second tap on it clears the choice. In week mode the arrows move the whole period.
 */
export function WeekBars({
  points,
  today,
  onShift,
  fullPeriod = false,
  periodLabel = "",
}: {
  points: { key: string; value: number }[];
  today: string;
  /** When set, the arrows call this instead of paging inside the loaded period (week mode). */
  onShift?: (dir: -1 | 1) => void;
  /** Show all given days at once (month) instead of week by week. */
  fullPeriod?: boolean;
  /** Title under the chart when `fullPeriod` is set, e.g. "November 2026". */
  periodLabel?: string;
}) {
  const weeks = useMemo(() => toWeeks(points), [points]);
  const first = points[0]?.key ?? "";
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  // Start at the week of today when it is inside the period, otherwise at the last one.
  useEffect(() => {
    const current = weeks.findIndex((w) => w.days.some((d) => d.key === today && d.value !== null));
    setIndex(current >= 0 ? current : Math.max(0, weeks.length - 1));
  }, [first, weeks.length, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPicked(null), [first, index, fullPeriod]);
  const week = weeks[Math.min(index, weeks.length - 1)];
  if (!week) return <p className="py-6 text-center text-sm text-muted-foreground">Keine Daten.</p>;
  const days = fullPeriod ? points.map((p) => ({ key: p.key, value: p.value as number | null })) : week.days;
  const label = fullPeriod ? periodLabel : weekRangeLabel(week.start);
  const max = Math.max(0, ...days.map((d) => d.value ?? 0));
  const { step, top } = niceScale(max);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const canPrev = onShift ? true : index > 0;
  const canNext = onShift ? true : index < weeks.length - 1;
  const move = (dir: -1 | 1) => (onShift ? onShift(dir) : setIndex((i) => i + dir));
  const dense = days.length > 10;
  const showLabel = (key: string) => {
    const day = keyDate(key).getUTCDate();
    return !dense || day === 1 || day % 5 === 0;
  };
  return (
    <div>
      <div className="flex h-44 gap-2 pt-4" role="group" aria-label={`Gespräche pro Tag, ${label}`}>
        <div className="w-7 shrink-0 pb-5 text-right text-xs text-muted-foreground">
          <div className="relative h-full">
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 translate-y-1/2 tabular-nums" style={{ bottom: `${(t / top) * 100}%` }}>
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="relative min-w-0 flex-1">
          {/* gridlines: the plot area is everything above the 20px label row */}
          <div className="absolute inset-x-0 top-0 bottom-5">
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
          </div>
          <div
            className={cn("absolute inset-0 grid", dense ? "gap-[2px]" : "gap-1.5")}
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          >
            {days.map((d) => {
              const v = d.value ?? 0;
              const empty = d.value === null;
              const chosen = picked === d.key;
              const day = keyDate(d.key).getUTCDate();
              return (
                <button
                  key={d.key}
                  type="button"
                  disabled={empty}
                  aria-pressed={chosen}
                  aria-label={`${day}. ${monthName.format(keyDate(d.key))}: ${v} Gespräche`}
                  onClick={() => setPicked(chosen ? null : d.key)}
                  className="flex min-h-0 min-w-0 flex-col !rounded-none !border-0 !bg-transparent !p-0 !shadow-none !min-h-0"
                >
                  <span className="flex w-full flex-1 items-end justify-center">
                    <span
                      className={cn(
                        "relative block w-full rounded-t-[3px] transition-colors",
                        empty ? "bg-transparent" : picked !== null && !chosen ? "bg-muted-foreground/25" : "bg-primary",
                      )}
                      style={{ height: `${empty ? 0 : Math.max(v ? 2 : 0.8, (v / top) * 100)}%`, minHeight: empty ? 0 : 2 }}
                    >
                      {chosen && (
                        <span className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums text-foreground">
                          {v}
                        </span>
                      )}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "h-5 pt-1 text-center text-[11px] tabular-nums",
                      empty ? "text-muted-foreground/40" : d.key === today || chosen ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {showLabel(d.key) ? day : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {fullPeriod ? (
        <p className="mt-3 rounded-full bg-muted px-4 py-2 text-center text-sm font-medium capitalize" aria-live="polite">
          {label}
        </p>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon" aria-label="Vorherige Woche" disabled={!canPrev} onClick={() => move(-1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-0 flex-1 truncate rounded-full bg-muted px-4 py-2 text-center text-sm font-medium" aria-live="polite">
            {label}
          </span>
          <Button variant="ghost" size="icon" aria-label="Nächste Woche" disabled={!canNext} onClick={() => move(1)}>
            <ChevronRight />
          </Button>
        </div>
      )}
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
  const [sortKey, setSortKey] = useState<SortKey>("avg");
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
  // Admins never appear in any statistic.
  const team = (overall.data?.team ?? []).filter((m) => m.role !== "admin");
  const teamIds = team.map((m) => m.user_id);
  const avgs = useQuery({
    enabled: enabled && teamIds.length > 0,
    queryKey: ["team-lead-avg", monthStart(currentMonth()), teamIds.join(",")],
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const entries = await Promise.all(
        teamIds.map(async (id) => {
          const { data } = await supabase.rpc("get_monthly_quality", { p_month: monthStart(currentMonth()), p_user: id });
          return [id, (data as { per_100: number | null } | null)?.per_100 ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
  });
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
          {/* Phones: below the country buttons, on the left; from md on to the right of them. */}
          <label className="flex w-full items-center gap-2 text-sm md:ml-auto md:w-auto">
            <span className="font-medium">Ebene</span>
            <Dropdown
              value={employee ?? ""}
              onChange={(v) => setEmployee(v || null)}
              ariaLabel="Gesamtes Land oder Mitarbeiter"
              options={[
                { value: "", label: "Landesweit" },
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
            {mode !== "month" && (
              <Button variant="ghost" size="icon" aria-label="Zurück" onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))}>
                <ChevronLeft />
              </Button>
            )}
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
            {mode !== "month" && (
              <Button variant="ghost" size="icon" aria-label="Weiter" onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))}>
                <ChevronRight />
              </Button>
            )}
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

      {employee && enabled && (
        <EmployeeDashboardPanel
          country={country}
          userId={employee}
          name={team.find((m) => m.user_id === employee)?.name ?? "Mitarbeiter"}
          from={period.from}
          to={period.to}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">Ergebnisse im Detail</h2>
          <Bars items={OUTCOMES.map((k) => ({ label: STATUS_LABEL[k] ?? k, value: data?.by_outcome[k] ?? 0 }))} />
        </section>
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">
            <span className="md:hidden">{mode === "day" ? "Gespräche pro Stunde" : "Gespräche pro Tag"}</span>
            <span className="hidden md:inline">
              {mode === "month" || mode === "custom" ? "Gespräche pro Tag" : mode === "week" ? "Gespräche pro Wochentag" : "Gespräche pro Stunde"}
            </span>
          </h2>
          {/* Phones show weeks to page through (except for a single day); from md on the whole period at once. */}
          {mode !== "day" && (
            <div className="md:hidden">
              <WeekBars
                points={(data?.timeline ?? []).map((p) => ({ key: p.bucket, value: p.calls }))}
                today={today}
                {...(mode === "month" ? { fullPeriod: true, periodLabel: period.label } : {})}
                {...(mode === "week" ? { onShift: (dir: -1 | 1) => setAnchor(shiftAnchor(mode, anchor, dir)) } : {})}
              />
            </div>
          )}
          <div className={mode === "day" ? "" : "hidden md:block"}>
            <Timeline points={shown} />
          </div>
          {outside > 0 && (
            <p className="text-xs text-muted-foreground">Außerhalb von 08:00–18:59 Uhr: {outside} Gespräche.</p>
          )}
        </section>
      </div>

      {!employee && (
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">Mitarbeiter in {country}</h2>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <span className="font-medium">Sortieren nach</span>
              <Dropdown
                value={sortKey}
                onChange={(v) => setSortKey(v as SortKey)}
                ariaLabel="Mitarbeiter sortieren"
                options={SORT_OPTIONS}
              />
            </label>
          </div>
          {team.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine aktiven Mitarbeiter in diesem Land.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max whitespace-nowrap text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    {["Mitarbeiter", "Rolle", "Ø", "Anrufe", ...OUTCOMES.map((k) => STATUS_LABEL[k] ?? k)].map((h, i) => (
                      <th key={h} className={cn("px-3 py-2 font-medium", i > 1 && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortTeam(team, sortKey, (avgs.data ?? {}) as Record<string, number>).map((m) => (
                      <tr key={m.user_id}>
                        <td className="px-3 py-2">
                          <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setEmployee(m.user_id)}>
                            {m.name}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{roleLabel(m.role)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums" title="Leadschnitt laufender Monat (live)">
                          {(() => {
                            const v = avgs.data?.[m.user_id] ?? 0;
                            return <span className={`cc-tier cc-tier--${leadAvgTier(v)}`}>{formatPer100(v)}</span>;
                          })()}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{m.calls ?? 0}</td>
                        {OUTCOMES.map((k) => (
                          <td key={k} className="px-3 py-2 text-right tabular-nums">{m[k] ?? 0}</td>
                        ))}
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
