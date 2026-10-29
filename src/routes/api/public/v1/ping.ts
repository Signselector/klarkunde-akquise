import { createFileRoute } from "@tanstack/react-router";
import { API_TABLES, CORS_HEADERS, apiKeyOk, json } from "@/lib/external-api-auth";
import { currentExternalApiKey } from "@/lib/external-api-key.server";

export const Route = createFileRoute("/api/public/v1/ping")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        if (!apiKeyOk(request.headers.get("x-api-key"), await currentExternalApiKey()))
          return json({ error: "unauthorized" }, 401);
        return json({ ok: true, project: "Sign Selector Cold Caller", tables: API_TABLES });
      },
    },
  },
});
