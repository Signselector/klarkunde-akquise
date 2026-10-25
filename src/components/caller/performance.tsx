import { useQuery } from "@tanstack/react-query";
import { backendEnabled, backendRpc } from "@/lib/backend";
import { FeedbackState, MetricCard, Surface } from "@/components/coldcaller/primitives";
import { Phone, Users, ChartNoAxesColumn, Crown } from "@/components/coldcaller/icons";
import { Button } from "@/components/ui/button";

type DailyPerformance = {
  attempts: number;
  reached: number;
  appointments: number;
  not_reached: number;
  callback: number;
  no_interest: number;
};
export function CallerPerformance({ userId }: { userId: string }) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(new Date());
  const query = useQuery({
    queryKey: ["caller-performance", userId, today],
    enabled: backendEnabled,
    refetchInterval: 60_000,
    queryFn: async () =>
      (await backendRpc("get_dashboard", {
        p_from: today,
        p_to: today,
        p_scope: "mine",
      })) as DailyPerformance,
  });
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Leadqualität",
            icon: <Crown />,
            context: "Qualitätsbewertung noch nicht angebunden",
          },
          {
            label: "Eingebrachte Leads",
            icon: <Users />,
            context: "Persönliche Zuordnung noch nicht verfügbar",
          },
          {
            label: "Durchschnitt",
            icon: <ChartNoAxesColumn />,
            context: "Kennzahl wird noch festgelegt",
          },
        ].map((item) => (
          <MetricCard
            key={item.label}
            {...item}
            value="—"
            help="Diese Kennzahl wird erst angezeigt, wenn bestätigte Werte aus der Statistik-Anbindung vorliegen."
          />
        ))}
        <MetricCard
          label="Anrufe heute"
          value={query.data?.attempts ?? "—"}
          context="Deine Tagesleistung · Europe/Vienna"
          help="Vom Server bestätigte Anrufergebnisse des heutigen Tages. Länderübergreifend für dein Konto."
          icon={<Phone />}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Surface
          title="Deine Tagesstatistik"
          description="Heute · alle Länder · ausschließlich deine Ergebnisse"
        >
          {query.isLoading ? (
            <FeedbackState kind="loading" title="Tagesleistung wird geladen" />
          ) : query.isError ? (
            <FeedbackState
              kind="error"
              title="Tagesstatistik nicht verfügbar"
              action={<Button onClick={() => query.refetch()}>Erneut versuchen</Button>}
            />
          ) : !query.data ? (
            <FeedbackState kind="empty" title="Statistik noch nicht angebunden" />
          ) : (
            <dl className="grid grid-cols-2 gap-4">
              {[
                ["Erreichte Kontakte", query.data.reached],
                ["Rückrufe", query.data.callback],
                ["Nicht erreicht", query.data.not_reached],
                ["Kein Interesse", query.data.no_interest],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border p-4">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Surface>
        <Surface title="Wochenrangliste" description="Caller · Punkte · Rewards">
          <FeedbackState kind="empty" title="Die Rangliste wartet auf die Punktefreigabe">
            Bestätigte Wochenpunkte und Rewards werden hier angezeigt, sobald die
            Statistik-Anbindung bereitsteht.
          </FeedbackState>
        </Surface>
      </div>
    </div>
  );
}
