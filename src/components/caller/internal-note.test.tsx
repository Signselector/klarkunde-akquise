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
  it("is open, says it stays in the tool and starts with the saved text", () => {
    renderIt("Mag keine Anrufe vor 10");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Mag keine Anrufe vor 10",
    );
    expect(screen.getByText(/nicht an Pipedrive übertragen/)).toBeTruthy();
    expect(document.querySelector("details")?.open).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Interne Notiz speichern" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("saves through update_lead_internal_note and can be emptied", async () => {
    rpc.mockResolvedValue({ error: null });
    renderIt("alt");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "neu" } });
    fireEvent.click(screen.getByRole("button", { name: "Interne Notiz speichern" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("update_lead_internal_note", {
        p_lead_id: "L1",
        p_internal_note: "neu",
      }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Interne Notiz speichern" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenLastCalledWith("update_lead_internal_note", {
        p_lead_id: "L1",
        p_internal_note: "",
      }),
    );
  });
});
