import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";
import { CrmError } from "@/lib/crm-sync";

export type ShowroomOutcome =
  | "no_show"
  | "low_interest"
  | "medium_interest"
  | "high_interest"
  | "deleted"
  | "rescheduled";

const OUTCOMES: ShowroomOutcome[] = [
  "no_show",
  "low_interest",
  "medium_interest",
  "high_interest",
  "deleted",
  "rescheduled",
];
const TASK_OUTCOMES: ShowroomOutcome[] = ["deleted", "low_interest", "medium_interest", "high_interest"];
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/**
 * Saves a showroom result of an appointment (database) and then carries it over to Pipedrive: the note goes to the
 * deal (tasks always belong to the default Pipedrive user), the deal moves to its stage, deleted appointments and interested customers get a task on the deal. Moved
 * appointments and follow-up appointments reach the Pipedrive calendar through the usual calendar sync.
 * In test mode nothing is sent to Pipedrive.
 */
export const recordAppointmentOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { appointmentId: string; outcome: ShowroomOutcome; note: string; newStart?: string | null; followupAt?: string | null }) => {
      if (!d || typeof d.appointmentId !== "string" || !/^[0-9a-f-]{36}$/i.test(d.appointmentId)) throw new Error("invalid");
      if (!OUTCOMES.includes(d.outcome) || typeof d.note !== "string") throw new Error("invalid");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("record_appointment_outcome", {
      p_appointment_id: data.appointmentId,
      p_outcome: data.outcome,
      p_note: data.note,
      ...(iso(data.newStart) ? { p_new_start: iso(data.newStart)! } : {}),
      ...(iso(data.followupAt) ? { p_followup_at: iso(data.followupAt)! } : {}),
    });
    if (error) throw new Error(error.message);
    const r = res as unknown as {
      outcome_id: string;
      lead_id: string | null;
      deal_id: number | null;
      country: string;
      stage_key: string | null;
      owner_id: string | null;
      followup_id: string | null;
      label: string;
      company: string | null;
      actor_id: string;
    };

    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    let state: "synced" | "simulated" | "no_deal" | "error" = r.deal_id ? "synced" : "no_deal";
    let problem: string | null = null;
    if (r.deal_id) {
      const { data: config } = await db.from("integration_config").select("test_mode").maybeSingle();
      if (config?.test_mode !== false) state = "simulated";
      else {
        try {
          const { json } = gatewayClient(r.country);
          await json("POST", "/notes", { content: `${r.label}\n\n${data.note.trim()}`, deal_id: r.deal_id });
          if (r.stage_key) {
            const { data: map } = await db
              .from("pipedrive_stage_mapping")
              .select("mapping")
              .eq("country", r.country)
              .maybeSingle();
            const stageId = (map?.mapping as Record<string, number> | null)?.[r.stage_key];
            if (typeof stageId !== "number" || !Number.isInteger(stageId)) throw new CrmError("stage_not_mapped");
            await json("PUT", `/deals/${r.deal_id}`, { stage_id: stageId });
            await db.from("lead_crm_links").update({ current_stage_id: stageId }).eq("lead_id", r.lead_id!);
          }
          if (TASK_OUTCOMES.includes(data.outcome)) {
            await json("POST", "/activities", {
              subject: `${r.label}: ${r.company ?? "Kunde"}`,
              type: "task",
              deal_id: r.deal_id,
              note: data.note.trim(),
              due_date: new Date().toISOString().slice(0, 10),
              done: 0,
            });
          }
        } catch (e) {
          state = "error";
          problem = e instanceof CrmError ? e.code : "network_error";
        }
      }
    }
    await db
      .from("appointment_outcomes")
      .update({ pd_state: state, pd_error: problem })
      .eq("id", r.outcome_id);

    // Calendar side (deleted, moved and follow-up appointments): the owner's calendar sync does it right away.
    if (r.owner_id && ["deleted", "rescheduled"].includes(data.outcome)) {
      try {
        const { syncCalendarForUser } = await import("@/lib/calendar-sync.functions");
        await syncCalendarForUser(r.owner_id, r.country);
      } catch {
        // The scheduled sync picks it up.
      }
    }
    if (r.followup_id) {
      try {
        const { data: fu } = await db.from("appointments").select("user_id").eq("id", r.followup_id).maybeSingle();
        if (fu?.user_id) {
          const { syncCalendarForUser } = await import("@/lib/calendar-sync.functions");
          await syncCalendarForUser(fu.user_id, r.country);
        }
      } catch {
        // The scheduled sync picks it up.
      }
    }
    return { state, error: problem, followupId: r.followup_id, stageKey: r.stage_key };
  });
