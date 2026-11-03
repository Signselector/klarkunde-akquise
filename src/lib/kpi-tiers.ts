export type Tier = "red" | "yellow" | "green" | "gold";

/** Leads per 100: <0.75 red, ≤1.2 yellow, ≤1.5 green, above gold. */
export function leadAvgTier(v: number): Tier {
  if (v < 0.75) return "red";
  if (v <= 1.2) return "yellow";
  if (v <= 1.5) return "green";
  return "gold";
}

/** Lead quality: <5 red, 5–6.5 yellow, ≥6.5 green. */
export function leadQualityTier(v: number): Exclude<Tier, "gold"> {
  if (v < 5) return "red";
  if (v < 6.5) return "yellow";
  return "green";
}
