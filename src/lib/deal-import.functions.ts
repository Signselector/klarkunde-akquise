import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";

type Contact = { value?: string; primary?: boolean };
const pick = (list: unknown) => {
  const arr = Array.isArray(list) ? (list as Contact[]) : [];
  return (arr.find((c) => c.primary) ?? arr[0])?.value || null;
};
const idOf = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "value" in v) return Number((v as { value: unknown }).value) || null;
  return null;
};

/** Master admin only: pulls an existing Pipedrive deal (e.g. from the old tool) into the Cold Caller Tool and assigns it to a caller. */
export const importDealById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string; dealId: number; callerId: string }) => {
    if (!["DE", "AT"].includes(d?.country)) throw new Error("Ungültiges Land.");
    if (!Number.isInteger(d.dealId) || d.dealId <= 0) throw new Error("Ungültige Deal-ID.");
    if (!/^[0-9a-f-]{36}$/i.test(d.callerId)) throw new Error("Bitte Mitarbeiter wählen.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: master } = await context.supabase.rpc("is_master", { _uid: context.userId });
    if (!master) throw new Error("Nur für den Master-Admin.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await db
      .from("lead_crm_links")
      .select("lead_id")
      .eq("country", data.country)
      .eq("deal_id", data.dealId)
      .maybeSingle();
    if (existing) throw new Error("Dieser Deal ist bereits im Tool vorhanden.");

    const { data: caller } = await db
      .from("user_countries")
      .select("user_id")
      .eq("user_id", data.callerId)
      .eq("country", data.country)
      .maybeSingle();
    if (!caller) throw new Error("Der Mitarbeiter ist diesem Land nicht zugeordnet.");

    const { call } = gatewayClient(data.country);
    let deal: Record<string, unknown>;
    try {
      deal = ((await call(`/deals/${data.dealId}`, { method: "GET" })).data ?? {}) as Record<string, unknown>;
    } catch {
      throw new Error("Deal in Pipedrive nicht gefunden oder Pipedrive nicht erreichbar.");
    }
    if (!deal.id || deal.deleted || deal.status === "deleted") throw new Error("Deal in Pipedrive nicht gefunden.");

    const orgId = idOf(deal.org_id);
    const personId = idOf(deal.person_id);
    const org = deal.org_id as { name?: string } | null;
    const person = deal.person_id as { name?: string; email?: unknown; phone?: unknown } | null;

    const { data: lead, error } = await db
      .from("leads")
      .insert({
        company: org?.name || String(deal.title ?? `Deal ${data.dealId}`),
        contact_name: person?.name ?? null,
        email: pick(person?.email),
        phone: pick(person?.phone),
        status: "appointment",
        last_called_by: data.callerId,
        last_called_at: new Date().toISOString(),
        extra: { imported_deal_id: data.dealId, imported_by: context.userId, source: "manual_deal_import" },
      })
      .select("id")
      .single();
    if (error || !lead) throw new Error("Lead konnte nicht angelegt werden.");

    await db.rpc("crm_save_links", {
      p_lead: lead.id,
      p_country: data.country,
      p_org: orgId as number,
      p_person: personId as number,
      p_deal: data.dealId,
      p_origin: data.callerId,
      p_stage_key: null as unknown as string,
      p_actor: context.userId,
    });
    if (deal.stage_id) {
      await db.rpc("crm_apply_stage", {
        p_country: data.country,
        p_deal_id: data.dealId,
        p_stage_id: Number(deal.stage_id),
        p_event_id: `import-${data.dealId}`,
        p_occurred: null as unknown as string,
        p_source: "pipedrive",
        p_actor: context.userId,
        p_status: (deal.status as string) ?? null,
      });
    }
    const { data: link } = await db
      .from("lead_crm_links")
      .select("current_stage_key,is_customer")
      .eq("lead_id", lead.id)
      .single();
    return {
      leadId: lead.id,
      company: org?.name || String(deal.title ?? ""),
      stageKey: link?.current_stage_key ?? null,
      isCustomer: !!link?.is_customer,
    };
  });
