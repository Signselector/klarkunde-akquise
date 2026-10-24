import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { CallbackDialog } from "./callback-dialog";
import { SyncIndicator } from "./primitives";

afterEach(cleanup);
const callback = { company: "Testfirma", contact: "Kontakt", phone: "+43 000", dueLabel: "jetzt" };

describe("callback interruption", () => {
  it("keeps the surrounding draft when dismissed with Escape", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [draft, setDraft] = useState("");
      return (
        <>
          <label>
            Notiz
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <button onClick={() => setOpen(true)}>Rückruf</button>
          <CallbackDialog
            open={open}
            onOpenChange={setOpen}
            callback={callback}
            onCall={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Harness />);
    const draft = screen.getByRole("textbox", { name: "Notiz" });
    fireEvent.change(draft, { target: { value: "Unfertige Gesprächsnotiz" } });
    fireEvent.click(screen.getByRole("button", { name: "Rückruf" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(draft).toHaveValue("Unfertige Gesprächsnotiz");
  });
  it("only invokes a call when explicitly requested", () => {
    const onCall = vi.fn();
    render(<CallbackDialog open onOpenChange={() => {}} callback={callback} onCall={onCall} />);
    expect(onCall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Jetzt anrufen" }));
    expect(onCall).toHaveBeenCalledTimes(1);
  });
});

it("does not describe a queued sync as transferred", () => {
  render(<SyncIndicator state="queued" />);
  expect(screen.getByRole("status")).toHaveTextContent("Vorgemerkt");
  expect(screen.getByRole("status")).toHaveTextContent("Noch nicht an Pipedrive übertragen.");
  expect(screen.queryByText("Übertragen", { exact: true })).not.toBeInTheDocument();
});
