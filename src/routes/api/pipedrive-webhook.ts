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
        const apply = () =>
          db.rpc("crm_apply_stage", {
            p_country: country,
            p_deal_id: event.dealId,
            p_stage_id: event.stageId,
            p_event_id: event.eventId,
            p_occurred: event.occurredAt,
            p_source: "pipedrive",
            p_actor_name: "Pipedrive",
            p_status: event.status === "won" || event.status === "lost" ? event.status : null,
          } as never);
        let { data, error } = await apply();
        // A server error makes Pipedrive retry; the retry is harmless because the event id is stored.
        if (error) return new Response("error", { status: 500 });
        // Unknown deal: maybe the answer to a reference mail. Match by the deal person's e-mail/phone
        // and credit the lead to its original caller.
        if (!event.deleted && (data as { reason?: string } | null)?.reason === "unknown_deal") {
          try {
            const { gatewayClient } = await import("@/lib/crm-sync.functions");
            const { call } = gatewayClient(country);
            const deal = (await call(`/deals/${event.dealId}`, { method: "GET" })).data as
              | { person_id?: number | { value?: number } | null }
              | undefined;
            const pid =
              typeof deal?.person_id === "number" ? deal.person_id : deal?.person_id?.value;
            if (pid) {
              const person = (await call(`/persons/${pid}`, { method: "GET" })).data as {
                email?: { value?: string }[];
                phone?: { value?: string }[];
              };
              const vals = (l?: { value?: string }[]) =>
                (l ?? []).map((x) => String(x?.value ?? "")).filter(Boolean).slice(0, 20);
              const { data: m } = await db.rpc("crm_match_reference_deal", {
                p_country: country,
                p_deal: event.dealId,
                p_emails: vals(person?.email),
                p_phones: vals(person?.phone),
              });
              if ((m as { matched?: boolean } | null)?.matched) {
                const again = await apply();
                if (!again.error) data = again.data;
                return Response.json({ reference_match: m, stage: data });
              }
            }
          } catch (e) {
            console.error("reference deal match failed", e);
          }
        }
        return Response.json(data);
      },
    },
  },
});
