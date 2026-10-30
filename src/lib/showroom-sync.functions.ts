import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notifyShowroom } from "@/lib/showroom-sync.server";

/** Tells the Showroom about a moved ("geplant") or cancelled ("abgesagt") appointment the user may see. */
export const notifyShowroomFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appointmentId: string; status: "geplant" | "abgesagt" }) => {
    if (!d || !/^[0-9a-f-]{36}$/i.test(d.appointmentId) || !["geplant", "abgesagt"].includes(d.status))
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: ap } = await context.supabase.from("appointments").select("id").eq("id", data.appointmentId).maybeSingle();
    if (!ap) return { ok: false };
    await notifyShowroom(data.appointmentId, data.status);
    return { ok: true };
  });
