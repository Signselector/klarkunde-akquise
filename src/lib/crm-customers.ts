/**
 * Current Pipedrive state of the deals a caller created. Read only. Prefers one batched request per 100 deals and
 * falls back to single requests, so it works whichever API generation the gateway exposes.
 */
export type DealInfo = { id: number; stage_id: number | null; status: string | null };
export interface DealReader {
  listByIds(ids: number[]): Promise<DealInfo[]>;
  get(id: number): Promise<DealInfo | null>;
}

export const MAX_DEALS = 300;

export async function fetchDeals(
  reader: DealReader,
  ids: number[],
): Promise<Map<number, DealInfo | null>> {
  const wanted = [...new Set(ids)].slice(0, MAX_DEALS);
  const found = new Map<number, DealInfo | null>();
  for (let i = 0; i < wanted.length; i += 100) {
    try {
      for (const d of await reader.listByIds(wanted.slice(i, i + 100)))
        if (wanted.includes(d.id)) found.set(d.id, d);
    } catch (e) {
      // Only a rejected batch request falls back to single lookups; auth or network errors are real.
      if (!(e instanceof Error) || e.message !== "invalid_payload") throw e;
    }
  }
  const missing = wanted.filter((id) => !found.has(id));
  for (let i = 0; i < missing.length; i += 5)
    await Promise.all(
      missing.slice(i, i + 5).map(async (id) => void found.set(id, await reader.get(id))),
    );
  return found;
}
