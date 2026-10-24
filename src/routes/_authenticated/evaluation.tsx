import { createFileRoute } from "@tanstack/react-router";
import { StatsView } from "@/components/stats-view";

export const Route = createFileRoute("/_authenticated/evaluation")({
  head: () => ({ meta: [{ title: "Auswertung – Sign Selector Cold Caller" }] }),
  component: EvaluationPage,
});

function EvaluationPage() {
  const { user } = Route.useRouteContext();
  return <StatsView userId={user.id} mode="evaluation" title="Auswertung" />;
}
