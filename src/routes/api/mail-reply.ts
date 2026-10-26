import { createFileRoute } from "@tanstack/react-router";
import { basicAuthOk } from "@/lib/pipedrive-webhook";
import { parseInboundReply } from "@/lib/mail-reply";

/**
 * Inbound-mail webhook for answers to reference mails. Same basic auth as the Pipedrive webhook.
 * A match sends the lead back to its original caller; unknown senders and repeated deliveries change nothing.
 */
export const Route = createFileRoute("/api/mail-reply")({
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
        const reply = parseInboundReply(await request.json().catch(() => null));
        if (!reply) return Response.json({ ignored: true });
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { data, error } = await db.rpc("register_reference_reply", {
          p_from: reply.from,
          p_refs: reply.refs,
        });
        if (error) return new Response("error", { status: 500 });
        return Response.json(data);
      },
    },
  },
});
