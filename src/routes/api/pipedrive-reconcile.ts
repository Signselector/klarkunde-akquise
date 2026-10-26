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
        // Free/busy of the company calendar for the booking calendar.
        for (const country of ["DE", "AT"]) {
          try {
            const { refreshBusy } = await import("@/lib/calendar-sync.functions");
            await refreshBusy(country, { force: true });
          } catch (e) {
            calendars[`busy:${country}`] = e instanceof Error ? e.message : "failed";
          }
        }
        // Zukunftsprojekte whose month has started become deals in the CRM.
        let activated = 0;
        try {
          const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
          const { syncActionAs } = await import("@/lib/crm-sync.functions");
          const { data: ids } = await db.rpc("activate_future_projects");
          for (const id of Array.isArray(ids) ? (ids as string[]) : []) {
            const { data: act } = await db
              .from("lead_actions")
              .select("user_id")
              .eq("id", id)
              .maybeSingle();
            if (!act) continue;
            await syncActionAs(id, act.user_id, true);
            activated++;
          }
        } catch (e) {
          calendars["futureProjects"] = e instanceof Error ? e.message : "failed";
        }
        return Response.json({ deals: results, calendars, futureProjectsActivated: activated });
      },
    },
  },
});
