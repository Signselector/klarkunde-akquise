import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";
import { CrmError } from "@/lib/crm-sync";
import {
  busyFromActivities,
  syncCalendar,
  type CalItem,
  type CalendarCrm,
  type CalendarStore,
  type PdActivity,
} from "@/lib/calendar-sync";

function gatewayCalendar(country: string): CalendarCrm {
  const { call, json } = gatewayClient(country);
  return {
    async users() {
      const r = await call("/users", { method: "GET" });
      return ((Array.isArray(r.data) ? r.data : []) as { id?: number; email?: string | null }[])
        .filter((u) => Number.isSafeInteger(u.id))
        .map((u) => ({ id: u.id as number, email: u.email ?? null }));
    },
    async createActivity(payload) {
      const r = await json("POST", "/activities", payload);
      const id = (r.data as { id?: number } | undefined)?.id;
      if (!id || !Number.isSafeInteger(id)) throw new CrmError("invalid_payload");
      return id;
    },
    async updateActivity(id, payload) {
      await json("PUT", `/activities/${id}`, payload);
    },
    async deleteActivity(id) {
      try {
        await call(`/activities/${id}`, { method: "DELETE" });
      } catch (e) {
        // Already gone in Pipedrive is the wanted end state.
        if (!(e instanceof CrmError && e.code === "invalid_payload")) throw e;
      }
    },
    async list(pdUserId, from, to) {
      const q = new URLSearchParams({
        user_id: String(pdUserId),
        start_date: from.slice(0, 10),
        end_date: to.slice(0, 10),
        limit: "500",
      });
      const r = await call(`/activities?${q}`, { method: "GET" });
      return Array.isArray(r.data) ? (r.data as unknown[]) : [];
    },
  };
}

async function databaseStore(userId: string, country: string): Promise<CalendarStore> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const dealIds = async (leadIds: string[]) => {
    if (!leadIds.length) return new Map<string, number>();
    const { data } = await db
      .from("lead_crm_links")
      .select("lead_id,deal_id")
      .in("lead_id", leadIds)
      .not("deal_id", "is", null);
    return new Map((data ?? []).map((l) => [l.lead_id, l.deal_id as number]));
  };
  const table = (item: CalItem) => (item.kind === "callback" ? "callbacks" : "appointments");
  return {
    async mappedUser() {
      const { data } = await db
        .from("pipedrive_user_map")
        .select("pipedrive_user_id")
        .eq("user_id", userId)
        .eq("country", country)
        .maybeSingle();
      return data?.pipedrive_user_id ?? null;
    },
    async saveMapping(pdUserId) {
      await db
        .from("pipedrive_user_map")
        .upsert({ user_id: userId, country, pipedrive_user_id: pdUserId });
    },
    async pending() {
      // Callbacks stay private in the tool and are never sent to Pipedrive.
      const [aps] = await Promise.all([
        db
          .from("appointments")
          .select(
            "id,starts_at,pd_activity_id,lead_id,title,notes,lead:leads(company,contact_name,phone)",
          )
          .eq("user_id", userId)
          .eq("country", country)
          .in("pd_sync_state", ["pending", "failed"])
          .gte("starts_at", since)
          .limit(200),
      ]);
      const deals = await dealIds(
        (aps.data ?? []).map((r) => r.lead_id).filter((v): v is string => !!v),
      );
      const who = (
        l: { company: string | null; contact_name: string | null; phone: string | null } | null,
      ) => (l ? [l.contact_name, l.phone].filter(Boolean).join(" · ") || null : null);
      return [
        ...(aps.data ?? []).map((a): CalItem => ({
          kind: "appointment",
          id: a.id,
          startsAt: a.starts_at,
          subject: a.title || a.lead?.company || "Termin",
          note: [a.notes, who(a.lead)].filter(Boolean).join("\n") || null,
          dealId: a.lead_id ? (deals.get(a.lead_id) ?? null) : null,
          pdActivityId: a.pd_activity_id,
        })),
      ];
    },
    async markPushed(item, activityId) {
      await db
        .from(table(item))
        .update({
          pd_activity_id: activityId,
          pd_sync_state: "synced",
          pd_sync_error: null,
          pd_synced_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    },
    async markFailed(item, error) {
      await db
        .from(table(item))
        .update({ pd_sync_state: "failed", pd_sync_error: error.slice(0, 120) })
        .eq("id", item.id);
    },
    async queue() {
      const { data } = await db
        .from("pd_calendar_queue")
        .select("id,activity_id,action")
        .eq("user_id", userId)
        .eq("country", country)
        .limit(200);
      return (data ?? []).map((q) => ({
        id: q.id,
        activityId: q.activity_id,
        action: q.action as "delete" | "done",
      }));
    },
    async dequeue(id) {
      await db.from("pd_calendar_queue").delete().eq("id", id);
    },
    async apply(a: PdActivity) {
      await db.rpc("cal_apply_activity", { p_country: country, p_user: userId, p_a: a as never });
    },
    async prune(from, to, keep) {
      await db.rpc("cal_prune", {
        p_country: country,
        p_user: userId,
        p_from: from,
        p_to: to,
        p_keep: keep,
      });
    },
  };
}

export type CalendarSyncState =
  "synced" | "simulated" | "no_pipedrive_user" | "not_configured" | "error";

/** Runs the calendar sync for one user. Used by the page and by the scheduled reconcile. */
export async function syncCalendarForUser(
  userId: string,
  country: string,
  opts: { force?: boolean } = {},
): Promise<{ state: CalendarSyncState; pushed: number; pulled: number; error?: string }> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: config } = await db.from("integration_config").select("test_mode").maybeSingle();
  if (config?.test_mode !== false && !opts.force)
    return { state: "simulated", pushed: 0, pulled: 0 };
  let crm: CalendarCrm;
  try {
    crm = gatewayCalendar(country);
  } catch {
    return { state: "not_configured", pushed: 0, pulled: 0 };
  }
  const { data: profile } = await db
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  const now = new Date();
  try {
    return await syncCalendar({
      store: await databaseStore(userId, country),
      crm,
      email: profile?.email ?? null,
      window: {
        from: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
        to: new Date(now.getTime() + 180 * 86_400_000).toISOString(),
      },
    });
  } catch (e) {
    return {
      state: "error",
      pushed: 0,
      pulled: 0,
      error: e instanceof CrmError ? e.code : "network_error",
    };
  }
}

