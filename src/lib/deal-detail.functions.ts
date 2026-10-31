import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";
import { gatewayReader } from "@/lib/customers.functions";
import { CrmError } from "@/lib/crm-sync";
import { parseFlow, parseNotes, type DealEvent, type DealNote } from "@/lib/deal-detail";

export type DealDetail = {
  source: "pipedrive" | "local";
  notes: DealNote[];
  events: DealEvent[];
  /** Set when Pipedrive could not be read; the notes and the history of the tool are shown instead. */
  error: string | null;
};

/**
 * Notes and history of one deal for "Meine Kunden", read live from Pipedrive. E-mails are never returned. Allowed for
 * the caller whose customer it is and for managers and admins of the country. Demo deals (negative ids) and an
 * unreachable Pipedrive fall back to the notes and activities stored in the tool.
 */
export const loadDealDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string; dealId: number }) => {
    if (!d || !/^[A-Z]{2}$/.test(d.country) || !Number.isSafeInteger(d.dealId))
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }): Promise<DealDetail> => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: link } = await db
      .from("lead_crm_links")
      .select("lead_id,origin_caller_id")
      .eq("country", data.country)
      .eq("deal_id", data.dealId)
      .maybeSingle();
    if (!link) throw new Error("Der Deal wurde nicht gefunden.");
    if (link.origin_caller_id !== context.userId) {
      const { data: staff } = await context.supabase.rpc("has_admin_rights", {
        _uid: context.userId,
        _country: data.country,
      });
      if (!staff) throw new Error("Für diesen Deal hast du keinen Zugriff.");
    }

    const local = async (error: string | null): Promise<DealDetail> => {
      const [notes, activity] = await Promise.all([
        db
          .from("lead_notes")
          .select("id,body,created_at,user_id")
          .eq("lead_id", link.lead_id)
          .order("created_at", { ascending: false })
          .limit(100),
        db
          .from("lead_activity")
          .select("id,action_type,previous_stage,new_stage,occurred_at,acting_user_name")
          .eq("lead_id", link.lead_id)
          .order("occurred_at", { ascending: false })
          .limit(100),
      ]);
      return {
        source: "local",
        error,
        notes: (notes.data ?? []).map((n) => ({
          id: n.id,
          at: n.created_at,
          author: null,
          text: n.body,
        })),
        events: (activity.data ?? [])
          .filter((a) => !/mail/i.test(a.action_type))
          .map((a) => ({
            id: a.id,
            at: a.occurred_at,
            by: a.acting_user_name,
            text:
              a.action_type === "stage_change"
                ? `Stage: ${a.previous_stage ?? "–"} → ${a.new_stage ?? "–"}`
                : a.action_type.replace(/_/g, " "),
          })),
      };
    };

    // Simulated demo deals never exist in Pipedrive.
    if (data.dealId <= 0) return local(null);
    try {
      const { call } = gatewayClient(data.country);
      const [notes, flow, stages] = await Promise.all([
        call(`/notes?deal_id=${data.dealId}&sort=add_time%20DESC&limit=100`, { method: "GET" }),
        call(`/deals/${data.dealId}/flow?limit=100`, { method: "GET" }),
        gatewayReader(data.country)
          .stages()
          .catch(() => []),
      ]);
      const stageNames = Object.fromEntries(stages.map((s) => [s.id, s.name]));
      return {
        source: "pipedrive",
        error: null,
        notes: parseNotes(notes.data),
        events: parseFlow(flow as { data?: unknown; related_objects?: unknown }, stageNames),
      };
    } catch (e) {
      return local(e instanceof CrmError ? e.code : "network_error");
    }
  });
