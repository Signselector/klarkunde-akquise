import { describe, expect, it } from "vitest";
import { buildReviewTask, highPriorityId } from "@/lib/review-task";

describe("buildReviewTask", () => {
  const now = new Date("2026-11-02T09:05:00Z");
  it("is a task named Termin Review, due now, without a priority by default", () => {
    const t = buildReviewTask({ dealId: 5, note: "Notiz", now });
    expect(t).toMatchObject({
      subject: "Termin Review",
      type: "task",
      deal_id: 5,
      due_date: "2026-11-02",
      due_time: "09:05",
      done: 0,
    });
    expect("priority" in t).toBe(false);
  });
  it("sends the priority only when an id is given", () => {
    expect(buildReviewTask({ dealId: 5, note: "x", priorityId: 3, now })).toMatchObject({
      priority: 3,
    });
  });
});

describe("highPriorityId", () => {
  const fields = [
    { key: "subject", name: "Subject" },
    {
      key: "priority",
      name: "Priority",
      options: [
        { id: 1, label: "Low" },
        { id: 2, label: "Medium" },
        { id: 3, label: "High" },
      ],
    },
  ];
  it("finds High", () => expect(highPriorityId(fields)).toBe(3));
  it("also understands German labels", () => {
    expect(highPriorityId([{ key: "priority", options: [{ id: 9, label: "Hoch" }] }])).toBe(9);
  });
  it("returns null when the field or the option is missing", () => {
    expect(highPriorityId([])).toBeNull();
    expect(highPriorityId([{ key: "priority", options: [{ id: 1, label: "Low" }] }])).toBeNull();
    expect(highPriorityId("x")).toBeNull();
  });
});
