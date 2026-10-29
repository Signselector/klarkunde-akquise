import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { API_TABLES, CORS_HEADERS, apiKeyOk, json } from "@/lib/external-api-auth";

type Table = (typeof API_TABLES)[number];
const RESERVED = new Set(["limit", "offset", "order", "select", "id"]);

async function guard(request: Request, table: string) {
  if (!apiKeyOk(request.headers.get("x-api-key"), process.env["EXTERNAL_API_KEY"]))
    return { error: json({ error: "unauthorized" }, 401) };
  if (!(API_TABLES as readonly string[]).includes(table))
    return { error: json({ error: `unknown table, allowed: ${API_TABLES.join(", ")}` }, 404) };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: supabaseAdmin as any, table: table as Table };
}

const rowSchema = z.record(z.string().max(64), z.unknown());
const bodySchema = z.union([rowSchema, z.array(rowSchema).min(1).max(1000)]);

export const Route = createFileRoute("/api/public/v1/$table")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      // GET /api/public/v1/leads?status=open&country=DE&limit=100&offset=0&order=created_at.desc&id=...
      GET: async ({ request, params }) => {
        const g = await guard(request, params.table);
        if (g.error) return g.error;
        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 1000);
        const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
        let q = g.db.from(g.table).select(url.searchParams.get("select") ?? "*", { count: "exact" });
        const id = url.searchParams.get("id");
        if (id) q = q.eq("id", id);
        for (const [k, v] of url.searchParams) if (!RESERVED.has(k) && /^[a-z_]+$/.test(k)) q = q.eq(k, v);
        const order = url.searchParams.get("order");
        if (order) {
          const [col, dir] = order.split(".");
          if (/^[a-z_]+$/.test(col)) q = q.order(col, { ascending: dir !== "desc" });
        }
        const { data, error, count } = await q.range(offset, offset + limit - 1);
        if (error) return json({ error: error.message }, 400);
        return json({ data, count, limit, offset });
      },

      // POST: create one row or an array of rows
      POST: async ({ request, params }) => {
        const g = await guard(request, params.table);
        if (g.error) return g.error;
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid body" }, 400);
        const { data, error } = await g.db.from(g.table).insert(parsed.data).select();
        if (error) return json({ error: error.message }, 400);
        return json({ data }, 201);
      },

      // PATCH ?id=<uuid>: update fields of one row
      PATCH: async ({ request, params }) => {
        const g = await guard(request, params.table);
        if (g.error) return g.error;
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return json({ error: "id required" }, 400);
        const parsed = rowSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid body" }, 400);
        const { data, error } = await g.db.from(g.table).update(parsed.data).eq("id", id).select();
        if (error) return json({ error: error.message }, 400);
        if (!data?.length) return json({ error: "not found" }, 404);
        return json({ data: data[0] });
      },

      // DELETE ?id=<uuid>
      DELETE: async ({ request, params }) => {
        const g = await guard(request, params.table);
        if (g.error) return g.error;
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return json({ error: "id required" }, 400);
        const { data, error } = await g.db.from(g.table).delete().eq("id", id).select("id");
        if (error) return json({ error: error.message }, 400);
        if (!data?.length) return json({ error: "not found" }, 404);
        return json({ deleted: id });
      },
    },
  },
});
