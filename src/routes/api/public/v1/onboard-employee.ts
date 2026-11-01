import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CORS_HEADERS, json } from "@/lib/external-api-auth";
import { teamRequestOk } from "@/lib/teammanagement-auth";

const Employee = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  name: z.string().trim().min(1).max(120),
  country: z.string().trim().toUpperCase().pipe(z.enum(["DE", "AT", "NL"])),
  external_id: z.string().trim().max(200).optional(),
});
type Employee = z.infer<typeof Employee>;

/** Accepts one employee object, an array of them, or { employees: [...] }. */
const Body = z.union([
  Employee.transform((e) => ({ list: [e], batch: false })),
  z.array(Employee).min(1).max(1000).transform((l) => ({ list: l, batch: true })),
  z.object({ employees: z.array(Employee).min(1).max(1000) }).transform((o) => ({ list: o.employees, batch: true })),
]);

type Result =
  | { ok: true; email: string; user_id: string; status: "created" | "exists"; role: "recruit"; country: string; welcome_mail: "scheduled" | "none" }
  | { ok: false; email: string; error: string };

async function onboard(e: Employee): Promise<Result> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { email, name, country, external_id } = e;
  const { data: existing } = await supabaseAdmin.from("profiles").select("id").ilike("email", email).maybeSingle();

  let userId = existing?.id as string | undefined;
  let status: "created" | "exists" = "exists";
  if (!userId) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: crypto.randomUUID() + crypto.randomUUID(),
      email_confirm: true,
      // No automatic welcome mail: new users set their password via "Passwort vergessen" or log in via SSO.
      user_metadata: { display_name: name, source: "teammanagement", external_id },
    });
    if (error || !data.user) return { ok: false, email, error: "create_failed" };
    userId = data.user.id;
    status = "created";
    await supabaseAdmin.from("profiles").update({ display_name: name }).eq("id", userId);
  }

  const { data: hasCountry } = await supabaseAdmin
    .from("user_countries").select("user_id").eq("user_id", userId).eq("country", country).maybeSingle();
  if (!hasCountry) await supabaseAdmin.from("user_countries").insert({ user_id: userId, country });

  if (status === "created")
    await supabaseAdmin.rpc("log_activity_for", {
      p_actor: userId,
      p_action: "user_registered",
      p_country: country,
      p_target_type: "user",
      p_target_id: userId,
      p_target_label: name,
      p_metadata: { email, source: "teammanagement", welcome_mail: "scheduled" },
    });

  return { ok: true, email, user_id: userId, status, role: "recruit", country, welcome_mail: status === "created" ? "scheduled" : "none" };
}

/** Called by teammanagement.signselector.com: creates Caller accounts (single or bulk). */
export const Route = createFileRoute("/api/public/v1/onboard-employee")({
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
        if (!parsed.success) return json({ ok: false, error: "invalid_input", issues: parsed.error.flatten() }, 400);
        const { list, batch } = parsed.data;

        const results: Result[] = [];
        for (const e of list) {
          try {
            results.push(await onboard(e));
          } catch {
            results.push({ ok: false, email: e.email, error: "unexpected_error" });
          }
        }

        if (!batch) {
          const r = results[0]!;
          if (!r.ok) return json(r, 500);
          return json(r, r.status === "created" ? 201 : 200);
        }
        return json({
          ok: results.every((r) => r.ok),
          total: results.length,
          created: results.filter((r) => r.ok && r.status === "created").length,
          existing: results.filter((r) => r.ok && r.status === "exists").length,
          failed: results.filter((r) => !r.ok).length,
          results,
        });
      },
    },
  },
});
