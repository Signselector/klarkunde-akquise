/**
 * Sends appointment bookings, moves and cancellations to the SignSelector Showroom.
 * Never throws: failures are logged and must not block the caller.
 */
const SHOWROOM_URL = "https://signselector-showroom-studio.lovable.app/api/public/appointments";

export type ShowroomStatus = "geplant" | "abgesagt";

export async function notifyShowroom(appointmentId: string, status: ShowroomStatus): Promise<void> {
  try {
    const token = process.env["SHOWROOM_API_TOKEN"];
    if (!token) {
      console.warn("[showroom] SHOWROOM_API_TOKEN missing, skipped", appointmentId);
      return;
    }
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: ap } = await db
      .from("appointments")
      .select("id,starts_at,lead_id,booked_by,user_id")
      .eq("id", appointmentId)
      .maybeSingle();
    if (!ap) return;
    const [lead, link, caller] = await Promise.all([
      ap.lead_id ? db.from("leads").select("email").eq("id", ap.lead_id).maybeSingle() : null,
      ap.lead_id
        ? db.from("lead_crm_links").select("deal_id").eq("lead_id", ap.lead_id).not("deal_id", "is", null).limit(1).maybeSingle()
        : null,
      ap.booked_by ?? ap.user_id
        ? db.from("profiles").select("display_name,email").eq("id", (ap.booked_by ?? ap.user_id)!).maybeSingle()
        : null,
    ]);
    const payload = {
      external_id: ap.id,
      starts_at: ap.starts_at,
      pipedrive_deal_id: link?.data?.deal_id ?? null,
      email: lead?.data?.email ?? null,
      caller_name: caller?.data?.display_name ?? caller?.data?.email ?? null,
      status,
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(SHOWROOM_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) console.error("[showroom] HTTP", res.status, appointmentId, (await res.text()).slice(0, 300));
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("[showroom] failed", appointmentId, e instanceof Error ? e.message : e);
  }
}
