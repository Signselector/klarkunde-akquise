import { useQuery } from "@tanstack/react-query";
import { backendEnabled, backendRpc } from "@/lib/backend";
import { FeedbackState, Surface } from "@/components/coldcaller/primitives";
import { Button } from "@/components/ui/button";

type DailyPerformance = {
  attempts: number;
  reached: number;
  appointments: number;
  not_reached: number;
  callback: number;
  no_interest: number;
};

/** Today's confirmed numbers of this caller. Quality, ranking and rewards are not shown until their rules exist. */
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
    <Surface title="Heute" description="Deine bestätigten Ergebnisse, alle Länder, Wiener Zeit">
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
        <dl className="cc-figures">
          {[
            ["Anrufe", query.data.attempts],
            ["Erreichte Kontakte", query.data.reached],
            ["Rückrufe", query.data.callback],
            ["Nicht erreicht", query.data.not_reached],
            ["Kein Interesse", query.data.no_interest],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value ?? "–"}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="cc-surface-note">
        Leadqualität, eingebrachte Leads, Durchschnitt und die Wochenrangliste erscheinen hier,
        sobald die Regeln dafür freigegeben sind. Bis dahin zeigen wir keine Zahlen dazu.
      </p>
    </Surface>
  );
}
