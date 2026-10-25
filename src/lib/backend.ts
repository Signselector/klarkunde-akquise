import { supabase } from "@/integrations/supabase/client";
import type { Database, Json, Tables } from "@/integrations/supabase/types";
// The database now only accepts writes through checked functions, so this is on unless explicitly disabled.
export const backendEnabled = import.meta.env["VITE_ATOMIC_BACKEND_ENABLED"] !== "false";
export type LeadClaim = {
  lead: Tables<"leads">;
  claim_id: string;
  expires_at: string;
  callback_id: string | null;
};
export type BackendFunctions = Database["public"]["Functions"];
/** Typed RPC entry point for Person B. Database errors are surfaced, never silently ignored. */
export async function backendRpc<N extends keyof BackendFunctions>(
  name: N,
  args: BackendFunctions[N]["Args"],
) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export function jsonObject<T>(value: Json | null): T {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_backend_response");
  return value as T;
}
