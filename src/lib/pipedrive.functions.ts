import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KEY_BY_COUNTRY: Record<string, string> = {
  DE: "PIPEDRIVE_API_KEY",
  AT: "PIPEDRIVE_API_KEY_1",
};

/** Lists all Pipedrive stages of the account linked to the given country. Admin only. */
export const loadPipedriveStages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string }) => {
    if (!KEY_BY_COUNTRY[d?.country])
      throw new Error("Für dieses Land ist kein Pipedrive-Konto verbunden.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_global_admin", {
      _uid: context.userId,
    });
    if (!isAdmin) throw new Error("Nur für Admins.");
    const lovable = process.env["LOVABLE_API_KEY"];
    const conn = process.env[KEY_BY_COUNTRY[data.country] ?? ""];
    if (!lovable || !conn) throw new Error("Pipedrive-Verbindung fehlt.");
    const res = await fetch("https://connector-gateway.lovable.dev/pipedrive/stages", {
      headers: { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": conn },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Pipedrive stages failed [${res.status}]: ${body}`);
      throw new Error(`Pipedrive antwortet mit Fehler ${res.status}.`);
    }
    const json = (await res.json()) as {
      data?: { id: number; name: string; pipeline_name?: string }[];
    };
    return (json.data ?? []).map((s) => ({
      id: s.id,
      name: s.name.trim(),
      pipeline: s.pipeline_name ?? "",
    }));
  });
