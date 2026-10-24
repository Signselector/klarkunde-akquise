import { webcrypto } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  processJob,
  pipedriveProvider,
  handleWorker,
  type Job,
  type Store,
} from "../../supabase/functions/_shared/integration-worker";
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const job: Job = {
  job: { id: "job", lease_token: "lease", outcome: "appointment" },
  lead: {
    id: "lead",
    company: "Example",
    contact_name: "Contact",
    email: "contact@example.test",
    phone: null,
    archived_at: null,
  },
  config: { pipeline_id: 1, appointment_stage_id: 2, production_stage_id: 3, owner_id: null },
  links: {},
};
const store = (): Store => ({
  maintenance: vi.fn(),
  claim: vi.fn(),
  checkpoint: vi.fn(),
  finish: vi.fn(),
});
describe("Pipedrive processing", () => {
  it("checkpoints each created entity and reuses IDs on subsequent jobs", async () => {
    const s = store();
    const provider = {
      write: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3),
    };
    expect(await processJob(job, s, provider)).toEqual({ status: "succeeded" });
    expect(s.checkpoint).toHaveBeenNthCalledWith(1, job, "organization", 1);
    expect(s.checkpoint).toHaveBeenNthCalledWith(3, job, "deal", 3);
    const next = {
      ...job,
      job: { ...job.job, outcome: "production" as const },
      links: { organization_id: 1, person_id: 2, deal_id: 3 },
    };
    provider.write.mockResolvedValue(3);
    const reused = store();
    await processJob(next, reused, provider);
    expect(reused.checkpoint).not.toHaveBeenCalled();
    expect(provider.write).toHaveBeenLastCalledWith(
      "deals",
      expect.objectContaining({ stage_id: 3 }),
      3,
    );
  });
  it("stops after a failed checkpoint rather than creating downstream duplicates", async () => {
    const s = store();
    vi.mocked(s.checkpoint).mockRejectedValue(new Error("db down"));
    const provider = { write: vi.fn().mockResolvedValue(1) };
    expect(await processJob(job, s, provider)).toEqual({
      status: "needs_review",
      error: "checkpoint_failed",
    });
    expect(provider.write).toHaveBeenCalledTimes(1);
  });
  it("does not contact provider for missing contact or archived lead", async () => {
    const p = { write: vi.fn() };
    expect(
      (await processJob({ ...job, lead: { ...job.lead, contact_name: null } }, store(), p)).error,
    ).toBe("missing_contact");
    expect(
      (await processJob({ ...job, lead: { ...job.lead, archived_at: "now" } }, store(), p)).error,
    ).toBe("archived_lead");
    expect(p.write).not.toHaveBeenCalled();
  });
  it("treats ambiguous creates as review, but safely retries updates", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));
    const p = pipedriveProvider("secret", "api_token", fetcher);
    await expect(p.write("deals", {})).rejects.toMatchObject({
      result: { status: "needs_review" },
    });
    await expect(p.write("deals", {}, 3)).rejects.toMatchObject({ result: { status: "pending" } });
  });
  it("honors rate limits and fails closed on unauthorized or malformed replies", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "120" } }))
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("invalid"));
    const p = pipedriveProvider("secret", "api_token", fetcher);
    await expect(p.write("deals", {})).rejects.toMatchObject({
      result: { status: "pending", retryAfter: 120 },
    });
    await expect(p.write("deals", {})).rejects.toMatchObject({
      result: { status: "failed", error: "unauthorized" },
    });
    await expect(p.write("deals", {})).rejects.toMatchObject({
      result: { status: "needs_review" },
    });
    expect(fetcher.mock.calls[0]![0]).not.toContain("secret");
  });
  it("rejects unconfigured or unauthenticated scheduler calls without network activity", async () => {
    const f = vi.fn();
    const config = { schedulerSecret: "", databaseUrl: "", serviceKey: "", pipedriveToken: "" };
    expect(
      (await handleWorker(new Request("https://worker.test", { method: "POST" }), config, f))
        .status,
    ).toBe(401);
    expect((await handleWorker(new Request("https://worker.test"), config, f)).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
  });
  it("authenticates the scheduler and processes a complete HTTP-backed job", async () => {
    const config = {
      schedulerSecret: "scheduler-test",
      databaseUrl: "https://cloud.example.test",
      serviceKey: "sb_secret_test",
      pipedriveToken: "provider-test",
    };
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const headers = new Headers(init?.headers);
      if (target.startsWith("https://api.pipedrive.com/")) {
        expect(headers.get("x-api-token")).toBe("provider-test");
        expect(headers.has("apikey")).toBe(false);
        return Response.json({ success: true, data: { id: 10 } });
      }
      expect(target.startsWith("https://cloud.example.test/rest/v1/rpc/")).toBe(true);
      expect(headers.get("apikey")).toBe("sb_secret_test");
      expect(headers.has("x-api-token")).toBe(false);
      return Response.json(target.endsWith("claim_integration_jobs") ? [job] : null);
    });
    const unauthorized = await handleWorker(
      new Request("https://worker.test", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      }),
      config,
      fetcher,
    );
    expect(unauthorized.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    const result = await handleWorker(
      new Request("https://worker.test", {
        method: "POST",
        headers: { Authorization: "Bearer scheduler-test" },
      }),
      config,
      fetcher,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ processed: 1 });
    const last = fetcher.mock.calls.at(-1)!;
    expect(String(last[0])).toContain("finish_integration_job");
    expect(JSON.parse(String(last[1]?.body))).toMatchObject({
      p_status: "succeeded",
      p_lease_token: "lease",
    });
  });
  it("does not claim jobs before provider credentials are configured", async () => {
    const fetcher = vi.fn();
    const result = await handleWorker(
      new Request("https://worker.test", {
        method: "POST",
        headers: { Authorization: "Bearer scheduler-test" },
      }),
      {
        schedulerSecret: "scheduler-test",
        databaseUrl: "https://cloud.example.test",
        serviceKey: "service-test",
        pipedriveToken: "",
      },
      fetcher,
    );
    expect(result.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
