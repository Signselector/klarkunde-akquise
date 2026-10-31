import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";
import { CrmError } from "@/lib/crm-sync";
import { buildMeetingUpdate, pdKind } from "@/lib/pipedrive-activity";

const lastTeamSync = new Map<string, number>();
const TEAM_SYNC_MIN_GAP_MS = 2 * 60_000;

async function requireStaff(supabase: { rpc: (fn: "has_admin_rights", args: { _uid: string; _country: string }) => PromiseLike<{ data: unknown }> }, userId: string, country: string) {
  const { data } = await supabase.rpc("has_admin_rights", { _uid: userId, _country: country });
  if (!data) throw new Error("Dafür fehlt dir die Berechtigung.");
}

/**
 * Edits a meeting of the Pipedrive calendar. Managers and admins of the country only, and only meetings: calls are
 * refused here, whatever the page does. The change goes to Pipedrive first (in test mode only the tool copy changes).
 */
export const updatePipedriveMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string; activityId: number; subject: string; startsAt: string; durationMin: number }) => {
    if (!d || !/^[A-Z]{2}$/.test(d.country) || !Number.isSafeInteger(d.activityId)) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId, data.country);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: act } = await db
      .from("pipedrive_activities")
      .select("activity_id,type")
      .eq("country", data.country)
      .eq("activity_id", data.activityId)
      .maybeSingle();
    if (!act) throw new Error("Der Eintrag wurde nicht gefunden.");
    if (pdKind(act.type) !== "meeting") throw new Error("Nur Meetings können bearbeitet werden. Anrufe werden nur angezeigt.");
    let payload;
    try {
      payload = buildMeetingUpdate({ subject: data.subject, startsAt: data.startsAt, durationMin: data.durationMin });
    } catch {
      throw new Error("Bitte Betreff, Zeit und Dauer prüfen.");
    }
    const { data: config } = await db.from("integration_config").select("test_mode").maybeSingle();
    let state: "synced" | "simulated" = "simulated";
    if (config?.test_mode === false) {
      try {
        await gatewayClient(data.country).json("PUT", `/activities/${data.activityId}`, payload);
        state = "synced";
      } catch (e) {
        throw new Error(e instanceof CrmError ? `Pipedrive hat die Änderung nicht angenommen (${e.code}).` : "Pipedrive war nicht erreichbar.");
      }
    }
    const startsAt = new Date(data.startsAt).toISOString();
    await db
      .from("pipedrive_activities")
      .update({ subject: payload.subject, due_at: startsAt, duration_min: data.durationMin, updated_at: new Date().toISOString() })
      .eq("country", data.country)
      .eq("activity_id", data.activityId);
    // A meeting that is also an appointment of the tool keeps the same time there.
    await db.from("appointments").update({ starts_at: startsAt }).eq("country", data.country).eq("pd_activity_id", data.activityId);
    return { state };
  });

/**
 * Brings the Pipedrive calendars of the whole team of one country up to date, so that managers and admins see the
 * meetings and calls of everybody. Throttled; the hourly reconcile does the same without anybody opening the page.
 */
export const syncTeamCalendars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string }) => {
    if (!d || !/^[A-Z]{2}$/.test(d.country)) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId, data.country);
    const last = lastTeamSync.get(data.country) ?? 0;
    if (Date.now() - last < TEAM_SYNC_MIN_GAP_MS) return { synced: 0, skipped: true };
    lastTeamSync.set(data.country, Date.now());
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { syncCalendarForUser } = await import("@/lib/calendar-sync.functions");
    const { data: mapped } = await db.from("pipedrive_user_map").select("user_id").eq("country", data.country).limit(200);
    let synced = 0;
    for (const m of mapped ?? []) {
      try {
        await syncCalendarForUser(m.user_id, data.country);
        synced++;
      } catch {
        // The next run tries again.
      }
    }
    return { synced, skipped: false };
  });
