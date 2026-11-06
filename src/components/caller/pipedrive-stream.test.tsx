import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const fns = vi.hoisted(() => ({
  check: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/deal-detail.functions", () => ({
  hasLeadDeal: (...a: unknown[]) => fns.check(...a),
  loadLeadStream: (...a: unknown[]) => fns.load(...a),
  updateLeadNote: (...a: unknown[]) => fns.save(...a),
}));
import { PipedriveStream } from "./pipedrive-stream";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderIt = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PipedriveStream leadId="L1" />
    </QueryClientProvider>,
  );

describe("call notes of a lead without Pipedrive deal", () => {
  it("shows them as Gesprächsnotizen and lets the author edit later", async () => {
    fns.check.mockResolvedValue({ linked: false, staff: false, allowed: true });
    fns.load.mockResolvedValue({
      linked: false,
      staff: false,
      source: "local",
      error: null,
      items: [],
      notes: [
        {
          id: "n1",
          at: "2026-11-02T10:00:00Z",
          author: "Anna",
          text: "Rückruf vereinbart",
          editable: true,
        },
        {
          id: "n2",
          at: "2026-11-01T10:00:00Z",
          author: "Ben",
          text: "Fremde Notiz",
          editable: false,
        },
      ],
    });
    fns.save.mockResolvedValue({ ok: true, pipedrive: "skipped" });
    renderIt();
    const summary = await screen.findByText("Gesprächsnotizen · 2");
    fireEvent.click(summary);
    fireEvent(summary.closest("details")!, new Event("toggle"));
    (summary.closest("details") as HTMLDetailsElement).open = true;
    fireEvent(summary.closest("details")!, new Event("toggle"));
    await screen.findByText("Rückruf vereinbart");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Notiz bearbeiten" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Notiz bearbeiten" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Rückruf am Freitag 10 Uhr" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(fns.save).toHaveBeenCalledWith({
        data: { leadId: "L1", noteId: "n1", source: "local", content: "Rückruf am Freitag 10 Uhr" },
      }),
    );
  });

  it("shows no notes section for a new lead without call notes", async () => {
    fns.check.mockResolvedValue({ linked: false, staff: false, allowed: true });
    fns.load.mockResolvedValue({ linked: false, staff: false, source: "local", error: null, items: [], notes: [] });
    const { container } = renderIt();
    await waitFor(() => expect(fns.load).toHaveBeenCalled());
    expect(container.textContent).not.toContain("Gesprächsnotizen");
  });

  it("shows nothing for a lead the user may not see", async () => {
    fns.check.mockResolvedValue({ linked: false, staff: false, allowed: false });
    const { container } = renderIt();
    await waitFor(() => expect(fns.check).toHaveBeenCalled());
    expect(container.querySelector("details")).toBeNull();
  });
});
