import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";

type Objects = { deals: number[]; persons: number[]; orgs: number[]; activities: number[] };

/**
 * Removes an AT test batch completely: first its deals, persons, organisations and activities in Pipedrive AT,
 * then every trace in the database. Admin only; the database refuses anything that is not an AT batch.
 */
export const purgeTestBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => {
    if (!d || !/^[0-9a-f-]{36}$/i.test(d.batchId)) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: objs, error } = await context.supabase.rpc("get_batch_crm_objects", {
      p_batch_id: data.batchId,
    });
    if (error) throw new Error(error.message);
    const o = objs as unknown as Objects;
    const { call } = gatewayClient("AT");
    const failed: string[] = [];
    let removed = 0;
    const del = async (kind: string, ids: number[]) => {
      for (const id of ids) {
        try {
          await call(`/${kind}/${id}`, { method: "DELETE" });
          removed++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Already gone in Pipedrive counts as removed.
          if (/404|not found/i.test(msg)) removed++;
          else failed.push(`${kind} ${id}: ${msg}`);
        }
      }
    };
    await del("activities", o.activities);
    await del("deals", o.deals);
    await del("persons", o.persons);
    await del("organizations", o.orgs);
    if (failed.length) {
      return { ok: false as const, removed, failed, leads: 0 };
    }
    const { data: res, error: e2 } = await context.supabase.rpc("purge_test_batch", {
      p_batch_id: data.batchId,
    });
    if (e2) throw new Error(e2.message);
    return { ok: true as const, removed, failed, leads: (res as { leads: number }).leads };
  });
