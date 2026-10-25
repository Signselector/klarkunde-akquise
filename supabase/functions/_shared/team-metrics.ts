/**
 * Receives the lead quality and the number of contributed leads per employee from the Team Management tool.
 * Each row replaces the stored values of that employee and month, so sending a row twice never counts a lead twice.
 * The caller proves itself with a shared secret; no browser credentials and no business data are logged.
 */
import { equalSecret } from "./integration-worker.ts";

export type TeamMetricRow = {
  email: string;
  period: string;
  lead_quality: number | null;
  leads_contributed: number | null;
};
export type TeamMetricsConfig = { secret: string; databaseUrl: string; serviceKey: string };

const MAX_ROWS = 5000;

/** Returns the cleaned rows, or null when anything about the payload is off. Nothing is accepted partially. */
export function parseTeamMetrics(body: unknown): TeamMetricRow[] | null {
  const rows = (body as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) return null;
  const out: TeamMetricRow[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const email = typeof row?.["email"] === "string" ? row["email"].trim().toLowerCase() : "";
    const period = typeof row?.["period"] === "string" ? row["period"].trim() : "";
    const month = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(period);
    const quality = row?.["lead_quality"] ?? null;
    const contributed = row?.["leads_contributed"] ?? null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !month) return null;
    if (
      quality !== null &&
      !(typeof quality === "number" && Number.isFinite(quality) && quality >= 0)
    )
      return null;
    if (contributed !== null && !(Number.isInteger(contributed) && (contributed as number) >= 0))
      return null;
    out.push({
      email,
      period: `${month[1]}-${month[2]}-01`,
      lead_quality: quality as number | null,
      leads_contributed: contributed as number | null,
    });
  }
  return out;
}

export async function handleTeamMetrics(
  request: Request,
  config: TeamMetricsConfig,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const reply = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (
    !config.secret ||
    !(await equalSecret(request.headers.get("authorization") ?? "", `Bearer ${config.secret}`))
  )
    return reply(401, { error: "unauthorized" });
  if (!config.databaseUrl || !config.serviceKey)
    return reply(503, { error: "configuration_required" });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "invalid_payload" });
  }
  const rows = parseTeamMetrics(body);
  if (!rows) return reply(400, { error: "invalid_payload" });
  const base = new URL(config.databaseUrl);
  if (base.protocol !== "https:") return reply(503, { error: "configuration_required" });
  try {
    const response = await fetcher(`${base.origin}/rest/v1/rpc/upsert_team_metrics`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        apikey: config.serviceKey,
        ...(config.serviceKey.startsWith("sb_secret_")
          ? {}
          : { Authorization: `Bearer ${config.serviceKey}` }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_rows: rows }),
    });
    if (!response.ok) return reply(502, { error: "database_operation_failed" });
    const result = (await response.json()) as { updated: number; unmatched: string[] };
    return reply(200, { updated: result.updated, unmatched: result.unmatched });
  } catch {
    return reply(502, { error: "database_operation_failed" });
  }
}
