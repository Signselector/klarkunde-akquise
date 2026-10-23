import { createFileRoute } from "@tanstack/react-router";
import { StatsView } from "@/components/stats-view";

export const Route = createFileRoute("/_authenticated/daily-stats")({
  head: () => ({ meta: [{ title: "Tagesstatistik – Cold Call Tool" }] }),
  component: DailyStatsPage,
});

function DailyStatsPage() {
  const { user } = Route.useRouteContext();
  return <StatsView userId={user.id} mode="daily" title="Tagesstatistik" />;
}
