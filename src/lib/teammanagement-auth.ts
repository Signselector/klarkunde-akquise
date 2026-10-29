import { apiKeyOk } from "@/lib/external-api-auth";

/** Shared secret with teammanagement.signselector.com (COLD_CALLER_API_KEY, falls back to TEAM_MANAGEMENT). Server-only. */
export function teamSecret(): string | undefined {
  return process.env["COLD_CALLER_API_KEY"] || process.env["TEAM_MANAGEMENT"] || undefined;
}

export function teamRequestOk(request: Request): boolean {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  return apiKeyOk(request.headers.get("x-api-key") ?? bearer, teamSecret());
}
