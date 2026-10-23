import { createFileRoute } from "@tanstack/react-router";
import { StatusLeadList } from "@/components/status-lead-list";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "Meine Kunden – Cold Call Tool" }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const { user } = Route.useRouteContext();
  return <StatusLeadList userId={user.id} title="Meine Kunden" statuses={["appointment", "production"]} />;
}
