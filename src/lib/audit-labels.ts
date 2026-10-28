import type { Database } from "@/integrations/supabase/types";

export type AuditAction = Database["public"]["Enums"]["audit_action_type"];

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  user_login: "Angemeldet",
  user_logout: "Abgemeldet",
  batch_completed: "Batch abgeschlossen",
  batch_claimed: "Batch übernommen",
  batch_released: "Batch freigegeben",
  batch_uploaded: "Batch hochgeladen",
  batch_deleted: "Batch gelöscht",
  user_registered: "Account registriert",
  user_role_changed: "Rolle geändert",
  user_deleted: "Account gelöscht",
  user_deactivated: "Account deaktiviert",
  list_viewed: "Liste geöffnet",
  list_exported: "Liste exportiert",
};

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[];

const ROLE: Record<string, string> = {
  recruit: "Caller",
  veteran: "Senior Caller",
  manager: "Manager",
  admin: "Admin",
};

/** One readable line of extra detail from the metadata of an entry. */
export function auditDetail(action: AuditAction, meta: Record<string, unknown> | null): string {
  const m = meta ?? {};
  const s = (k: string) => (m[k] == null ? "" : String(m[k]));
  if (action === "user_role_changed") {
    const from = ROLE[s("old_role")] ?? s("old_role");
    const to = ROLE[s("new_role")] ?? s("new_role");
    return [from, to].filter(Boolean).join(" → ");
  }
  if (action === "list_exported" && m["rows"] != null) return `${s("rows")} Zeilen`;
  if (action === "user_deleted") return s("email");
  return "";
}
