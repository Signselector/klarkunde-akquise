import { describe, expect, it } from "vitest";
import {
  activityPayload,
  busyFromActivities,
  matchPipedriveUser,
  parseActivity,
  syncCalendar,
  toPipedriveTime,
  type CalItem,
  type CalendarCrm,
  type CalendarStore,
} from "@/lib/calendar-sync";

const item = (over: Partial<CalItem> = {}): CalItem => ({
  kind: "callback",
  id: "c1",
  startsAt: "2026-11-02T09:30:00Z",
  subject: "Rückruf: Muster GmbH",
  note: null,
  dealId: null,
  pdActivityId: null,
  ...over,
});

function setup(over: { items?: CalItem[]; mapped?: number | null; list?: unknown[] } = {}) {
  const log: string[] = [];
  const store: CalendarStore = {
    mappedUser: async () => (over.mapped === undefined ? 7 : over.mapped),
    saveMapping: async (id) => void log.push(`map:${id}`),
    pending: async () => over.items ?? [],
    markPushed: async (i, id) => void log.push(`pushed:${i.id}=${id}`),
    markFailed: async (i, e) => void log.push(`failed:${i.id}:${e}`),
    queue: async () => [],
    dequeue: async () => {},
    apply: async (a) => void log.push(`apply:${a.id}`),
    prune: async (_f, _t, keep) => void log.push(`prune:${keep.join(",")}`),
  };
  const crm: CalendarCrm = {
    users: async () => [{ id: 7, email: "Anna@Example.test" }],
    createActivity: async (p) => (
      log.push(`create:${p["type"]}@${p["due_date"]} ${p["due_time"]} u${p["user_id"]}`),
      500
    ),
    updateActivity: async (id, p) => void log.push(`update:${id}:${Object.keys(p).join("+")}`),
    deleteActivity: async (id) => void log.push(`delete:${id}`),
    list: async () => over.list ?? [],
  };
  return { store, crm, log };
}
const window = { from: "2026-10-01T00:00:00Z", to: "2027-03-01T00:00:00Z" };

describe("calendar sync", () => {
  it("writes UTC date and time for Pipedrive", () => {
    expect(toPipedriveTime("2026-11-02T09:30:00+01:00")).toEqual({
      due_date: "2026-11-02",
      due_time: "08:30",
    });
    const p = activityPayload(item({ kind: "appointment", dealId: 5, note: "x" }), 7);
    expect(p).toMatchObject({
      type: "meeting",
      duration: "00:30",
      user_id: 7,
      deal_id: 5,
      note: "x",
    });
    expect(activityPayload(item(), 7)).toMatchObject({ type: "call", duration: "00:30" });
  });

  it("creates a new activity once and remembers its id; an existing one is only updated", async () => {
    const t = setup({ items: [item(), item({ id: "c2", pdActivityId: 321 })] });
    const r = await syncCalendar({ ...t, email: "anna@example.test", window });
    expect(r).toMatchObject({ state: "synced", pushed: 2 });
    expect(t.log.filter((l) => /^(create|update|pushed)/.test(l))).toEqual([
      "create:call@2026-11-02 09:30 u7",
      "pushed:c1=500",
      expect.stringMatching(/^update:321:/),
      "pushed:c2=321",
    ]);
  });

  it("matches the Pipedrive user by e-mail and says so when there is none", async () => {
    const t = setup({ mapped: null });
    expect((await syncCalendar({ ...t, email: "ANNA@example.test", window })).state).toBe("synced");
    expect(t.log).toContain("map:7");
    const none = setup({ mapped: null });
    expect(await syncCalendar({ ...none, email: "other@example.test", window })).toEqual({
      state: "no_pipedrive_user",
      pushed: 0,
      pulled: 0,
    });
    expect(matchPipedriveUser(null, [])).toBeNull();
  });

  it("keeps an item and reports the error when Pipedrive fails, other items still go out", async () => {
    const t = setup({ items: [item(), item({ id: "c2" })] });
    let n = 0;
    t.crm.createActivity = async () => {
      if (n++ === 0) throw new Error("rate_limited");
      return 600;
    };
    const r = await syncCalendar({ ...t, email: "a@b.test", window });
    expect(r).toMatchObject({ state: "error", error: "rate_limited", pushed: 1 });
    expect(t.log).toContain("failed:c1:rate_limited");
    expect(t.log).toContain("pushed:c2=600");
  });

  it("pulls activities, skips broken ones and prunes with the ids it saw", async () => {
    const t = setup({
      list: [
        {
          id: 11,
          subject: "Telefonat",
          type: "call",
          due_date: "2026-11-03",
          due_time: "10:00:00",
          duration: "00:30:00",
          done: 0,
          deal_id: 4,
        },
        { id: 12 },
        null,
        { id: 13, due_date: "2026-11-04", due_time: "", done: true },
      ],
    });
    const r = await syncCalendar({ ...t, email: "a@b.test", window });
    expect(r).toMatchObject({ state: "synced", pulled: 2 });
    expect(t.log.filter((l) => /^(apply|prune)/.test(l))).toEqual([
      "apply:11",
      "apply:13",
      "prune:11,13",
    ]);
    expect(
      parseActivity({ id: 1, due_date: "2026-11-03", due_time: "10:00:00", duration: "01:30:00" }),
    ).toMatchObject({
      due_at: "2026-11-03T10:00:00.000Z",
      duration_min: 90,
    });
  });

  it("processes the queue: deletions and closed callbacks reach Pipedrive", async () => {
    const t = setup();
    const done: string[] = [];
    t.store.queue = async () => [
      { id: "q1", activityId: 1, action: "delete" },
      { id: "q2", activityId: 2, action: "done" },
    ];
    t.store.dequeue = async (id) => void done.push(id);
    await syncCalendar({ ...t, email: "a@b.test", window });
    expect(t.log).toContain("delete:1");
    expect(t.log).toContain("update:2:done");
    expect(done).toEqual(["q1", "q2"]);
  });
});

describe("busyFromActivities", () => {
  it("keeps open meetings as anonymous start/end only", () => {
    const rows = busyFromActivities([
      { id: 1, type: "meeting", due_date: "2026-11-03", due_time: "10:00", duration: "00:30", subject: "Geheim", person_name: "X" },
      { id: 2, type: "call", due_date: "2026-11-03", due_time: "10:00" },
      { id: 3, type: "meeting", due_date: "2026-11-03", due_time: "11:00", done: true },
      { id: 4, type: "meeting", due_date: "2026-11-03", due_time: "12:00", duration: "01:00" },
      "junk",
    ]);
    expect(rows).toEqual([
      { id: 1, starts_at: "2026-11-03T10:00:00.000Z", ends_at: "2026-11-03T10:30:00.000Z" },
      { id: 4, starts_at: "2026-11-03T12:00:00.000Z", ends_at: "2026-11-03T13:00:00.000Z" },
    ]);
  });
});
