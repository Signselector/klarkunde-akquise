import { createFileRoute } from "@tanstack/react-router";
import { CustomersPipeline } from "@/components/caller/customers-pipeline";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "Meine Kunden – Sign Selector Cold Caller" }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const { user } = Route.useRouteContext();
  return <CustomersPipeline userId={user.id} />;
}
