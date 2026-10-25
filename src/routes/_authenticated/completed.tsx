import { createFileRoute } from "@tanstack/react-router";
import { StatusLeadList } from "@/components/status-lead-list";

export const Route = createFileRoute("/_authenticated/completed")({
  head: () => ({ meta: [{ title: "Abgeschlossen – Sign Selector Cold Caller" }] }),
  component: CompletedPage,
});

function CompletedPage() {
  const { user } = Route.useRouteContext();
  return <StatusLeadList userId={user.id} title="Abgeschlossene Leads" />;
}
