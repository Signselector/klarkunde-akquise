/** Current external API key: the rotated key in the database wins, the env secret is the fallback. */
export async function currentExternalApiKey(): Promise<string | undefined> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("external_api_keys").select("key").eq("id", true).maybeSingle();
  return data?.key ?? process.env["EXTERNAL_API_KEY"];
}

export function newApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "cct_live_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
