import { createFileRoute } from "@tanstack/react-router";

const HUB_URL = "https://hub.signselector.com/api/public/backups/ingest";
// Internal backup copies would nest whole earlier backups; they are not re-exported.
const SKIP = new Set(["backups"]);
const PAGE = 1000;

/** Nightly full export of all public tables to the SignSelector hub. Caller: pg_cron with a database-only bearer token. */
export const Route = createFileRoute("/api/public/backup-cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { data: ok } = await db.rpc("verify_reconcile_token", { p_token: auth.slice(7).trim() });
        if (ok !== true) return new Response("unauthorized", { status: 401 });

        const hubToken = process.env["HUB_BACKUP_TOKEN"];
        const url = process.env["SUPABASE_URL"];
        const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        if (!hubToken || !url || !key) return Response.json({ error: "missing config" }, { status: 500 });

        // Table list from the REST schema description, so new tables are included automatically.
        const spec = (await (
          await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
        ).json()) as { definitions?: Record<string, unknown>; paths?: Record<string, unknown> };
        const tables = Object.keys(spec.definitions ?? {})
          .filter((t) => spec.paths?.[`/${t}`] && !SKIP.has(t))
          .sort();

        const out: Record<string, unknown[]> = {};
        const errors: Record<string, string> = {};
        for (const t of tables) {
          const rows: unknown[] = [];
          for (let from = 0; ; from += PAGE) {
            const { data, error } = await db
              .from(t as never)
              .select("*")
              .range(from, from + PAGE - 1);
            if (error) {
              errors[t] = error.message;
              break;
            }
            rows.push(...(data ?? []));
            if (!data || data.length < PAGE) break;
          }
          out[t] = rows;
        }

        const body = JSON.stringify(out);
        const res = await fetch(HUB_URL, {
          method: "POST",
          headers: {
            "x-backup-token": hubToken,
            "content-type": "application/json",
            "x-backup-filename": "coldcaller-tool.json",
          },
          body,
        });
        const hub = (await res.text()).slice(0, 2000);
        return Response.json(
          { ok: res.ok, hub_status: res.status, hub_response: hub, tables: tables.length, bytes: body.length, errors },
          { status: res.ok ? 200 : 502 },
        );
      },
    },
  },
});
