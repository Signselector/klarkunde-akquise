export type Tier = "red" | "orange" | "yellow" | "green" | "gold";

/** Leads per 100: <0.75 red, ≤1.2 orange, ≤1.5 green, above gold. */
export function leadAvgTier(v: number): Tier {
  if (v < 0.75) return "red";
  if (v <= 1.2) return "orange";
  if (v <= 1.5) return "green";
  return "gold";
}

/** Lead quality: <5 red, 5–6.5 yellow, ≥6.5 green. */
export function leadQualityTier(v: number): Exclude<Tier, "gold"> {
  if (v < 5) return "red";
  if (v < 6.5) return "yellow";
  return "green";
}

/** Monthly salary (EUR) from the lead average: <0.75 → 0, ≥0.75 → 2000, ≥1.2 → 2500, ≥1.5 → 3000, ≥3 → 4000. */
export function salaryForAvg(v: number): number {
  if (v >= 3) return 4000;
  if (v >= 1.5) return 3000;
  if (v >= 1.2) return 2500;
  if (v >= 0.75) return 2000;
  return 0;
}

export function formatEuro(v: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}
