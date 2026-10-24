/** Portable worker: no browser credentials, no business-data logging. */
export type Job = {
  job: { id: string; lease_token: string; outcome: "appointment" | "production" };
  lead: {
    id: string;
    company: string | null;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    archived_at: string | null;
  };
  config: {
    pipeline_id: number;
    appointment_stage_id: number;
    production_stage_id: number;
    owner_id: number | null;
  };
  links: { organization_id?: number; person_id?: number; deal_id?: number };
};
export type Result = {
  status: "succeeded" | "pending" | "failed" | "needs_review";
  error?: string;
  retryAfter?: number;
};
export interface Store {
  maintenance(): Promise<void>;
  claim(): Promise<Job[]>;
  checkpoint(job: Job, kind: "organization" | "person" | "deal", id: number): Promise<void>;
  finish(job: Job, result: Result): Promise<void>;
}
export interface Provider {
  write(
    resource: "organizations" | "persons" | "deals",
    data: Record<string, unknown>,
    id?: number,
  ): Promise<number>;
}
export class ProviderFailure extends Error {
  constructor(public result: Result) {
    super(result.error);
  }
}
export async function processJob(job: Job, store: Store, provider: Provider): Promise<Result> {
  const { lead, config, links } = job;
  if (lead.archived_at) return { status: "failed", error: "archived_lead" };
  if (!lead.contact_name?.trim() || (!lead.email?.trim() && !lead.phone?.trim()))
    return { status: "failed", error: "missing_contact" };
  if (
    ![config.pipeline_id, config.appointment_stage_id, config.production_stage_id].every(
      (x) => Number.isSafeInteger(x) && x > 0,
    )
  )
    return { status: "failed", error: "configuration_error" };
  async function save(kind: "organization" | "person" | "deal", id: number) {
    try {
      await store.checkpoint(job, kind, id);
    } catch {
      throw new ProviderFailure({ status: "needs_review", error: "checkpoint_failed" });
    }
  }
  try {
    let org = links.organization_id;
    if (lead.company?.trim()) {
      const id = await provider.write("organizations", { name: lead.company.trim() }, org);
      if (!org) {
        await save("organization", id);
        org = id;
      }
    }
    const person = await provider.write(
      "persons",
      {
        name: lead.contact_name.trim(),
        ...(org ? { org_id: org } : {}),
        ...(lead.email ? { emails: [{ value: lead.email, primary: true, label: "work" }] } : {}),
        ...(lead.phone ? { phones: [{ value: lead.phone, primary: true, label: "work" }] } : {}),
      },
      links.person_id,
    );
    if (!links.person_id) await save("person", person);
    const deal = await provider.write(
      "deals",
      {
        title: `${lead.company || lead.contact_name} [CC:${lead.id}]`,
        person_id: person,
        ...(org ? { org_id: org } : {}),
        pipeline_id: config.pipeline_id,
        stage_id:
          job.job.outcome === "production"
            ? config.production_stage_id
            : config.appointment_stage_id,
        ...(config.owner_id ? { owner_id: config.owner_id } : {}),
      },
      links.deal_id,
    );
    if (!links.deal_id) await save("deal", deal);
    return { status: "succeeded" };
  } catch (error) {
    return error instanceof ProviderFailure
      ? error.result
      : { status: "needs_review", error: "ambiguous_response" };
  }
}
export function pipedriveProvider(
  token: string,
  mode: "api_token" | "oauth" = "api_token",
  fetcher: typeof fetch = fetch,
): Provider {
  return {
    async write(resource, data, id) {
      const method = id ? "PATCH" : "POST";
      let response: Response;
      try {
        response = await fetcher(
          `https://api.pipedrive.com/api/v2/${resource}${id ? `/${id}` : ""}`,
          {
            method,
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            headers: {
              "Content-Type": "application/json",
              ...(mode === "oauth"
                ? { Authorization: `Bearer ${token}` }
                : { "x-api-token": token }),
            },
            body: JSON.stringify(data),
          },
        );
      } catch {
        throw new ProviderFailure({
          status: id ? "pending" : "needs_review",
          error: id ? "network_error" : "ambiguous_response",
        });
      }
      if (response.status === 429) {
        const raw = response.headers.get("retry-after");
        const seconds =
          raw && /^\d+$/.test(raw)
            ? Number(raw)
            : raw
              ? Math.ceil((Date.parse(raw) - Date.now()) / 1000)
              : 60;
        throw new ProviderFailure({
          status: "pending",
          error: "rate_limited",
          retryAfter: Number.isFinite(seconds) ? Math.max(1, Math.min(86400, seconds)) : 60,
        });
      }
      if (response.status === 401 || response.status === 403)
        throw new ProviderFailure({ status: "failed", error: "unauthorized" });
      if (!response.ok)
        throw new ProviderFailure({
          status: response.status >= 500 ? (id ? "pending" : "needs_review") : "failed",
          error:
            response.status >= 500
              ? id
                ? "provider_error"
                : "ambiguous_response"
              : "invalid_payload",
        });
      let payload: { success?: boolean; data?: { id?: number } };
      try {
        payload = await response.json();
      } catch {
        throw new ProviderFailure({ status: "needs_review", error: "ambiguous_response" });
      }
      const externalId = payload.data?.id;
      if (!payload.success || !externalId || !Number.isSafeInteger(externalId) || externalId < 1)
        throw new ProviderFailure({ status: "needs_review", error: "ambiguous_response" });
      return externalId;
    },
  };
}
export function databaseStore(
  url: string,
  serviceKey: string,
  fetcher: typeof fetch = fetch,
): Store {
  const base = new URL(url);
  if (base.protocol !== "https:") throw new Error("configuration_error");
  async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetcher(`${base.origin}/rest/v1/rpc/${name}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        apikey: serviceKey,
        ...(serviceKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${serviceKey}` }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error("database_operation_failed");
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  return {
    async maintenance() {
      await rpc("backend_maintenance");
    },
    claim: () => rpc<Job[]>("claim_integration_jobs", { p_limit: 1 }),
    async checkpoint(job, kind, id) {
      await rpc("checkpoint_integration", {
        p_job_id: job.job.id,
        p_lease_token: job.job.lease_token,
        p_kind: kind,
        p_external_id: id,
      });
    },
    async finish(job, result) {
      await rpc("finish_integration_job", {
        p_job_id: job.job.id,
        p_lease_token: job.job.lease_token,
        p_status: result.status,
        p_error_code: result.error ?? null,
        p_retry_after: result.retryAfter ?? null,
      });
    },
  };
}
export type WorkerConfig = {
  schedulerSecret: string;
  databaseUrl: string;
  serviceKey: string;
  pipedriveToken: string;
  authMode?: "api_token" | "oauth";
};
async function equalSecret(a: string, b: string): Promise<boolean> {
  const hash = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let mismatch = 0;
  for (let i = 0; i < x.length; i++) mismatch |= x[i]! ^ y[i]!;
  return mismatch === 0;
}
export async function handleWorker(
  request: Request,
  config: WorkerConfig,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const reply = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (
    !config.schedulerSecret ||
    !(await equalSecret(
      request.headers.get("authorization") ?? "",
      `Bearer ${config.schedulerSecret}`,
    ))
  )
    return reply(401, { error: "unauthorized" });
  if (!config.databaseUrl || !config.serviceKey || !config.pipedriveToken)
    return reply(503, { error: "configuration_required" });
  try {
    const store = databaseStore(config.databaseUrl, config.serviceKey, fetcher);
    await store.maintenance();
    const jobs = await store.claim();
    for (const job of jobs)
      await store.finish(
        job,
        await processJob(
          job,
          store,
          pipedriveProvider(config.pipedriveToken, config.authMode, fetcher),
        ),
      );
    return reply(200, { processed: jobs.length });
  } catch {
    // Leases expire into needs_review. No raw provider bodies or keys reach logs/client.
    return reply(503, { error: "worker_unavailable" });
  }
}
