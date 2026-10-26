/** Understands Pipedrive deal webhooks (v1 and v2) and checks their basic-auth header. */
export type DealEvent = {
  dealId: number;
  stageId: number | null;
  status: "won" | "lost" | "open" | "deleted" | null;
  eventId: string;
  occurredAt: string;
  deleted: boolean;
};

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const toIso = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v))
    return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === "string" && v) {
    const t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(" ", "T") + "Z");
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
};

export function parseDealWebhook(body: unknown): DealEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, any>;
  const meta = (b["meta"] ?? {}) as Record<string, any>;
  const v2 = typeof meta["version"] === "string" && meta["version"].startsWith("2");
  const entity = v2 ? meta["entity"] : meta["object"];
  if (entity !== "deal") return null;
  const action = String(v2 ? meta["action"] : (b["event"] ?? meta["action"] ?? ""));
  const deleted = /delete/.test(action);
  const current = (
    deleted ? (b["previous"] ?? b["data"]) : v2 ? b["data"] : b["current"]
  ) as Record<string, any> | null;
  const dealId = [current?.["id"], meta["entity_id"], meta["id"]].find(isId);
  if (!dealId) return null;
  const stageId = isId(current?.["stage_id"]) ? (current!["stage_id"] as number) : null;
  const rawStatus = current?.["status"];
  const status = deleted
    ? "deleted"
    : rawStatus === "won" || rawStatus === "lost" || rawStatus === "open"
      ? rawStatus
      : null;
  const occurredAt =
    toIso(meta["timestamp"]) ?? toIso(current?.["update_time"]) ?? new Date().toISOString();
  const eventId = `${dealId}:${stageId ?? "-"}:${status ?? "-"}:${occurredAt}`;
  return { dealId, stageId, status, eventId, occurredAt, deleted };
}

/** Constant-time check of "Authorization: Basic …" against the configured user and password. */
export function basicAuthOk(
  header: string | null,
  user: string | undefined,
  password: string | undefined,
) {
  if (!header || !user || !password || !header.startsWith("Basic ")) return false;
  let given = "";
  try {
    given = atob(header.slice(6).trim());
  } catch {
    return false;
  }
  const expected = `${user}:${password}`;
  let diff = given.length ^ expected.length;
  for (let i = 0; i < Math.max(given.length, expected.length); i++)
    diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return diff === 0;
}
