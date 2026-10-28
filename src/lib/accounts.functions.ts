import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => {
    if (!d || typeof d.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(d.userId))
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) throw new Error("Du kannst dich nicht selbst löschen.");
    const { data: isAdmin } = await context.supabase.rpc("is_global_admin", {
      _uid: context.userId,
    });
    if (!isAdmin) throw new Error("Nur Admins dürfen Accounts löschen.");
    const { data: targetMaster } = await context.supabase.rpc("is_master", { _uid: data.userId });
    if (targetMaster) throw new Error("Der Master-Admin kann nicht gelöscht werden.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("display_name,email")
      .eq("id", data.userId)
      .maybeSingle();
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error("Löschen fehlgeschlagen.");
    // The deleted user's own log entries stay (actor_id becomes NULL); the deletion itself is logged for the actor.
    await supabaseAdmin.rpc("log_activity_for", {
      p_actor: context.userId,
      p_action: "user_deleted",
      p_country: "ALL",
      p_target_type: "user",
      p_target_id: data.userId,
      p_target_label: target?.display_name ?? target?.email ?? "",
      p_metadata: { email: target?.email ?? null },
    });
    return { ok: true };
  });
