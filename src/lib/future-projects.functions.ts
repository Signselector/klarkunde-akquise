import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Turns Zukunftsprojekte whose month has started into Pipedrive deals. Runs in the background when anyone opens the
 * app, so no external scheduler is needed. Safe to call repeatedly: an activated project is never activated twice.
 */
export const activateDueFutureProjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { syncActionAs } = await import("@/lib/crm-sync.functions");
    const { data: ids, error } = await db.rpc("activate_future_projects");
    if (error) {
      console.error("activate_future_projects failed", error.message);
      return { activated: 0 };
    }
    let activated = 0;
    for (const id of Array.isArray(ids) ? (ids as string[]) : []) {
      const { data: act } = await db.from("lead_actions").select("user_id").eq("id", id).maybeSingle();
      if (!act) continue;
      try {
        await syncActionAs(id, act.user_id, true);
        activated++;
      } catch (e) {
        console.error("future project sync failed", id, e);
      }
    }
    return { activated };
  });
