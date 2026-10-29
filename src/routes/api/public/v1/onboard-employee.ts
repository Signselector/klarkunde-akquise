import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CORS_HEADERS, json } from "@/lib/external-api-auth";
import { teamRequestOk } from "@/lib/teammanagement-auth";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  name: z.string().trim().min(1).max(120),
  country: z.string().trim().toUpperCase().pipe(z.enum(["DE", "AT", "NL"])),
  external_id: z.string().trim().max(200).optional(),
});

/**
 * Called by teammanagement.signselector.com when an employee's contract is signed.
 * Creates the account (role Caller via the signup trigger) in the given country.
 * The password e-mail is only sent once ONBOARDING_EMAILS_ACTIVE is "true".
 */
export const Route = createFileRoute("/api/public/v1/onboard-employee")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        if (!teamRequestOk(request))
          return json({ ok: false, error: "unauthorized" }, 401);

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success)
          return json({ ok: false, error: "invalid_input", issues: parsed.error.flatten().fieldErrors }, 400);
        const { email, name, country, external_id } = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: existing } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .ilike("email", email)
          .maybeSingle();

        let userId = existing?.id as string | undefined;
        let status: "created" | "exists" = "exists";
        if (!userId) {
          const password = crypto.randomUUID() + crypto.randomUUID();
          const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { display_name: name, source: "teammanagement", external_id },
          });
          if (error || !data.user) return json({ ok: false, error: "create_failed" }, 500);
          userId = data.user.id;
          status = "created";
          await supabaseAdmin.from("profiles").update({ display_name: name }).eq("id", userId);
        }

        // Country assignment (idempotent).
        const { data: hasCountry } = await supabaseAdmin
          .from("user_countries")
          .select("user_id")
          .eq("user_id", userId)
          .eq("country", country)
          .maybeSingle();
        if (!hasCountry)
          await supabaseAdmin.from("user_countries").insert({ user_id: userId, country });

        let emailSent = false;
        if (status === "created" && process.env['ONBOARDING_EMAILS_ACTIVE'] === "true") {
          const origin = new URL(request.url).origin;
          const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
            redirectTo: `${origin}/reset-password`,
          });
          emailSent = !error;
        }

        if (status === "created")
          await supabaseAdmin.rpc("log_activity_for", {
            p_actor: userId,
            p_action: "user_registered",
            p_country: country,
            p_target_type: "user",
            p_target_id: userId,
            p_target_label: name,
            p_metadata: { email, source: "teammanagement", email_sent: emailSent },
          });

        return json(
          { ok: true, user_id: userId, status, role: "recruit", country, email_sent: emailSent },
          status === "created" ? 201 : 200,
        );
      },
    },
  },
});