/** Syncs the signed-in user's calendar with their Pipedrive activities. Only the user's own entries are involved. */
export const syncMyCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string }) => {
    if (!d || !/^[A-Z]{2}$/.test(d.country)) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("can_access_country", {
      _c: data.country,
    });
    if (!allowed) throw new Error("Für dieses Land hast du keinen Zugriff.");
    return syncCalendarForUser(context.userId, data.country);
  });

const BUSY_MAX_AGE_MS = 3 * 60_000;

/**
 * Refreshes the anonymous free/busy copy of the company Pipedrive calendar for one country. Throttled, so opening the
 * booking calendar often does not call Pipedrive each time. In test mode nothing is fetched.
 */
export async function refreshBusy(country: string, opts: { force?: boolean } = {}) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  // Read-only: free/busy is fetched from Pipedrive in test mode too, so double bookings are avoided.
  const key = `pd_busy_refreshed_${country}`;
  const { data: last } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  const age = Date.now() - Number(last?.value ?? 0);
  if (!opts.force && age >= 0 && age < BUSY_MAX_AGE_MS) return { state: "fresh" as const, rows: 0 };
  let client: ReturnType<typeof gatewayClient>;
  try {
    client = gatewayClient(country);
  } catch {
    return { state: "not_configured" as const, rows: 0 };
  }
  const from = new Date(Date.now() - 86_400_000);
  const to = new Date(Date.now() + 180 * 86_400_000);
  try {
    const all: unknown[] = [];
    // user_id=0: the activities of all users of the company.
    for (let start = 0; start < 2000; start += 500) {
      const q = new URLSearchParams({
        user_id: "0",
        type: "meeting",
        start_date: from.toISOString().slice(0, 10),
        end_date: to.toISOString().slice(0, 10),
        limit: "500",
        start: String(start),
      });
      const r = await client.call(`/activities?${q}`, { method: "GET" });
      const page = Array.isArray(r.data) ? (r.data as unknown[]) : [];
      all.push(...page);
      if (page.length < 500) break;
    }
    const rows = busyFromActivities(all);
    await db.rpc("cal_replace_busy", {
      p_country: country,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_rows: rows as never,
    });
    await db
      .from("app_settings")
      .upsert({ key, value: String(Date.now()) } as never, { onConflict: "key" });
    return { state: "synced" as const, rows: rows.length };
  } catch {
    return { state: "error" as const, rows: 0 };
  }
}

/** Called when the booking calendar opens so the shown free/busy information is recent. */
export const refreshBookingSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string }) => {
    if (!d || !/^[A-Z]{2}$/.test(d.country)) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("can_access_country", {
      _c: data.country,
    });
    if (!allowed) throw new Error("Für dieses Land hast du keinen Zugriff.");
    return refreshBusy(data.country);
  });

/** Sends an appointment to the Pipedrive calendar of its current owner right away, e.g. after it was handed to someone. */
export const pushAppointmentNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appointmentId: string }) => {
    if (!d || typeof d.appointmentId !== "string" || !/^[0-9a-f-]{36}$/i.test(d.appointmentId))
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    // RLS: only appointments the user may see.
    const { data: ap } = await context.supabase
      .from("appointments")
      .select("user_id,country")
      .eq("id", data.appointmentId)
      .maybeSingle();
    if (!ap?.user_id || !ap.country) throw new Error("Termin nicht gefunden.");
    return syncCalendarForUser(ap.user_id, ap.country);
  });
