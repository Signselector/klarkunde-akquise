export type RenderType = "low_q" | "high_q";
export type StatsChoice = "auto" | RenderType | "none";

/**
 * Detects whether an imported Pipedrive deal was a Logo Render (low_q) or Realismus Render (high_q).
 * The earliest render stage in the deal's stage history wins (deals usually move on to later stages),
 * then the current stage, then the deal title ("Logo Render: …" / "Realismus Render: …").
 */
export function detectRenderType(input: {
  mapping: Record<string, unknown>;
  currentStageId: number | null;
  /** Stage changes from the deal flow, any order. */
  stageChanges: { at: string; oldStageId: number | null; newStageId: number | null }[];
  title: string | null;
}): RenderType | null {
  const ids: Record<RenderType, number | null> = {
    low_q: typeof input.mapping.low_q === "number" ? input.mapping.low_q : null,
    high_q: typeof input.mapping.high_q === "number" ? input.mapping.high_q : null,
  };
  const typeOf = (id: number | null): RenderType | null =>
    id == null ? null : id === ids.low_q ? "low_q" : id === ids.high_q ? "high_q" : null;

  const sorted = [...input.stageChanges].sort((a, b) => a.at.localeCompare(b.at));
  for (const c of sorted) {
    const t = typeOf(c.oldStageId) ?? typeOf(c.newStageId);
    if (t) return t;
  }
  const cur = typeOf(input.currentStageId);
  if (cur) return cur;
  const title = (input.title ?? "").toLowerCase();
  if (/realismus|high\s*q/.test(title)) return "high_q";
  if (/logo\s*render|low\s*q/.test(title)) return "low_q";
  return null;
}

/** Pipedrive timestamps ("2026-10-30 15:09:00", UTC) to ISO. */
export function pdToIso(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.includes("T") ? v : `${v.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
