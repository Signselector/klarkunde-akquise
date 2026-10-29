import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMasterEmail } from "@/lib/master";
import { currentExternalApiKey, newApiKey } from "@/lib/external-api-key.server";

function assertMaster(claims: unknown) {
  const email = (claims as { email?: string } | undefined)?.email;
  if (!isMasterEmail(email)) throw new Error("Nur für den Master-Admin.");
}

/** Returns the external API key — only to the master admin. */
export const getExternalApiKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertMaster(context.claims);
    const key = await currentExternalApiKey();
    if (!key) throw new Error("API-Schlüssel ist nicht eingerichtet.");
    return { key };
  });

/** Replaces the API key; the old one stops working immediately. */
export const regenerateExternalApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertMaster(context.claims);
    const key = newApiKey();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("external_api_keys")
      .upsert({ id: true, key, updated_at: new Date().toISOString() });
    if (error) throw new Error("Schlüssel konnte nicht gespeichert werden.");
    return { key };
  });

/** IP, device and approximate location of an audit entry — master admin only. */
export const getAuditLocation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    assertMaster(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("activity_audit_logs")
      .select("request_ip,user_agent")
      .eq("id", data.id)
      .maybeSingle();
    const ip = row?.request_ip ?? null;
    let geo: { city?: string | undefined; region?: string | undefined; country?: string | undefined; lat?: number | undefined; lon?: number | undefined; isp?: string | undefined } | null = null;
    if (ip) {
      try {
        const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
        const j = (await r.json()) as {
          success?: boolean; city?: string; region?: string; country?: string;
          latitude?: number; longitude?: number; connection?: { isp?: string };
        };
        if (j.success)
          geo = { city: j.city, region: j.region, country: j.country, lat: j.latitude, lon: j.longitude, isp: j.connection?.isp };
      } catch {
        geo = null;
      }
    }
    return { ip, userAgent: row?.user_agent ?? null, geo };
  });
