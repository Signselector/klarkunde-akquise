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
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Nur Admins dürfen Accounts löschen.");
    const { data: targetMaster } = await context.supabase.rpc("is_master", { _uid: data.userId });
    if (targetMaster) throw new Error("Der Master-Admin kann nicht gelöscht werden.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error("Löschen fehlgeschlagen.");
    return { ok: true };
  });
