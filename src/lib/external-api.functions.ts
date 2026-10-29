import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMasterEmail } from "@/lib/master";

/** Returns the external API key — only to the master admin. */
export const getExternalApiKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | undefined)?.email;
    if (!isMasterEmail(email)) throw new Error("Nur für den Master-Admin.");
    const key = process.env["EXTERNAL_API_KEY"];
    if (!key) throw new Error("API-Schlüssel ist nicht eingerichtet.");
    return { key };
  });
