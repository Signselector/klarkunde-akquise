import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CustomersPipeline } from "./customers-pipeline";

const fixture = vi.hoisted(() => ({
  response: {
    country: "DE",
    error: null as string | null,
    truncated: false,
    fetchedAt: "2026-10-24T10:00:00Z",
    stageNames: { 99: "Unbekannte Stage" } as Record<number, string>,
    deals: [] as unknown[],
  },
}));
vi.mock("@/lib/country", () => ({ useCountry: () => "DE" }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/customers.functions", () => ({ loadMyCustomers: async () => fixture.response }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { mapping: { waiting_3d: 7, low_q: 8 } },
            error: null,
          }),
        }),
      }),
    }),
  },
}));
afterEach(() => {
  cleanup();
  fixture.response.error = null;
  fixture.response.deals = [];
});
const deal = (n: number, stage: number | null, source = "pipedrive") => ({
  lead_id: `l${n}`,
  deal_id: n,
  company: `Firma ${n}`,
  contact_name: "Max",
  email: null,
  phone: null,
  last_called_at: null,
  stage_id: stage,
  deal_status: "open",
  local_stage_key: null,
  source,
});
const renderBoard = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CustomersPipeline userId="u1" />
    </QueryClientProvider>,
  );

it("shows deals in the column of their Pipedrive stage and the other stages separately", async () => {
  fixture.response.deals = [deal(1, 8), deal(2, 7), deal(3, 99)];
  renderBoard();
  const lowQ = await screen.findByRole("region", { name: "Logo Render" });
  expect(within(lowQ).getByText("Firma 1")).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Logo ausstehend" })).getByText("Firma 2"),
  ).toBeTruthy();
  const other = screen.getByRole("region", { name: "Weitere Stages" });
  expect(within(other).getByText("Firma 3")).toBeTruthy();
  expect(within(other).getByText("Unbekannte Stage")).toBeTruthy();
  // Columns without a configured stage say so instead of guessing one.
  const noShow = screen.getByRole("region", { name: "Termin nicht wahrgenommen" });
  expect(within(noShow).getByText(/Stage nicht zugeordnet/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("marks the view as not synchronized when Pipedrive could not be read", async () => {
  fixture.response.error = "unauthorized";
  fixture.response.deals = [deal(1, null, "local")];
  renderBoard();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/Nicht mit Pipedrive synchronisiert/);
  expect(alert.textContent).toMatch(/Anmeldung abgelehnt/);
});
