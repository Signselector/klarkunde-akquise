/**
 * The columns of "Meine Kunden". Each column lists the keys of `pipedrive_stage_mapping` whose Pipedrive stages it
 * shows. The IDs come from the configured mapping, they are never guessed.
 */
export type CustomerColumn = { key: string; label: string; stageKeys: string[] };

export const CUSTOMER_COLUMNS: CustomerColumn[] = [
  { key: "waiting_3d", label: "Logo ausstehend", stageKeys: ["waiting_3d"] },
  { key: "on_hold", label: "Zukunftsprojekt", stageKeys: ["on_hold"] },
  { key: "low_q", label: "Logo Render", stageKeys: ["low_q"] },
  { key: "high_q", label: "Realismus Render", stageKeys: ["high_q"] },
  { key: "animation", label: "In Bearbeitung", stageKeys: ["animation"] },
  { key: "rd_done", label: "3D fertig", stageKeys: ["rd_done"] },
  { key: "no_show", label: "No Show", stageKeys: ["no_show"] },
  { key: "low_chance", label: "Geringe Chance", stageKeys: ["low_chance"] },
  {
    key: "interested",
    label: "Vielleicht / Sehr interessiert",
    stageKeys: ["maybe_interested", "very_interested"],
  },
  { key: "offer", label: "Angebot erstellen", stageKeys: ["offer"] },
  { key: "contract", label: "Kaufvertrag erstellen", stageKeys: ["contract"] },
  { key: "contract_waiting", label: "Kaufvertrag waiting", stageKeys: ["contract_waiting"] },
  {
    key: "won",
    label: "Gewonnen",
    stageKeys: ["won_other_percent", "won_production_planning", "won_zero_percent"],
  },
];

/** Austria: own order and wording, as defined by the AT team. */
export const CUSTOMER_COLUMNS_AT: CustomerColumn[] = [
  { key: "waiting_3d", label: "Logo ausstehend", stageKeys: ["waiting_3d"] },
  { key: "low_q", label: "Logo Render", stageKeys: ["low_q"] },
  { key: "high_q", label: "Realismus Render", stageKeys: ["high_q"] },
  { key: "animation", label: "Visualisierung wird erstellt", stageKeys: ["animation"] },
  { key: "rd_done", label: "Visualisierung fertig", stageKeys: ["rd_done"] },
  { key: "no_show", label: "Termin nicht wahrgenommen", stageKeys: ["no_show"] },
  { key: "low_chance", label: "Wenig Interesse", stageKeys: ["low_chance"] },
  { key: "maybe_interested", label: "Mittel Interesse", stageKeys: ["maybe_interested"] },
  { key: "very_interested", label: "Sehr interessiert", stageKeys: ["very_interested"] },
  { key: "offer", label: "Angebot wird erstellt", stageKeys: ["offer"] },
  { key: "contract", label: "Kaufvertrag wird erstellt", stageKeys: ["contract"] },
  { key: "contract_waiting", label: "Warten auf Unterschrift", stageKeys: ["contract_waiting"] },
  {
    key: "won",
    label: "Gewonnen",
    stageKeys: ["won_zero_percent", "won_production_planning", "won_other_percent"],
  },
];

export const customerColumns = (country?: string) =>
  country === "AT" ? CUSTOMER_COLUMNS_AT : CUSTOMER_COLUMNS;

export type CustomerDeal = {
  lead_id: string;
  deal_id: number;
  company: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  last_called_at: string | null;
  stage_id: number | null;
  deal_status: string | null;
  /** Latest stage key recorded in this tool; used when Pipedrive cannot be reached. */
  local_stage_key: string | null;
  source: "pipedrive" | "local";
};

export type Placed = { column: CustomerColumn | null; stageId: number | null; deal: CustomerDeal };

/** Puts every deal in its column. Deals in a stage that no column shows land in `other`. */
export function placeDeals(
  deals: CustomerDeal[],
  mapping: Record<string, number>,
  country?: string,
) {
  const columns = customerColumns(country).map((column) => ({
    column,
    stageIds: column.stageKeys
      .map((k) => mapping[k])
      .filter((v): v is number => Number.isInteger(v)),
    deals: [] as CustomerDeal[],
  }));
  const other: CustomerDeal[] = [];
  for (const deal of deals) {
    const hit =
      deal.source === "pipedrive" && deal.stage_id !== null
        ? columns.find((c) => c.stageIds.includes(deal.stage_id as number))
        : columns.find(
            (c) => deal.local_stage_key && c.column.stageKeys.includes(deal.local_stage_key),
          );
    if (hit) hit.deals.push(deal);
    else other.push(deal);
  }
  return { columns, other };
}
