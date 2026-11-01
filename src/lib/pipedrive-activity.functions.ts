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

/** Managers and admins of the country may change every entry, a Senior Caller only the entries that belong to him. */
async function requireStaffOrSeniorOwner(
  context: { supabase: any; userId: string },
  country: string,
  ownerId: string,
) {
  const { data: staff } = await context.supabase.rpc("has_admin_rights", { _uid: context.userId, _country: country });
  if (staff) return;
  if (ownerId === context.userId) {
    const { data: senior } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "veteran" });
    if (senior) return;
  }
  throw new Error("Dafür fehlt dir die Berechtigung.");
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
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: act } = await db
      .from("pipedrive_activities")
      .select("activity_id,type,user_id")
      .eq("country", data.country)
      .eq("activity_id", data.activityId)
      .maybeSingle();
    if (!act) throw new Error("Der Eintrag wurde nicht gefunden.");
    await requireStaffOrSeniorOwner(context, data.country, act.user_id);
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

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Edits the note of a Pipedrive calendar entry (meeting or call). Allowed for managers and admins of the country and
 * for the owner of the entry. In test mode only the tool copy changes.
 */
export const updatePipedriveActivityNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string; activityId: number; note: string }) => {
    if (!d || !/^[A-Z]{2}$/.test(d.country) || !Number.isSafeInteger(d.activityId) || typeof d.note !== "string" || d.note.length > 15000)
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: act } = await db
      .from("pipedrive_activities")
      .select("activity_id,user_id")
      .eq("country", data.country)
      .eq("activity_id", data.activityId)
      .maybeSingle();
    if (!act) throw new Error("Der Eintrag wurde nicht gefunden.");
    await requireStaffOrSeniorOwner(context, data.country, act.user_id);
    const text = data.note.trim();
    const html = text ? escapeHtml(text).replace(/\n/g, "<br>") : "";
    const { data: config } = await db.from("integration_config").select("test_mode").maybeSingle();
    let state: "synced" | "simulated" = "simulated";
    if (config?.test_mode === false) {
      try {
        await gatewayClient(data.country).json("PUT", `/activities/${data.activityId}`, { note: html });
        state = "synced";
      } catch (e) {
        throw new Error(e instanceof CrmError ? `Pipedrive hat die Änderung nicht angenommen (${e.code}).` : "Pipedrive war nicht erreichbar.");
      }
    }
    await db
      .from("pipedrive_activities")
      .update({ note: html || null, updated_at: new Date().toISOString() })
      .eq("country", data.country)
      .eq("activity_id", data.activityId);
    return { state };
  });

/**
 * Marks a Pipedrive calendar entry as done (or open again), like the "Als erledigt markieren" box in Pipedrive.
 * Managers and admins of the country and the owner of the entry may do it. In test mode only the tool copy changes.
 */
export const setPipedriveActivityDone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string; activityId: number; done: boolean }) => {
    if (!d || !/^[A-Z]{2}$/.test(d.country) || !Number.isSafeInteger(d.activityId) || typeof d.done !== "boolean")
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: act } = await db
      .from("pipedrive_activities")
      .select("activity_id,user_id")
      .eq("country", data.country)
      .eq("activity_id", data.activityId)
      .maybeSingle();
    if (!act) throw new Error("Der Eintrag wurde nicht gefunden.");
    await requireStaffOrSeniorOwner(context, data.country, act.user_id);
    const { data: config } = await db.from("integration_config").select("test_mode").maybeSingle();
    let state: "synced" | "simulated" = "simulated";
    if (config?.test_mode === false) {
      try {
        await gatewayClient(data.country).json("PUT", `/activities/${data.activityId}`, { done: data.done ? 1 : 0 });
        state = "synced";
      } catch (e) {
        throw new Error(e instanceof CrmError ? `Pipedrive hat die Änderung nicht angenommen (${e.code}).` : "Pipedrive war nicht erreichbar.");
      }
    }
    await db
      .from("pipedrive_activities")
      .update({ done: data.done, updated_at: new Date().toISOString() })
      .eq("country", data.country)
      .eq("activity_id", data.activityId);
    return { state };
  });
