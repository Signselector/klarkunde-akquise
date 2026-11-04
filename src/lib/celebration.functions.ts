import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Announces a Low Q / High Q result to the whole country. The server looks the result up itself: it must be the
 * caller's own, fresh Logo Render / Realismus Render, and the country comes from the lead's batch, not from the client.
 */
export const announceLeadResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { actionId: string }) => {
    if (!d || typeof d.actionId !== "string" || !/^[0-9a-f-]{36}$/i.test(d.actionId))
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: act } = await db
      .from("lead_actions")
      .select("action,user_id,created_at,lead_id")
      .eq("id", data.actionId)
      .maybeSingle();
    if (!act || act.user_id !== context.userId) return { sent: false };
    if (act.action !== "low_q" && act.action !== "high_q") return { sent: false };
    if (Date.now() - new Date(act.created_at).getTime() > 2 * 60_000) return { sent: false };
    const { data: lead } = await db
      .from("leads")
      .select("batch_id")
      .eq("id", act.lead_id)
      .maybeSingle();
    const { data: batch } = lead?.batch_id
      ? await db.from("lead_batches").select("country").eq("id", lead.batch_id).maybeSingle()
      : { data: null };
    if (!batch?.country) return { sent: false };
    const { broadcastCelebration } = await import("@/lib/celebration.server");
    return {
      sent: await broadcastCelebration(batch.country, act.action, `action:${data.actionId}`),
    };
  });
