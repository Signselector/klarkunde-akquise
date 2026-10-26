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
        // Calendars: every user with a Pipedrive match, so changes made in Pipedrive arrive without opening the page.
        const calendars: Record<string, unknown> = {};
        try {
          const { syncCalendarForUser } = await import("@/lib/calendar-sync.functions");
          const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
          const { data: mapped } = await db
            .from("pipedrive_user_map")
            .select("user_id,country")
            .in("country", ["DE", "AT"])
            .limit(200);
          for (const m of mapped ?? []) {
            const r = await syncCalendarForUser(m.user_id, m.country);
            calendars[`${m.country}:${m.user_id}`] = r.state;
          }
        } catch (e) {
          calendars["error"] = e instanceof Error ? e.message : "failed";
        }
        return Response.json({ deals: results, calendars });
      },
    },
  },
});
