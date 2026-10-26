import { describe, expect, it } from "vitest";
import { basicAuthOk, parseDealWebhook } from "./pipedrive-webhook";

describe("parseDealWebhook", () => {
  it("reads a v1 update", () => {
    const e = parseDealWebhook({
      v: 1,
      event: "updated.deal",
      current: { id: 55, stage_id: 8, status: "open", update_time: "2026-10-26 09:00:00" },
      previous: { stage_id: 36 },
      meta: { object: "deal", id: 55, timestamp: 1790000000 },
    });
    expect(e).toMatchObject({ dealId: 55, stageId: 8, status: "open", deleted: false });
    expect(e?.eventId).toContain("55:8:open");
  });
  it("reads a v2 change", () => {
    const e = parseDealWebhook({
      meta: {
        version: "2.0",
        action: "change",
        entity: "deal",
        entity_id: "x",
        timestamp: "2026-10-26T09:00:00Z",
      },
      data: { id: 77, stage_id: 9, status: "won" },
    });
    expect(e).toMatchObject({ dealId: 77, stageId: 9, status: "won" });
  });
  it("gives the same event id for the same delivery", () => {
    const body = {
      v: 1,
      event: "updated.deal",
      current: { id: 5, stage_id: 1, status: "open" },
      meta: { object: "deal", timestamp: 1790000000 },
    };
    expect(parseDealWebhook(body)?.eventId).toBe(parseDealWebhook(structuredClone(body))?.eventId);
  });
  it("ignores other objects and garbage", () => {
    expect(parseDealWebhook({ meta: { object: "person" } })).toBeNull();
    expect(parseDealWebhook(null)).toBeNull();
    expect(parseDealWebhook("x")).toBeNull();
  });
  it("marks deleted deals", () => {
    expect(
      parseDealWebhook({
        v: 1,
        event: "deleted.deal",
        previous: { id: 3 },
        meta: { object: "deal" },
      }),
    ).toMatchObject({ deleted: true, status: "deleted" });
  });
});

describe("basicAuthOk", () => {
  const header = `Basic ${btoa("hook:secret")}`;
  it("accepts the right credentials only", () => {
    expect(basicAuthOk(header, "hook", "secret")).toBe(true);
    expect(basicAuthOk(header, "hook", "wrong")).toBe(false);
    expect(basicAuthOk(null, "hook", "secret")).toBe(false);
    expect(basicAuthOk(header, undefined, undefined)).toBe(false);
    expect(basicAuthOk("Basic !!!", "hook", "secret")).toBe(false);
  });
});
