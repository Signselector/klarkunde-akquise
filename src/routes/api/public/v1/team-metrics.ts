import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CORS_HEADERS, json } from "@/lib/external-api-auth";
import { teamRequestOk } from "@/lib/teammanagement-auth";

const Row = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/),
  lead_quality: z.number().finite().min(0).nullable(),
  leads_contributed: z.number().int().min(0).nullable(),
});
const Body = z.object({ rows: z.array(Row).min(1).max(5000) });

/** Teammanagement pushes lead quality + contributed leads per employee and month (idempotent upsert). */
export const Route = createFileRoute("/api/public/v1/team-metrics")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        if (!teamRequestOk(request)) return json({ ok: false, error: "unauthorized" }, 401);
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
        const rows = parsed.data.rows.map((r) => ({ ...r, period: `${r.period.slice(0, 7)}-01` }));
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("upsert_team_metrics", { p_rows: rows });
        if (error) return json({ ok: false, error: "upsert_failed" }, 500);
        return json({ ok: true, result: data });
      },
    },
  },
});
