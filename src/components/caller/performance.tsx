import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { backendEnabled, backendRpc } from "@/lib/backend";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Crown,
  Mail,
  Phone,
  PhoneMissed,
  Target,
  Trophy,
  Users,
  X,
  ChartNoAxesColumn,
} from "@/components/coldcaller/icons";
import { FeedbackState, MetricCard, Surface } from "@/components/coldcaller/primitives";
import {
  formatNumber,
  formatPer100,
  monthStart,
  per100Delta,
  weekLabel,
  weekStart,
} from "@/lib/dashboard";
import { currentMonth, monthLabel, shiftMonth } from "@/lib/monthly-stats";
import { Button } from "@/components/ui/button";

type Day = {
  attempts: number;
  reached: number;
  no_interest: number;
  not_reached: number;
  low_q: number;
  high_q: number;
  waiting_3d: number;
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
  synced_at: string;
} | null;
type Ranking = {
  week_start: string;
  week_end: string;
  final: boolean;
  rows: { rank: number; user_id: string; name: string; points: number; is_me: boolean }[];
  me: { rank: number | null; points: number };
};

const VIENNA_TODAY = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(new Date());

function useDay(userId: string) {
  const today = VIENNA_TODAY();
  return useQuery({
    queryKey: ["caller-day", userId, today],
    enabled: backendEnabled,
    refetchInterval: 30_000,
    queryFn: async () => (await backendRpc("get_caller_day", {})) as unknown as Day,
  });
}

/** The four figures on top. Every value comes from the server; a missing source is said so, never replaced. */
export function DashboardKpis({ userId }: { userId: string }) {
  const day = useDay(userId);
  // The last completed month by default, with the month before it for the change.
  const last = shiftMonth(currentMonth(), -1);
  const quality = useQuery({
    queryKey: ["monthly-quality", userId, monthStart(last)],
    enabled: backendEnabled,
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        backendRpc("get_monthly_quality", { p_month: monthStart(last) }) as Promise<unknown>,
        backendRpc("get_monthly_quality", {
          p_month: monthStart(shiftMonth(last, -1)),
        }) as Promise<unknown>,
      ]);
      return { current: current as Quality, previous: previous as Quality };
    },
  });
  const team = useQuery({
    queryKey: ["team-metrics", userId],
    enabled: backendEnabled,
    queryFn: async () =>
      (await backendRpc("get_team_metrics", {} as never)) as unknown as TeamMetrics,
  });

  const t = team.data;
  const teamContext = (what: string) =>
    team.isError
      ? "Team Management nicht erreichbar"
      : t
        ? `${what} · Team Management, ${monthLabel({ year: Number(t.period.slice(0, 4)), month: Number(t.period.slice(5, 7)) })}`
        : "Team Management noch nicht verbunden";
  const q = quality.data?.current;
  const delta = per100Delta(q?.per_100 ?? null, quality.data?.previous.per_100 ?? null);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Leadqualität"
        value={t?.lead_quality != null ? formatNumber(t.lead_quality) : "–"}
        context={teamContext("Deine Bewertung")}
        help="Wird unverändert aus dem Team-Management-Tool übernommen. Das Dashboard berechnet sie nicht selbst."
        icon={<Crown />}
      />
      <MetricCard
        label="Eingebrachte Leads"
        value={t?.leads_contributed != null ? formatNumber(t.leads_contributed) : "–"}
        context={teamContext("Von dir eingebracht")}
        help="Anzahl der von dir eingebrachten Leads laut Team-Management-Tool. Ein erneuter Abgleich ersetzt den Wert, er wird nie addiert."
        icon={<Users />}
      />
      <MetricCard
        label="Durchschnitt"
        value={q?.per_100 != null ? `Ø ${formatPer100(q.per_100)}` : "–"}
        context={
          quality.isError
            ? "Monatswert nicht verfügbar"
            : q
              ? q.per_100 === null
                ? `Keine bearbeiteten Leads im ${monthLabel(last)}`
                : `Leads / 100 · ${monthLabel(last)}${delta ? ` · ${delta} zum Vormonat` : ""}`
              : "Wird berechnet …"
        }
        help="Qualifizierte Leads (Logo Render und Realismus Render, jeder Lead einmal) pro 100 bearbeiteten Leads des letzten abgeschlossenen Monats. Das Ergebnis wird am Monatsende gespeichert."
        icon={<ChartNoAxesColumn />}
      />
      <MetricCard
        label="Anrufe heute"
        value={day.data ? day.data.attempts : "–"}
        context={
          day.isError ? "Tageswert nicht verfügbar" : "Dokumentierte Anrufversuche · Wiener Zeit"
        }
        help="Jeder dokumentierte Anrufversuch von heute zählt, unabhängig vom Ergebnis. Der Tag wechselt um 0:00 Uhr Wiener Zeit, die Anzeige aktualisiert sich automatisch."
        icon={<Phone />}
      />
    </div>
  );
}

