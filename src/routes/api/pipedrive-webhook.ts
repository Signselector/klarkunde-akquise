import { createFileRoute } from "@tanstack/react-router";
import { basicAuthOk, parseDealWebhook } from "@/lib/pipedrive-webhook";

const COUNTRIES = ["DE", "AT", "NL"];

/**
 * Receives Pipedrive deal webhooks. Protected by basic auth (set when the webhook is registered).
 * Idempotent: a repeated or late delivery never writes a second history entry.
 */
export const Route = createFileRoute("/api/pipedrive-webhook")({
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
        const country = new URL(request.url).searchParams.get("country") ?? "";
        if (!COUNTRIES.includes(country)) return new Response("bad country", { status: 400 });
        const event = parseDealWebhook(await request.json().catch(() => null));
        if (!event) return Response.json({ ignored: true });
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { data, error } = await db.rpc("crm_apply_stage", {
          p_country: country,
          p_deal_id: event.dealId,
          p_stage_id: event.stageId,
          p_event_id: event.eventId,
          p_occurred: event.occurredAt,
          p_source: "pipedrive",
          p_actor_name: "Pipedrive",
          p_status: event.status === "won" || event.status === "lost" ? event.status : null,
        } as never);
        // A server error makes Pipedrive retry; the retry is harmless because the event id is stored.
        if (error) return new Response("error", { status: 500 });
        return Response.json(data);
      },
    },
  },
});
