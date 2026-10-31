import { describe, expect, it } from "vitest";
import { parseFlow, parseNotes, stripHtml } from "@/lib/deal-detail";

describe("deal detail", () => {
  it("turns note html into text, newest note first", () => {
    const notes = parseNotes([
      { id: 1, content: "<p>Erste &amp; Notiz</p>", add_time: "2026-11-01 10:00:00", user: { name: "Anna" } },
      { id: 2, content: "Zweite<br>Zeile", add_time: "2026-11-02 09:30:00" },
      { id: 3, content: "", add_time: "2026-11-03 09:30:00" },
    ]);
    expect(notes.map((n) => n.id)).toEqual(["2", "1"]);
    expect(notes[1]).toMatchObject({ text: "Erste & Notiz", author: "Anna", at: "2026-11-01T10:00:00.000Z" });
    expect(notes[0]!.text).toBe("Zweite\nZeile");
  });

  it("builds the history from stage changes and activities and drops e-mails and notes", () => {
    const flow = {
      data: [
        { object: "dealChange", timestamp: "2026-11-01 10:00:00", data: { id: 1, field_key: "stage_id", old_value: "3", new_value: "5", user_id: 7 } },
        { object: "activity", timestamp: "2026-11-02 11:00:00", data: { id: 2, type: "task", subject: "Termin Review", done: 0 } },
        { object: "mailMessage", timestamp: "2026-11-02 12:00:00", data: { id: 3, subject: "Hallo" } },
        { object: "note", timestamp: "2026-11-02 12:30:00", data: { id: 4, content: "x" } },
        { object: "dealChange", timestamp: "2026-11-03 08:00:00", data: { id: 5, field_key: "title", old_value: "a", new_value: "b" } },
      ],
      related_objects: { user: { "7": { name: "Max" } } },
    };
    const events = parseFlow(flow, { 3: "Logo Render", 5: "Sehr interessiert" });
    expect(events.map((e) => e.text)).toEqual(["Aufgabe: Termin Review", "Stage: Logo Render → Sehr interessiert"]);
    expect(events[1]!.by).toBe("Max");
  });

  it("strips tags", () => expect(stripHtml("<b>a</b>&nbsp;b")).toBe("a b"));
});
