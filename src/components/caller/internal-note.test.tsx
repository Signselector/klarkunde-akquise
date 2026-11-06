import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { InternalNote } from "./internal-note";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderIt = (value: string | null) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InternalNote leadId="L1" value={value} />
    </QueryClientProvider>,
  );

describe("InternalNote", () => {
  it("new lead: only the closed 'Interne Notiz für dich' fold, no description", () => {
    renderIt(null);
    expect(screen.getByText("Interne Notiz für dich")).toBeTruthy();
    expect(screen.queryByText(/Pipedrive/)).toBeNull();
    expect(document.querySelector("details")?.open).toBe(false);
  });

  it("saved note is shown with a pencil and can be edited and saved", async () => {
    rpc.mockResolvedValue({ error: null });
    renderIt("alt");
    expect(screen.getByText("alt")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Interne Notiz bearbeiten" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "neu" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("update_lead_internal_note", {
        p_lead_id: "L1",
        p_internal_note: "neu",
      }),
    );
  });
});
