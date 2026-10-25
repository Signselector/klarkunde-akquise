import { createFileRoute } from "@tanstack/react-router";
import { MonthlyStats } from "@/components/caller/monthly-stats";

export const Route = createFileRoute("/_authenticated/my-stats")({
  head: () => ({ meta: [{ title: "Statistik – Sign Selector Cold Caller" }] }),
  component: MyStatsPage,
});

function MyStatsPage() {
  const { user } = Route.useRouteContext();
  return <MonthlyStats userId={user.id} />;
}
