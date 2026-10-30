/**
 * Current Pipedrive state of the deals a caller created. Read only. Looks each deal up on its own (a few at a time),
 * because the Pipedrive list endpoint ignores an ID filter. A single failed lookup does not fail the whole view.
 */
export type DealInfo = { id: number; stage_id: number | null; status: string | null };
export interface DealReader {
  listByIds(ids: number[]): Promise<DealInfo[]>;
  get(id: number): Promise<DealInfo | null>;
}

export const MAX_DEALS = 300;

/**
 * Map entries: DealInfo = found, null = deleted in Pipedrive, missing = could not be read right now.
 * Throws only when not a single deal could be read.
 */
export async function fetchDeals(
  reader: DealReader,
  ids: number[],
): Promise<Map<number, DealInfo | null>> {
  const wanted = [...new Set(ids)].slice(0, MAX_DEALS);
  const found = new Map<number, DealInfo | null>();
  let lastError: unknown = null;
  for (let i = 0; i < wanted.length; i += 3)
    await Promise.all(
      wanted.slice(i, i + 3).map(async (id) => {
        try {
          const d = await reader.get(id);
          found.set(id, d && d.status === "deleted" ? null : d);
        } catch (e) {
          lastError = e;
        }
      }),
    );
  if (wanted.length && found.size === 0 && lastError) throw lastError;
  return found;
}
