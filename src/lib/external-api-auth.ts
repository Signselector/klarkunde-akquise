/** Tables external projects may read and write via /api/public/v1/<table>. */
export const API_TABLES = [
  "leads",
  "lead_batches",
  "lead_notes",
  "status_changes",
  "callbacks",
  "appointments",
  "profiles",
  "app_settings",
] as const;

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
};

/** Constant-time comparison of the presented key with the configured one. */
export function apiKeyOk(presented: string | null, expected: string | undefined) {
  if (!presented || !expected || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}