const DAY_TILES: { key: keyof Day; label: string; icon: React.ReactNode; key_figure?: boolean }[] =
  [
    { key: "reached", label: "Erreicht", icon: <CircleCheck /> },
    { key: "no_interest", label: "Kein Interesse", icon: <X /> },
    { key: "not_reached", label: "Nicht erreicht", icon: <PhoneMissed /> },
    { key: "low_q", label: "Logo Render", icon: <Target />, key_figure: true },
    { key: "high_q", label: "Realismus Render", icon: <Trophy />, key_figure: true },
    { key: "waiting_3d", label: "Logo ausstehend", icon: <Mail /> },
    { key: "total_leads", label: "Gesamt Leads", icon: <Building2 /> },
  ];

/** Seven small cards for today. The figures need not add up: a lead can have several actions. */
export function DayStats({ userId }: { userId: string }) {
  const day = useDay(userId);
  return (
    <Surface
      title="Deine Tagesstatistik"
      description="Heute · alle Länder · nur deine Ergebnisse · Wiener Zeit"
    >
      {day.isLoading ? (
        <FeedbackState kind="loading" title="Tagesleistung wird geladen" />
      ) : day.isError || !day.data ? (
        <FeedbackState
          kind="error"
          title="Tagesstatistik nicht verfügbar"
          action={<Button onClick={() => void day.refetch()}>Erneut versuchen</Button>}
        />
      ) : (
        <div className="cc-daygrid">
          {DAY_TILES.map((tile) => (
            <article
              key={tile.key}
              className={`cc-daytile${tile.key_figure ? " cc-daytile--key" : ""}`}
            >
              <span className="cc-daytile-icon" aria-hidden="true">
                {tile.icon}
              </span>
              <p>{tile.label}</p>
              <strong>{day.data[tile.key]}</strong>
            </article>
          ))}
          <p className="cc-daygrid-note">
            Erreicht und Gesamt Leads zählen jeden Lead einmal, Nicht erreicht und Kein Interesse
            jeden Versuch. Ein Lead kann mehrere Aktionen haben, die Zahlen müssen sich deshalb
            nicht zur Gesamtzahl addieren.
          </p>
        </div>
      )}
    </Surface>
  );
}

/** Weekly ranking, filled from the points ledger. Stays empty until a points system books points. */
export function WeeklyRanking({ userId }: { userId: string }) {
  const [shift, setShift] = useState(0);
  const start = weekStart(new Date(`${VIENNA_TODAY()}T12:00:00Z`), shift);
  const ranking = useQuery({
    queryKey: ["weekly-ranking", userId, start],
    enabled: backendEnabled,
    refetchInterval: shift === 0 ? 60_000 : false,
    queryFn: async () =>
      (await backendRpc("get_weekly_ranking", { p_week: start })) as unknown as Ranking,
  });
  const data = ranking.data;
  const empty = !!data && data.rows.length === 0;
  const mineInList = data?.rows.some((r) => r.is_me);
  return (
    <Surface
      title="Wochenrangliste"
      description={`${shift === 0 ? "Diese Woche" : "Woche"} ${weekLabel(start)} · Punkte`}
      action={
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            aria-label="Vorherige Woche"
            onClick={() => setShift(shift - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Nächste Woche"
            disabled={shift === 0}
            onClick={() => setShift(shift + 1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      }
    >
      {ranking.isLoading ? (
        <FeedbackState kind="loading" title="Rangliste wird geladen" />
      ) : ranking.isError || !data ? (
        <FeedbackState
          kind="error"
          title="Rangliste nicht verfügbar"
          action={<Button onClick={() => void ranking.refetch()}>Erneut versuchen</Button>}
        />
      ) : empty ? (
        <FeedbackState kind="empty" title="Noch keine Punkte in dieser Woche">
          Die Rangliste füllt sich, sobald das Punktesystem Punkte vergibt. Jede Woche beginnt neu,
          frühere Wochen bleiben gespeichert.
        </FeedbackState>
      ) : (
        <div className="cc-ranking">
          <ol>
            {data.rows.map((row) => (
              <li
                key={row.user_id}
                className={`${row.rank <= 3 ? "cc-ranking-top" : ""}${row.is_me ? " cc-ranking-me" : ""}`}
              >
                <span className="cc-ranking-rank">{row.rank}</span>
                <span className="cc-ranking-name">{row.is_me ? `${row.name} (du)` : row.name}</span>
                <span className="cc-ranking-points">{formatNumber(row.points)} Punkte</span>
              </li>
            ))}
          </ol>
          <p className="cc-ranking-me-line">
            {mineInList || data.me.rank !== null
              ? `Deine Platzierung: ${data.me.rank} · ${formatNumber(data.me.points)} Punkte`
              : `Du hast in dieser Woche noch keine Punkte.`}
          </p>
        </div>
      )}
    </Surface>
  );
}

/** Everything between the page title and the batches. */
export function CallerPerformance({ userId }: { userId: string }) {
  return (
    <div className="space-y-5">
      <DashboardKpis userId={userId} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <DayStats userId={userId} />
        <WeeklyRanking userId={userId} />
      </div>
    </div>
  );
}
