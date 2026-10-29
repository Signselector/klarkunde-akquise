import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { teamSecret } from "@/lib/teammanagement-auth";

const Claims = z.object({
  sub: z.string().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(255),
  name: z.string().trim().min(1).max(120),
  country: z.string().trim().toUpperCase().pipe(z.enum(["DE", "AT", "NL"])),
  exp: z.number().int(),
  nonce: z.string().min(8).max(100),
});

const b64urlToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function verify(token: string, secret: string): Promise<unknown | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
  } catch {
    return null;
  }
}

const fail = (origin: string, code: string) => Response.redirect(`${origin}/auth?sso_error=${code}`, 302);

/** One-click login from teammanagement.signselector.com via HMAC-signed token (5 min). */
export const Route = createFileRoute("/auth/sso")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const secret = teamSecret();
        const token = url.searchParams.get("token");
        if (!secret || !token || token.length > 4000) return fail(origin, "invalid");

        const parsed = Claims.safeParse(await verify(token, secret));
        if (!parsed.success) return fail(origin, "invalid");
        const c = parsed.data;
        const now = Math.floor(Date.now() / 1000);
        if (c.exp < now || c.exp > now + 600) return fail(origin, "expired");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: nonceErr } = await supabaseAdmin.from("sso_nonces").insert({ nonce: c.nonce });
        if (nonceErr) return fail(origin, "replay");

        const { data: existing } = await supabaseAdmin
          .from("profiles").select("id").ilike("email", c.email).maybeSingle();
        let userId = existing?.id as string | undefined;
        if (!userId) {
          const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email: c.email,
            password: crypto.randomUUID() + crypto.randomUUID(),
            email_confirm: true,
            user_metadata: { display_name: c.name, source: "teammanagement", external_id: c.sub },
          });
          if (error || !data.user) return fail(origin, "create_failed");
          userId = data.user.id;
          await supabaseAdmin.from("profiles").update({ display_name: c.name }).eq("id", userId);
          await supabaseAdmin.rpc("log_activity_for", {
            p_actor: userId, p_action: "user_registered", p_country: c.country,
            p_target_type: "user", p_target_id: userId, p_target_label: c.name,
            p_metadata: { email: c.email, source: "teammanagement_sso" },
          });
        }
        const { data: hasCountry } = await supabaseAdmin
          .from("user_countries").select("user_id").eq("user_id", userId).eq("country", c.country).maybeSingle();
        if (!hasCountry) await supabaseAdmin.from("user_countries").insert({ user_id: userId, country: c.country });

        const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink", email: c.email,
        });
        const hashed = link?.properties?.hashed_token;
        if (linkErr || !hashed) return fail(origin, "session_failed");

        const anon = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: s, error: otpErr } = await anon.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
        if (otpErr || !s.session) return fail(origin, "session_failed");

        const h = new URLSearchParams({
          access_token: s.session.access_token,
          refresh_token: s.session.refresh_token,
          expires_in: String(s.session.expires_in),
          expires_at: String(s.session.expires_at ?? ""),
          token_type: "bearer",
          type: "magiclink",
        });
        return new Response(null, {
          status: 302,
          headers: { Location: `${origin}/dashboard#${h}`, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
