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

function gatewayReader(
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
    const actions = await db
      .from("lead_actions")
      .select("lead_id,stage_key,created_at")
      .eq("user_id", context.userId)
      .not("stage_key", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    const latest = new Map<string, string | null>();
    for (const a of actions.data ?? [])
      if (!latest.has(a.lead_id)) latest.set(a.lead_id, a.stage_key);
    const leadIds = [...latest.keys()];
    const empty = {
      country: data.country,
      deals: [],
      stageNames: {},
      error: null,
      fetchedAt: new Date().toISOString(),
      truncated: false,
    };
    if (!leadIds.length) return empty;
    // Query in slices of 100 ids so the request URLs stay short.
    const links: { lead_id: string; deal_id: number | null }[] = [];
    const leadRows: {
      id: string;
      company: string | null;
      contact_name: string | null;
      email: string | null;
      phone: string | null;
      last_called_at: string | null;
    }[] = [];
    for (let i = 0; i < leadIds.length; i += 100) {
      const slice = leadIds.slice(i, i + 100);
      const [l, r] = await Promise.all([
        db
          .from("lead_crm_links")
          .select("lead_id,deal_id")
          .eq("country", data.country)
          .in("lead_id", slice)
          .not("deal_id", "is", null),
        db
          .from("leads")
          .select("id,company,contact_name,email,phone,last_called_at")
          .in("id", slice),
      ]);
      links.push(...(l.data ?? []));
      leadRows.push(...(r.data ?? []));
    }
    const leadById = new Map(leadRows.map((l) => [l.id, l]));
    const own = links.filter((l) => l.deal_id !== null);
    const truncated = own.length > MAX_DEALS;
    let infos = new Map<number, DealInfo | null>();
    let error: string | null = null;
    let stageNames: Record<number, string> = {};
    try {
      const reader = gatewayReader(data.country);
      infos = await fetchDeals(
        reader,
        own.map((l) => l.deal_id as number),
      );
      stageNames = Object.fromEntries(
        (await reader.stages().catch(() => [])).map((s) => [s.id, s.name]),
      );
    } catch (e) {
      error = e instanceof CrmError ? e.code : "network_error";
    }
    const deals: CustomerDeal[] = [];
    for (const l of own.slice(0, MAX_DEALS)) {
      const lead = leadById.get(l.lead_id);
      const info = infos.get(l.deal_id as number);
      if (!error && info === null) continue; // deleted in Pipedrive
      deals.push({
        lead_id: l.lead_id,
        deal_id: l.deal_id as number,
        company: lead?.company ?? null,
        contact_name: lead?.contact_name ?? null,
        email: lead?.email ?? null,
        phone: lead?.phone ?? null,
        last_called_at: lead?.last_called_at ?? null,
        stage_id: info?.stage_id ?? null,
        deal_status: info?.status ?? null,
        local_stage_key: latest.get(l.lead_id) ?? null,
        source: error || !info ? "local" : "pipedrive",
      });
    }
    return {
      country: data.country,
      deals,
      stageNames,
      error,
      fetchedAt: new Date().toISOString(),
      truncated,
    };
  });
