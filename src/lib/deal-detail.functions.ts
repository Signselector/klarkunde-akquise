import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";
import { gatewayReader } from "@/lib/customers.functions";
import { CrmError } from "@/lib/crm-sync";
import { noteBody, stripHtml as stripHtmlText, parseFlow, parseNotes, parseStream, type DealEvent, type DealNote, type StreamItem } from "@/lib/deal-detail";

export type DealDetail = {
  source: "pipedrive" | "local";
  notes: DealNote[];
  events: DealEvent[];
  /** Set when Pipedrive could not be read; the notes and the history of the tool are shown instead. */
  error: string | null;
};

/**
 * Notes and history of one deal for "Meine Kunden", read live from Pipedrive. E-mails are never returned. Allowed for
 * the caller whose customer it is and for managers and admins of the country. Demo deals (negative ids) and an
 * unreachable Pipedrive fall back to the notes and activities stored in the tool.
 */
export const loadDealDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string; dealId: number }) => {
    if (!d || !/^[A-Z]{2}$/.test(d.country) || !Number.isSafeInteger(d.dealId))
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }): Promise<DealDetail> => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: link } = await db
      .from("lead_crm_links")
      .select("lead_id,origin_caller_id")
      .eq("country", data.country)
      .eq("deal_id", data.dealId)
      .maybeSingle();
    if (!link) throw new Error("Der Deal wurde nicht gefunden.");
    if (link.origin_caller_id !== context.userId) {
      const { data: staff } = await context.supabase.rpc("has_admin_rights", {
        _uid: context.userId,
        _country: data.country,
      });
      if (!staff) throw new Error("Für diesen Deal hast du keinen Zugriff.");
    }

    const local = async (error: string | null): Promise<DealDetail> => {
      const [notes, activity] = await Promise.all([
        db
          .from("lead_notes")
          .select("id,body,created_at,user_id")
          .eq("lead_id", link.lead_id)
          .order("created_at", { ascending: false })
          .limit(100),
        db
          .from("lead_activity")
          .select("id,action_type,previous_stage,new_stage,occurred_at,acting_user_name")
          .eq("lead_id", link.lead_id)
          .order("occurred_at", { ascending: false })
          .limit(100),
      ]);
      return {
        source: "local",
        error,
        notes: (notes.data ?? []).map((n) => ({
          id: n.id,
          at: n.created_at,
          author: null,
          text: n.body,
        })),
        events: (activity.data ?? [])
          .filter((a) => !/mail/i.test(a.action_type))
          .map((a) => ({
            id: a.id,
            at: a.occurred_at,
            by: a.acting_user_name,
            text:
              a.action_type === "stage_change"
                ? `Stage: ${a.previous_stage ?? "–"} → ${a.new_stage ?? "–"}`
                : a.action_type.replace(/_/g, " "),
          })),
      };
    };

    // Simulated demo deals never exist in Pipedrive.
    if (data.dealId <= 0) return local(null);
    try {
      const { call } = gatewayClient(data.country);
      const [notes, flow, stages] = await Promise.all([
        call(`/notes?deal_id=${data.dealId}&sort=add_time%20DESC&limit=100`, { method: "GET" }),
        call(`/deals/${data.dealId}/flow?limit=100`, { method: "GET" }),
        gatewayReader(data.country)
          .stages()
          .catch(() => []),
      ]);
      const stageNames = Object.fromEntries(stages.map((s) => [s.id, s.name]));
      return {
        source: "pipedrive",
        error: null,
        notes: parseNotes(notes.data),
        events: parseFlow(flow as { data?: unknown; related_objects?: unknown }, stageNames),
      };
    } catch (e) {
      return local(e instanceof CrmError ? e.code : "network_error");
    }
  });

export type LeadStream = {
  linked: boolean;
  /** Managers and admins of the country see everything; callers only notes and stage changes. */
  staff: boolean;
  source: "pipedrive" | "local";
  notes: DealNote[];
  items: StreamItem[];
  error: string | null;
};

