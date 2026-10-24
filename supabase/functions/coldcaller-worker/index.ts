import { handleWorker } from "../_shared/integration-worker.ts";
Deno.serve((request: Request) =>
  handleWorker(request, {
    schedulerSecret: Deno.env.get("COLD_CALLER_SCHEDULER_SECRET") ?? "",
    databaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    pipedriveToken: Deno.env.get("PIPEDRIVE_TOKEN") ?? "",
    authMode: Deno.env.get("PIPEDRIVE_AUTH_MODE") === "oauth" ? "oauth" : "api_token",
  }),
);
