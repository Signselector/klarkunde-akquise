import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { backendEnabled, backendRpc } from "@/lib/backend";
import {
  Building2,
  CalendarCheck,
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
import { FeedbackState, InfoButton } from "@/components/coldcaller/primitives";
import {
  formatNumber,
  formatPer100,
  monthStart,
  per100Delta,
  weekLabel,
  weekStart,
} from "@/lib/dashboard";
import { currentMonth, monthLabel, shiftMonth } from "@/lib/monthly-stats";
import { useMonthlyCallGoal } from "@/lib/goals";
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

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

function BentoCard({
  className = "",
  title,
  meta,
  help,
  children,
  index = 0,
}: {
  className?: string;
  title?: string;
  meta?: React.ReactNode;
  help?: string;
  children: React.ReactNode;
  index?: number;
}) {
  return (
    <section
      className={`cc-bento-card ${className}`}
      style={{ "--i": index } as React.CSSProperties}
    >
      {title && (
        <h3 className="cc-bento-title">
          <span>{title}</span>
          <span className="cc-bento-meta">
            {meta}
            {help && <InfoButton label={title}>{help}</InfoButton>}
          </span>
        </h3>
      )}
      {children}
    </section>
  );
}

const DAY_TILES: { key: keyof Day; label: string; hot?: boolean }[] = [
  { key: "reached", label: "Erreicht" },
  { key: "no_interest", label: "Kein Interesse" },
  { key: "not_reached", label: "Nicht erreicht" },
  { key: "total_leads", label: "Gesamt Leads" },
  { key: "low_q", label: "Logo Render", hot: true },
  { key: "high_q", label: "Realismus Render", hot: true },
  { key: "waiting_3d", label: "Logo ausstehend" },
];

/** The whole caller dashboard above the batches: greeting, goal ring, monthly figure, KPIs, day stats, ranking. */
export function CallerPerformance({
  userId,
  name,
}: {
  userId: string;
  name?: string | null | undefined;
}) {
  const day = useDay(userId);
  const [shift, setShift] = useState(0);
  const last = shiftMonth(currentMonth(), -1);

  // The last six completed months, oldest first, for the bars of the monthly figure.
  const months = Array.from({ length: 6 }, (_, k) => shiftMonth(last, k - 5));
  const history = useQuery({
    queryKey: ["monthly-quality-history", userId, monthStart(last)],
    enabled: backendEnabled,
    queryFn: async () =>
      Promise.all(
        months.map(
          async (m) =>
            (await backendRpc("get_monthly_quality", {
              p_month: monthStart(m),
            })) as unknown as Quality,
        ),
      ),
  });
  const team = useQuery({
    queryKey: ["team-metrics", userId],
    enabled: backendEnabled,
    queryFn: async () =>
      (await backendRpc("get_team_metrics", {} as never)) as unknown as TeamMetrics,
  });
  const start = weekStart(new Date(`${VIENNA_TODAY()}T12:00:00Z`), shift);
  const ranking = useQuery({
    queryKey: ["weekly-ranking", userId, start],
    enabled: backendEnabled,
    refetchInterval: shift === 0 ? 60_000 : false,
    queryFn: async () =>
      (await backendRpc("get_weekly_ranking", { p_week: start })) as unknown as Ranking,
  });

  const t = team.data;
  const q = history.data?.[5];
  const delta = per100Delta(q?.per_100 ?? null, history.data?.[4]?.per_100 ?? null);
  const maxPer100 = Math.max(1, ...(history.data ?? []).map((m) => m.per_100 ?? 0));
  // Today's calls stay the headline figure; the goal is the month's.
  const goal = useMonthlyCallGoal();
  const month = useQuery({
    queryKey: ["caller-month", userId, VIENNA_TODAY().slice(0, 7)],
    enabled: backendEnabled,
    refetchInterval: 30_000,
    queryFn: async () =>
      (await backendRpc("get_caller_month", {})) as unknown as { attempts: number },
  });
  const calls = day.data?.attempts ?? 0;
  const monthCalls = month.data?.attempts ?? 0;
  const remaining = Math.max(0, goal - monthCalls);
  const share = Math.min(1, monthCalls / goal);
  const first = (name ?? "").trim();
  const teamContext = (what: string) =>
    team.isError
      ? "Team Management nicht erreichbar"
      : t
        ? `${what} · ${monthLabel({ year: Number(t.period.slice(0, 4)), month: Number(t.period.slice(5, 7)) })}`
        : "Team Management noch nicht verbunden";
  const data = ranking.data;

  return (
    <>
      <div className="cc-hello">
        <div>
          <h1>
            {first ? `Hallo ${first}!` : "Hallo!"}
            <br />
            {month.data
              ? remaining > 0
                ? `Noch ${remaining} Anrufe bis zum Monatsziel.`
                : "Monatsziel erreicht. Stark."
              : "Bereit für gute Gespräche."}
          </h1>
          <p>Deine Leads im Blick. Der nächste Schritt ganz klar.</p>
        </div>
        <div className="cc-hello-actions">
          <span className="cc-chip">
            <CalendarCheck aria-hidden="true" />
            {monthLabel(currentMonth())}
          </span>
          <Link to="/leads" className="cc-cta">
            Zu den Offenen Leads →
          </Link>
        </div>
      </div>

      <div className="cc-bento">
        <BentoCard className="cc-b-goal" index={0}>
          <div className="cc-ring" style={{ "--p": share } as React.CSSProperties}>
            <svg viewBox="0 0 140 140" aria-hidden="true">
              <circle className="cc-ring-bg" cx="70" cy="70" r="60" />
              <circle className="cc-ring-fg" cx="70" cy="70" r="60" />
            </svg>
            <div className="cc-ring-mid">
              <b>{day.data ? calls : "–"}</b>
              <span>Anrufe heute</span>
            </div>
          </div>
          <div className="cc-goal-text">
            <h2>Monatsziel</h2>
            <p>
              {day.isError || month.isError
                ? "Wert nicht verfügbar"
                : `${monthCalls} von ${goal} Anrufen im ${monthLabel(currentMonth())}\u00a0`}
            </p>
            <div className="cc-meter" aria-hidden="true">
              <i style={{ width: `${Math.round(share * 100)}%` }} />
            </div>
            <div className="cc-meter-label">
              <span>0</span>
              <span>{Math.round(share * 100)} %</span>
              <span>{goal}</span>
            </div>
          </div>
        </BentoCard>

        <BentoCard
          className="cc-b-avg"
          title="Ø Leads pro 100"
          meta={q ? monthLabel(last) : undefined}
          help="Qualifizierte Leads (Logo Render und Realismus Render, jeder Lead einmal) pro 100 bearbeiteten Leads des letzten abgeschlossenen Monats. Das Ergebnis wird am Monatsende gespeichert."
          index={1}
        >
          <div className="cc-big">
            {q?.per_100 != null ? formatPer100(q.per_100) : "–"}
            <small>Leads / 100</small>
          </div>
          <p className="cc-big-note">
            {history.isError
              ? "Monatswert nicht verfügbar"
              : q
                ? q.per_100 === null
                  ? `Keine bearbeiteten Leads im ${monthLabel(last)}`
                  : delta
                    ? `${delta} zum Vormonat`
                    : "Letzter abgeschlossener Monat"
                : "Wird berechnet …"}
          </p>
          <div className="cc-bars" aria-hidden="true">
            {(history.data ?? months.map(() => null)).map((m, k) => (
              <i
                key={k}
                className={k === 5 ? "hi" : ""}
                style={{
                  height: `${m?.per_100 ? Math.max(6, Math.round((m.per_100 / maxPer100) * 100)) : 6}%`,
                  animationDelay: `${300 + k * 60}ms`,
                }}
              />
            ))}
          </div>
          <div className="cc-bars-label" aria-hidden="true">
            {months.map((m) => (
              <span key={`${m.year}-${m.month}`}>{monthLabel(m).slice(0, 3)}</span>
            ))}
          </div>
        </BentoCard>

        <div className="cc-b-kpis">
          <BentoCard
            className="cc-mini"
            title="Leadqualität"
            help="Wird unverändert aus dem Team-Management-Tool übernommen. Das Dashboard berechnet sie nicht selbst."
            index={2}
          >
            <b>{t?.lead_quality != null ? formatNumber(t.lead_quality) : "–"}</b>
            <em>{teamContext("Deine Bewertung")}</em>
          </BentoCard>
          <BentoCard
            className="cc-mini"
            title="Eingebrachte Leads"
            help="Anzahl der von dir eingebrachten Leads laut Team-Management-Tool. Ein erneuter Abgleich ersetzt den Wert, er wird nie addiert."
            index={3}
          >
            <b>{t?.leads_contributed != null ? formatNumber(t.leads_contributed) : "–"}</b>
            <em>{teamContext("Von dir eingebracht")}</em>
          </BentoCard>
        </div>

        <BentoCard className="cc-b-stats" title="Tagesstatistik" meta="Heute" index={4}>
          {day.isLoading ? (
            <FeedbackState kind="loading" title="Tagesleistung wird geladen" />
          ) : day.isError || !day.data ? (
            <FeedbackState
              kind="error"
              title="Tagesstatistik nicht verfügbar"
              action={<Button onClick={() => void day.refetch()}>Erneut versuchen</Button>}
            />
          ) : (
            <>
              <div className="cc-pills">
                <div className="cc-pill">
                  <b>{day.data.attempts}</b>
                  <span>Anrufe</span>
                </div>
                {DAY_TILES.map((tile) => (
                  <div key={tile.key} className={`cc-pill${tile.hot ? " cc-pill--hot" : ""}`}>
                    <b>{day.data[tile.key]}</b>
                    <span>{tile.label}</span>
                  </div>
                ))}
              </div>
              <p className="cc-pills-note">
                Erreicht und Gesamt Leads zählen jeden Lead einmal, Nicht erreicht und Kein
                Interesse jeden Versuch. Die Zahlen müssen sich nicht zur Gesamtzahl addieren.
              </p>
            </>
          )}
        </BentoCard>

        <BentoCard
          className="cc-b-rank"
          title="Wochenrangliste"
          meta={
            <>
              <span>{weekLabel(start)}</span>
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
            </>
          }
          index={5}
        >
          {ranking.isLoading ? (
            <FeedbackState kind="loading" title="Rangliste wird geladen" />
          ) : ranking.isError || !data ? (
            <FeedbackState
              kind="error"
              title="Rangliste nicht verfügbar"
              action={<Button onClick={() => void ranking.refetch()}>Erneut versuchen</Button>}
            />
          ) : data.rows.length === 0 ? (
            <FeedbackState kind="empty" title="Noch keine Punkte in dieser Woche">
              Die Rangliste füllt sich, sobald das Punktesystem Punkte vergibt. Jede Woche beginnt
              neu, frühere Wochen bleiben gespeichert.
            </FeedbackState>
          ) : (
            <>
              <ol className="cc-rank">
                {data.rows.map((row) => (
                  <li key={row.user_id} className={row.is_me ? "cc-rank-me" : ""}>
                    <span className={`cc-rank-pos${row.rank === 1 ? " gold" : ""}`}>
                      {row.rank}
                    </span>
                    <span className="cc-rank-avatar">{initials(row.name)}</span>
                    <span className="cc-rank-name">
                      {row.is_me ? `${row.name} (du)` : row.name}
                    </span>
                    <span className="cc-rank-pts">{formatNumber(row.points)}</span>
                  </li>
                ))}
              </ol>
              <p className="cc-pills-note">
                {data.me.rank !== null
                  ? `Deine Platzierung: ${data.me.rank} · ${formatNumber(data.me.points)} Punkte`
                  : "Du hast in dieser Woche noch keine Punkte."}
              </p>
            </>
          )}
        </BentoCard>
      </div>
    </>
  );
}