/** The first note ever recorded for the lead (the first-contact note) and who wrote it. */
async function firstContactNote(
  db: Awaited<ReturnType<typeof resolveLeadDeal>>["db"],
  leadId: string,
): Promise<{ userId: string | null; body: string } | null> {
  const { data: n } = await db
    .from("lead_notes")
    .select("body,user_id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (n) return { userId: n.user_id, body: noteBody(n.body) };
  const { data: a } = await db
    .from("lead_actions")
    .select("note,user_id")
    .eq("lead_id", leadId)
    .not("note", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return a?.note ? { userId: a.user_id, body: noteBody(a.note) } : null;
}

/**
 * Marks which Pipedrive notes the user may edit: staff and senior callers all of them, a caller only the note of his
 * own first contact. That is the earliest Pipedrive note that contains the first-contact text.
 */
function markEditable(
  notes: DealNote[],
  mayEdit: (text: string) => boolean,
  first: { userId: string | null; body: string } | null,
  userId: string,
  all: boolean,
): DealNote[] {
  if (all) return notes.map((n) => ({ ...n, editable: true }));
  const own = first && first.userId === userId && first.body ? first.body : null;
  const earliest = own
    ? [...notes].filter((n) => n.text.includes(own)).sort((a, b) => a.at.localeCompare(b.at))[0]
    : undefined;
  return notes.map((n) => ({ ...n, editable: !!earliest && n.id === earliest.id && mayEdit(n.text) }));
}

/** Finds the deal of a lead and decides what the user may see. The lead itself must be readable for the user. */
async function resolveLeadDeal(context: { supabase: any; userId: string }, leadId: string) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: visible } = await context.supabase.from("leads").select("id").eq("id", leadId).maybeSingle();
  if (!visible) throw new Error("Für diesen Lead hast du keinen Zugriff.");
  const { data: link } = await db
    .from("lead_crm_links")
    .select("country,deal_id")
    .eq("lead_id", leadId)
    .not("deal_id", "is", null)
    .limit(1)
    .maybeSingle();
  const country = (link?.country as string | undefined) ?? (await db.from("leads").select("batch:lead_batches(country)").eq("id", leadId).maybeSingle()).data?.batch?.country ?? "";
  const [{ data: staff }, { data: senior }] = await Promise.all([
    country
      ? context.supabase.rpc("has_admin_rights", { _uid: context.userId, _country: country })
      : Promise.resolve({ data: false }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "veteran" }),
  ]);
  return {
    db,
    link: link && link.deal_id != null ? { country: link.country as string, dealId: Number(link.deal_id) } : null,
    staff: !!staff,
    senior: !!senior,
  };
}

/** Cheap check: does the lead have a Pipedrive deal? The customer file only shows the feed when it does. */
export const hasLeadDeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { leadId: string }) => {
    if (!d || typeof d.leadId !== "string" || !d.leadId) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }): Promise<{ linked: boolean; staff: boolean }> => {
    const r = await resolveLeadDeal(context, data.leadId);
    return { linked: !!r.link, staff: r.staff };
  });

/**
 * Pipedrive feed of the lead's deal. Staff get notes, stage changes, activities, e-mails and files; callers get only
 * notes and stage changes, filtered here on the server.
 */
export const loadLeadStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { leadId: string }) => {
    if (!d || typeof d.leadId !== "string" || !d.leadId) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }): Promise<LeadStream> => {
    const { db, link, staff, senior } = await resolveLeadDeal(context, data.leadId);
    if (!link) return { linked: false, staff, source: "local", notes: [], items: [], error: null };
    const first = await firstContactNote(db, data.leadId);
    const mayEdit = (text: string) =>
      staff || senior || (!!first && first.userId === context.userId && !!first.body && text.includes(first.body));
    const local = async (error: string | null): Promise<LeadStream> => {
      const [notes, activity] = await Promise.all([
        db.from("lead_notes").select("id,body,created_at").eq("lead_id", data.leadId).order("created_at", { ascending: false }).limit(100),
        db
          .from("lead_activity")
          .select("id,action_type,previous_stage,new_stage,occurred_at,acting_user_name")
          .eq("lead_id", data.leadId)
          .eq("action_type", "stage_change")
          .order("occurred_at", { ascending: false })
          .limit(100),
      ]);
      return {
        linked: true,
        staff,
        source: "local",
        error,
        notes: (notes.data ?? []).map((n) => ({
          id: n.id,
          at: n.created_at,
          author: null,
          text: n.body,
          editable: mayEdit(n.body),
        })),
        items: (activity.data ?? []).map((a) => ({
          id: a.id,
          at: a.occurred_at,
          by: a.acting_user_name,
          kind: "stage" as const,
          text: `Stage: ${a.previous_stage ?? "–"} → ${a.new_stage ?? "–"}`,
        })),
      };
    };
    if (link.dealId <= 0) return local(null);
    try {
      const { call } = gatewayClient(link.country);
      const [notes, flow, stages] = await Promise.all([
        call(`/notes?deal_id=${link.dealId}&sort=add_time%20DESC&limit=100`, { method: "GET" }),
        call(`/deals/${link.dealId}/flow?limit=100`, { method: "GET" }),
        gatewayReader(link.country)
          .stages()
          .catch(() => []),
      ]);
      const stageNames = Object.fromEntries(stages.map((s) => [s.id, s.name]));
      return {
        linked: true,
        staff,
        source: "pipedrive",
        error: null,
        notes: markEditable(parseNotes(notes.data), mayEdit, first, context.userId, staff || senior),
        items: parseStream(flow as { data?: unknown; related_objects?: unknown }, stageNames, { staff }),
      };
    } catch (e) {
      return local(e instanceof CrmError ? e.code : "network_error");
    }
  });

