import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { CallbackReminder } from "./callback-reminder";
const fixture = vi.hoisted(() => ({
  toast: vi.fn(),
  rows: [
    {
      id: "callback-1",
      due_at: "2026-01-01T10:00:00Z",
      lead: { id: "lead-1", company: "Testfirma" },
    },
  ],
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: fixture.rows }) }));
vi.mock("@/lib/country", () => ({ useCountry: () => "AT" }));
vi.mock("sonner", () => ({ toast: fixture.toast }));
vi.mock("@/components/caller/lead-dialog", () => ({
  LeadDialog: ({ leadId, onClose }: { leadId: string | null; onClose: () => void }) =>
    leadId ? (
      <div role="dialog">
        <button onClick={onClose}>Schließen</button>
      </div>
    ) : null,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("opens a due reminder above the working draft and notifies once per due time", () => {
  function Harness() {
    const [draft, setDraft] = useState("");
    return (
      <>
        <textarea
          aria-label="Gesprächsnotiz"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <CallbackReminder userId="caller" />
      </>
    );
  }
  const view = render(<Harness />);
  fireEvent.change(screen.getByLabelText("Gesprächsnotiz"), {
    target: { value: "Ungespeicherte Notiz" },
  });
  expect(fixture.toast).toHaveBeenCalledTimes(1);
  const options = fixture.toast.mock.calls[0]![1];
  options.action.onClick();
  // Flush the reminder state through the same mounted tree.
  view.rerender(<Harness />);
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByText("Schließen"));
  expect((screen.getByLabelText("Gesprächsnotiz") as HTMLTextAreaElement).value).toBe(
    "Ungespeicherte Notiz",
  );
  expect(fixture.toast).toHaveBeenCalledTimes(1);
});
