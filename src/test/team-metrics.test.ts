import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleTeamMetrics, parseTeamMetrics } from "../../supabase/functions/_shared/team-metrics";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

const config = {
  secret: "s3cret",
  databaseUrl: "https://db.example.test",
  serviceKey: "service-key",
};
const row = {
  email: "Anna@Example.test ",
  period: "2026-09",
  lead_quality: 8.5,
  leads_contributed: 31,
};
const post = (body: unknown, auth = "Bearer s3cret") =>
  new Request("https://fn.example.test/team-metrics", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("parseTeamMetrics", () => {
  it("normalises e-mail and month", () => {
    expect(parseTeamMetrics({ rows: [row] })).toEqual([
      {
        email: "anna@example.test",
        period: "2026-09-01",
        lead_quality: 8.5,
        leads_contributed: 31,
      },
    ]);
  });
  it("accepts missing values as null but never invents them", () => {
    const rows = parseTeamMetrics({ rows: [{ email: "a@b.de", period: "2026-09-15" }] });
    expect(rows?.[0]).toMatchObject({
      lead_quality: null,
      leads_contributed: null,
      period: "2026-09-01",
    });
  });
  it.each([
    [{}],
    [{ rows: [] }],
    [{ rows: [{ ...row, email: "kein-mail" }] }],
    [{ rows: [{ ...row, period: "2026-13" }] }],
    [{ rows: [{ ...row, lead_quality: -1 }] }],
    [{ rows: [{ ...row, lead_quality: "8" }] }],
    [{ rows: [{ ...row, leads_contributed: 1.5 }] }],
    [{ rows: [row, { ...row, email: "x" }] }],
  ])("rejects the whole payload when one value is wrong: %j", (body) => {
    expect(parseTeamMetrics(body)).toBeNull();
  });
});

describe("handleTeamMetrics", () => {
  it("rejects wrong methods and wrong secrets before touching the database", async () => {
    const fetcher = vi.fn();
    expect(
      (await handleTeamMetrics(new Request("https://x.test", { method: "GET" }), config, fetcher))
        .status,
    ).toBe(405);
    expect(
      (await handleTeamMetrics(post({ rows: [row] }, "Bearer wrong"), config, fetcher)).status,
    ).toBe(401);
    expect((await handleTeamMetrics(post({ rows: [row] }, ""), config, fetcher)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends the cleaned rows to the database and reports unmatched employees", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).p_rows).toHaveLength(1);
      return new Response(JSON.stringify({ updated: 1, unmatched: ["ghost@example.test"] }), {
        status: 200,
      });
    });
    const res = await handleTeamMetrics(
      post({ rows: [row] }),
      config,
      fetcher as unknown as typeof fetch,
    );
    expect(await res.json()).toEqual({ updated: 1, unmatched: ["ghost@example.test"] });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://db.example.test/rest/v1/rpc/upsert_team_metrics",
    );
  });
  it("answers 400 for a broken payload and 502 when the database fails, without details", async () => {
    expect(
      (await handleTeamMetrics(post({ rows: [{ ...row, email: "x" }] }), config, vi.fn())).status,
    ).toBe(400);
    const failing = vi.fn(async () => new Response("secret detail", { status: 500 }));
    const res = await handleTeamMetrics(
      post({ rows: [row] }),
      config,
      failing as unknown as typeof fetch,
    );
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret detail");
  });
  it("refuses to run without configuration", async () => {
    const res = await handleTeamMetrics(
      post({ rows: [row] }),
      { ...config, serviceKey: "" },
      vi.fn(),
    );
    expect(res.status).toBe(503);
  });
});
