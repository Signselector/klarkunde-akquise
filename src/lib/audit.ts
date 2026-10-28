import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Fire-and-forget: a failing log call must never get in the way of the user's action. */
export function logListExport(list: string, label: string, scope: string, rows: number) {
  void supabase
    .rpc("log_activity", {
      p_action: "list_exported",
      p_country: scope,
      p_target_type: "list",
      p_target_id: list,
      p_target_label: label,
      p_metadata: { rows },
    })
    .then(() => undefined);
}

/** Logs that a staff member opened an admin list, once per list and country selection. */
export function useLogListView(list: string, label: string, scope: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void supabase
      .rpc("log_activity", {
        p_action: "list_viewed",
        p_country: scope,
        p_target_type: "list",
        p_target_id: list,
        p_target_label: label,
      })
      .then(() => undefined);
  }, [list, label, scope, enabled]);
}
