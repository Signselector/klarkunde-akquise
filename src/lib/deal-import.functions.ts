import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";
import { detectRenderType, pdToIso, type RenderType, type StatsChoice } from "@/lib/deal-import";

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
    type Deal = { id?: number; deleted?: boolean; status?: string; title?: string; stage_id?: number; org_id?: unknown; person_id?: unknown };
    let deal: Deal;
    try {
      deal = ((await call(`/deals/${data.dealId}`, { method: "GET" })).data ?? {}) as Deal;
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
    // Statistics: book the render result for the caller on the deal's Pipedrive creation date.
    let counted: { type: RenderType; at: string } | null = null;
    let detected: RenderType | null = null;
    if (data.stats !== "none") {
      const { data: map } = await db.from("pipedrive_stage_mapping").select("mapping").eq("country", data.country).maybeSingle();
      const changes: { at: string; oldStageId: number | null; newStageId: number | null }[] = [];
      try {
        const flow = await call(`/deals/${data.dealId}/flow?limit=500`, { method: "GET" });
        for (const e of (Array.isArray(flow?.data) ? flow.data : []) as { object?: string; timestamp?: string; data?: Record<string, unknown> }[]) {
          if (e.object !== "dealChange" || e.data?.field_key !== "stage_id") continue;
          changes.push({
            at: pdToIso(e.timestamp ?? e.data?.log_time) ?? "",
            oldStageId: Number(e.data?.old_value) || null,
            newStageId: Number(e.data?.new_value) || null,
          });
        }
      } catch {
        /* history unavailable: current stage and title still decide */
      }
      detected = detectRenderType({
        mapping: (map?.mapping as Record<string, unknown>) ?? {},
        currentStageId: deal.stage_id ? Number(deal.stage_id) : null,
        stageChanges: changes,
        title: deal.title ?? null,
      });
      const type = data.stats === "auto" ? detected : data.stats;
      const at = pdToIso(deal.add_time) ?? new Date().toISOString();
      if (type) {
        await db.from("status_changes").insert({ lead_id: lead.id, user_id: data.callerId, old_status: "open", new_status: type, created_at: at });
        await db.from("lead_actions").insert({
          lead_id: lead.id,
          user_id: data.callerId,
          action: type,
          stage_key: type,
          crm_sync_state: "synced",
          created_at: at,
          details: { source: "manual_deal_import", deal_id: data.dealId },
        });
        // A month that was already frozen is recalculated on the next read.
        const month = new Date(at).toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" }).slice(0, 7) + "-01";
        await db.from("monthly_quality").delete().eq("user_id", data.callerId).eq("month", month);
        counted = { type, at };
      }
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
      detected,
      counted,
    };
  });
