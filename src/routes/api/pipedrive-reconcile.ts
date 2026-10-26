import { createFileRoute } from "@tanstack/react-router";
import { basicAuthOk } from "@/lib/pipedrive-webhook";

/** Scheduled reconciliation (e.g. hourly): recovers webhook events that were missed. Same basic auth as the webhook. */
export const Route = createFileRoute("/api/pipedrive-reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          !basicAuthOk(
            request.headers.get("authorization"),
            process.env["PIPEDRIVE_WEBHOOK_USER"],
            process.env["PIPEDRIVE_WEBHOOK_PASSWORD"],
          )
        )
          return new Response("unauthorized", { status: 401 });
        const { reconcileCountry } = await import("@/lib/crm-admin.functions");
        const results: Record<string, unknown> = {};
        for (const country of ["DE", "AT"]) {
          try {
            results[country] = await reconcileCountry(country);
          } catch (e) {
            results[country] = { error: e instanceof Error ? e.message : "failed" };
          }
        }
        return Response.json(results);
      },
    },
  },
});
