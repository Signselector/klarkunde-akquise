import { createFileRoute } from "@tanstack/react-router";
import { StatsView } from "@/components/stats-view";

export const Route = createFileRoute("/_authenticated/stats")({
  head: () => ({ meta: [{ title: "Statistik – Sign Selector Cold Caller" }] }),
  component: StatsPage,
});

function StatsPage() {
  const { user } = Route.useRouteContext();
  return <StatsView userId={user.id} title="Statistik" />;
}
