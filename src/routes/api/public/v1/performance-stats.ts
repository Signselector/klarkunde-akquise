import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CORS_HEADERS, json } from "@/lib/external-api-auth";
import { teamRequestOk } from "@/lib/teammanagement-auth";

const Query = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

const EMPTY = { total_calls: 0, high_q_renders: 0, low_q_renders: 0, total_renders: 0, rate_per_100: 0 };

/** Monthly call stats per caller for invoices (Honorarnoten) in teammanagement. Europe/Vienna months. */
export const Route = createFileRoute("/api/public/v1/performance-stats")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        if (!teamRequestOk(request)) return json({ ok: false, error: "unauthorized" }, 401);
        const url = new URL(request.url);
        const parsed = Query.safeParse({
          email: url.searchParams.get("email") ?? "",
          month: url.searchParams.get("month") ?? "",
        });
        if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
        const { email, month } = parsed.data;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("api_performance_stats", {
          p_email: email,
          p_month: `${month}-01`,
        });
        if (error) return json({ ok: false, error: "query_failed" }, 500);
        return json({ email, month, ...EMPTY, ...((data as object | null) ?? {}) });
      },
    },
  },
});
