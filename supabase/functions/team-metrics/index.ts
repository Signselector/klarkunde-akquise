import { handleTeamMetrics } from "../_shared/team-metrics.ts";
Deno.serve((request: Request) =>
  handleTeamMetrics(request, {
    secret: Deno.env.get("TEAM_MANAGEMENT_SYNC_SECRET") ?? "",
    databaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  }),
);
