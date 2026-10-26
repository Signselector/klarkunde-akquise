import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";
import { CrmError } from "@/lib/crm-sync";
import { fetchDeals, MAX_DEALS, type DealInfo, type DealReader } from "@/lib/crm-customers";
import type { CustomerDeal } from "@/lib/customer-stages";

type Raw = { id?: number; stage_id?: number | null; status?: string | null };
const toInfo = (d: Raw): DealInfo | null =>
  d && Number.isSafeInteger(d.id)
    ? {
        id: d.id as number,
        stage_id: Number.isSafeInteger(d.stage_id) ? (d.stage_id as number) : null,
        status: d.status ?? null,
      }
    : null;

export function gatewayReader(
  country: string,
): DealReader & { stages(): Promise<{ id: number; name: string; pipeline: string }[]> } {
  const { call } = gatewayClient(country);
  return {
    async listByIds(ids) {
      const r = await call(`/deals?ids=${ids.join(",")}&limit=100`, { method: "GET" });
      return (Array.isArray(r.data) ? (r.data as Raw[]) : [])
        .map(toInfo)
        .filter((d): d is DealInfo => !!d);
    },
    async get(id) {
      try {
        const r = await call(`/deals/${id}`, { method: "GET" });
        return toInfo((r.data ?? {}) as Raw);
      } catch (e) {
        // A deal that was deleted in Pipedrive answers 404.
        if (e instanceof CrmError && e.code === "invalid_payload") return null;
        throw e;
      }
    },
    async stages() {
      const r = await call("/stages", { method: "GET" });
      const list = (r.data ?? []) as { id: number; name: string; pipeline_name?: string }[];
      return list.map((s) => ({
        id: s.id,
        name: String(s.name).trim(),
        pipeline: s.pipeline_name ?? "",
      }));
    },
  };
}

export type MyCustomers = {
  country: string;
  deals: CustomerDeal[];
  stageNames: Record<number, string>;
  /** Set when Pipedrive could not be read: the deals then show the last stage recorded in this tool. */
  error: string | null;
  fetchedAt: string;
  truncated: boolean;
};

/**
 * The caller's own deals with their current Pipedrive stage. "Own" means the caller recorded a CRM action for the
 * lead in this tool. Read only; nothing is written to Pipedrive or the database.
 */
export const loadMyCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string }) => {
    if (!d || !/^[A-Z]{2}$/.test(d.country)) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }): Promise<MyCustomers> => {
    const { data: allowed } = await context.supabase.rpc("can_access_country", {
      _c: data.country,
    });
    if (!allowed) throw new Error("Für dieses Land hast du keinen Zugriff.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    // Every deal this caller originally created, customer or not: a deal only becomes a customer once Pipedrive
    // moves it into one of the customer stages, so the live stages are applied first.
    const mine = await db
      .from("lead_crm_links")
      .select("deal_id")
      .eq("country", data.country)
      .eq("origin_caller_id", context.userId)
      .not("deal_id", "is", null)
      .limit(MAX_DEALS);
    const dealIds = (mine.data ?? []).map((l) => l.deal_id as number);
    let infos = new Map<number, DealInfo | null>();
    let error: string | null = null;
    let stageNames: Record<number, string> = {};
    if (dealIds.length) {
      try {
        const reader = gatewayReader(data.country);
        infos = await fetchDeals(reader, dealIds);
        stageNames = Object.fromEntries(
          (await reader.stages().catch(() => [])).map((s) => [s.id, s.name]),
        );
        const hour = new Date().toISOString().slice(0, 13);
        for (const [id, info] of infos) {
          if (!info) continue;
          const status = info.status === "won" || info.status === "lost" ? info.status : null;
          await db.rpc("crm_apply_stage", {
            p_country: data.country,
            p_deal_id: id,
            p_stage_id: info.stage_id,
            p_event_id: `view:${id}:${info.stage_id ?? "-"}:${status ?? "-"}:${hour}`,
            p_occurred: new Date().toISOString(),
            p_source: "pipedrive",
            p_actor_name: "Pipedrive (Abgleich)",
            p_status: status,
          });
        }
      } catch (e) {
        error = e instanceof CrmError ? e.code : "network_error";
      }
    }
    const { data: rows, error: readError } = await context.supabase.rpc("get_my_customers", {
      p_country: data.country,
    });
    if (readError) throw new Error(readError.message);
    const list = (rows ?? []) as unknown as {
      lead_id: string;
      deal_id: number;
      company: string | null;
      contact_name: string | null;
      email: string | null;
      phone: string | null;
      last_called_at: string | null;
      stage_key: string | null;
      stage_id: number | null;
      deal_status: string | null;
    }[];
    const deals: CustomerDeal[] = [];
    for (const l of list) {
      const info = infos.get(l.deal_id);
      if (!error && info === null) continue; // deleted in Pipedrive
      deals.push({
        lead_id: l.lead_id,
        deal_id: l.deal_id,
        company: l.company,
        contact_name: l.contact_name,
        email: l.email,
        phone: l.phone,
        last_called_at: l.last_called_at,
        stage_id: info?.stage_id ?? l.stage_id,
        deal_status: info?.status ?? l.deal_status,
        local_stage_key: l.stage_key,
        source: error || !info ? "local" : "pipedrive",
      });
    }
    return {
      country: data.country,
      deals,
      stageNames,
      error,
      fetchedAt: new Date().toISOString(),
      truncated: dealIds.length >= MAX_DEALS,
    };
  });
