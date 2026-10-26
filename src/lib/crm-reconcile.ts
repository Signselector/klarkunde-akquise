/**
 * Periodic reconciliation: compares what Pipedrive says about the linked deals with what this tool has stored and
 * applies the differences through the same idempotent function the webhook uses. Recovers missed webhook events.
 */
import { fetchDeals, MAX_DEALS, type DealInfo, type DealReader } from "@/lib/crm-customers";

export type ApplyStage = (args: {
  dealId: number;
  stageId: number | null;
  status: "won" | "lost" | null;
  eventId: string;
}) => Promise<{ applied?: boolean; reason?: string }>;

export type ReconcileResult = { checked: number; changed: number; missing: number };

const hour = (d: Date) => d.toISOString().slice(0, 13);

export async function reconcileDeals(
  dealIds: number[],
  reader: DealReader,
  apply: ApplyStage,
  now = new Date(),
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, changed: 0, missing: 0 };
  const unique = [...new Set(dealIds)];
  for (let i = 0; i < unique.length; i += MAX_DEALS) {
    const found = await fetchDeals(reader, unique.slice(i, i + MAX_DEALS));
    for (const [id, info] of found) {
      result.checked++;
      if (!info) {
        result.missing++; // deleted in Pipedrive: nothing to apply, the local history stays
        continue;
      }
      const status = info.status === "won" || info.status === "lost" ? info.status : null;
      const r = await apply({
        dealId: id,
        stageId: info.stage_id,
        status,
        // The hour keeps a deal that goes A -> B -> A from being mistaken for a repeat of the first A.
        eventId: `recon:${id}:${info.stage_id ?? "-"}:${status ?? "-"}:${hour(now)}`,
      });
      if (r.applied) result.changed++;
    }
  }
  return result;
}

export type { DealInfo };