/**
 * Edits a note of the lead. Managers and admins may edit every note, senior callers every note of the lead, callers
 * only their own first-contact note. The tool's copy (lead_notes / lead_actions) and the Pipedrive note are changed
 * together; in test mode Pipedrive is left alone.
 */
export const updateLeadNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { leadId: string; noteId: string; source: "pipedrive" | "local"; content: string }) => {
    if (
      !d ||
      typeof d.leadId !== "string" ||
      typeof d.noteId !== "string" ||
      !d.noteId ||
      (d.source !== "pipedrive" && d.source !== "local") ||
      typeof d.content !== "string" ||
      !d.content.trim() ||
      d.content.length > 5000
    )
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; pipedrive: "synced" | "simulated" | "skipped" | "error" }> => {
    const { db, link, staff, senior } = await resolveLeadDeal(context, data.leadId);
    const content = data.content.trim();
    const first = await firstContactNote(db, data.leadId);
    const all = staff || senior;
    const ownFirst = (text: string) =>
      !!first && first.userId === context.userId && !!first.body && text.includes(first.body);

    let oldText = "";
    if (data.source === "pipedrive") {
      if (!link) throw new Error("Der Lead hat keinen Pipedrive-Deal.");
      const { call } = gatewayClient(link.country);
      const res = await call(`/notes/${encodeURIComponent(data.noteId)}`, { method: "GET" });
      const note = res.data as { content?: string; deal_id?: number } | undefined;
      if (!note || Number(note.deal_id) !== link.dealId) throw new Error("Die Notiz gehört nicht zu diesem Lead.");
      oldText = stripHtmlText(note.content ?? "");
    } else {
      const { data: row } = await db.from("lead_notes").select("body").eq("id", data.noteId).eq("lead_id", data.leadId).maybeSingle();
      if (!row) throw new Error("Notiz nicht gefunden.");
      oldText = row.body;
    }
    if (!all && !ownFirst(oldText)) throw new Error("Diese Notiz darfst du nicht bearbeiten.");

    // Tool copy: the notes and actions whose text is the old text (without the header line the tool adds).
    const oldBody = noteBody(oldText);
    const newBody = noteBody(content);
    if (oldBody) {
      await db.from("lead_notes").update({ body: newBody }).eq("lead_id", data.leadId).eq("body", oldBody);
      await db.from("lead_actions").update({ note: newBody }).eq("lead_id", data.leadId).eq("note", oldBody);
    }
    if (data.source === "local") await db.from("lead_notes").update({ body: content }).eq("id", data.noteId).eq("lead_id", data.leadId);

    if (!link) return { ok: true, pipedrive: "skipped" };
    const { data: config } = await db.from("integration_config").select("test_mode").maybeSingle();
    if (config?.test_mode !== false) return { ok: true, pipedrive: "simulated" };
    if (data.source === "local" || link.dealId <= 0) return { ok: true, pipedrive: "skipped" };
    try {
      const { json } = gatewayClient(link.country);
      await json("PUT", `/notes/${encodeURIComponent(data.noteId)}`, { content });
      return { ok: true, pipedrive: "synced" };
    } catch {
      return { ok: true, pipedrive: "error" };
    }
  });
