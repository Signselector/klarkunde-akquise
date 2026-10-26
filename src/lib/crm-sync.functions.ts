import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CrmError,
  syncLeadAction as runSync,
  type Crm,
  type SyncContext,
  type SyncStore,
} from "@/lib/crm-sync";

const KEY_BY_COUNTRY: Record<string, string> = {
  DE: "PIPEDRIVE_API_KEY",
  AT: "PIPEDRIVE_API_KEY_1",
};
const GATEWAY = "https://connector-gateway.lovable.dev/pipedrive";

type GatewayResult = { data?: unknown };

/** Low-level access to Pipedrive through the Lovable connector gateway (same connection the stage loader uses). */
export function gatewayClient(country: string) {
  const lovable = process.env["LOVABLE_API_KEY"];
  const keyName = KEY_BY_COUNTRY[country];
  if (!keyName) throw new CrmError("country_not_connected");
  const connection = process.env[keyName];
  if (!lovable || !connection) throw new CrmError("not_configured");
  const headers = { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": connection };

  async function call(path: string, init: RequestInit): Promise<GatewayResult> {
    let response: Response;
    try {
      response = await fetch(`${GATEWAY}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { ...headers, ...(init.headers ?? {}) },
      });
    } catch {
      throw new CrmError("network_error");
    }
    if (response.status === 401 || response.status === 403) throw new CrmError("unauthorized");
    if (response.status === 429) throw new CrmError("rate_limited");
    if (!response.ok) {
      console.error(`Pipedrive ${init.method} ${path} failed [${response.status}]`);
      throw new CrmError(response.status >= 500 ? "network_error" : "invalid_payload");
    }
    return (await response.json().catch(() => ({}))) as GatewayResult;
  }
  const json = (method: string, path: string, body: unknown) =>
    call(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { call, json };
}

/** Pipedrive writes used by the action sync. */
function gatewayCrm(country: string): Crm {
  const { call, json } = gatewayClient(country);
  const id = (r: GatewayResult) => {
    const value = (r.data as { id?: number } | undefined)?.id;
    if (!value || !Number.isSafeInteger(value)) throw new CrmError("invalid_payload");
    return value;
  };
  return {
    createOrganization: async (d) => id(await json("POST", "/organizations", d)),
    createPerson: async (d) => id(await json("POST", "/persons", d)),
    createDeal: async (d) => id(await json("POST", "/deals", d)),
    moveDeal: async (dealId, stageId) => {
      await json("PUT", `/deals/${dealId}`, { stage_id: stageId });
    },
    addNote: async (dealId, content) => {
      await json("POST", "/notes", { content, deal_id: dealId });
    },
    uploadFile: async (dealId, filename, bytes, contentType) => {
      const form = new FormData();
      form.append("deal_id", String(dealId));
      form.append("file", new Blob([bytes as BlobPart], { type: contentType }), filename);
      await call("/files", { method: "POST", body: form });
    },
  };
}

async function databaseStore(
  userId: string,
  admin: boolean,
): Promise<SyncStore & { country(): string }> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  let country = "";
  return {
    country: () => country,
    async begin(actionId) {
      const stale = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data: row } = await db
        .from("lead_actions")
        .update({
          crm_sync_state: "syncing",
          crm_error: null,
          crm_attempted_at: new Date().toISOString(),
        })
        .eq("id", actionId)
        .or(
          `crm_sync_state.in.(queued,error),and(crm_sync_state.eq.syncing,crm_attempted_at.lt.${stale})`,
        )
        .select("*")
        .maybeSingle();
      if (!row) return null;
      // Only the author (or an admin) may push an action.
      if (row.user_id !== userId && !admin) {
        await db.from("lead_actions").update({ crm_sync_state: "queued" }).eq("id", actionId);
        throw new Error("forbidden");
      }
      const [lead, links, profile] = await Promise.all([
        db
          .from("leads")
          .select("id,company,contact_name,email,phone,batch_id")
          .eq("id", row.lead_id)
          .single(),
        db.from("lead_crm_links").select("*").eq("lead_id", row.lead_id).maybeSingle(),
        db.from("profiles").select("display_name").eq("id", row.user_id).maybeSingle(),
      ]);
      const batch = await db
        .from("lead_batches")
        .select("country")
        .eq("id", lead.data?.batch_id ?? "")
        .maybeSingle();
      country = batch.data?.country ?? "";
      const mapping = await db
        .from("pipedrive_stage_mapping")
        .select("mapping")
        .eq("country", country)
        .maybeSingle();
      const originId = links.data?.origin_caller_id ?? row.user_id;
      const [validation, field, origin] = await Promise.all([
        db.from("pipedrive_stage_validation").select("ok").eq("country", country).maybeSingle(),
        db
          .from("app_settings")
          .select("value")
          .eq("key", `pipedrive_origin_field_${country}`)
          .maybeSingle(),
        db.from("profiles").select("display_name").eq("id", originId).maybeSingle(),
      ]);
      if (links.data)
        await db.rpc("crm_set_sync_state", { p_lead: row.lead_id, p_state: "syncing" });
      const ctx: SyncContext = {
        action: { ...row, crm_steps: (row.crm_steps ?? {}) as Record<string, boolean> },
        lead: lead.data as SyncContext["lead"],
        country,
        callerName: profile.data?.display_name ?? "",
        stages: (mapping.data?.mapping ?? {}) as Record<string, number>,
        links: links.data ?? {},
        validated: validation.data?.ok === true,
        originFieldKey: field.data?.value?.trim() || null,
        originLabel: `${origin.data?.display_name ?? "Caller"} (${originId})`,
      };
      return ctx;
    },
    async saveLinks(leadId, c, links) {
      await db
        .from("lead_crm_links")
        .upsert({ lead_id: leadId, country: c, ...links, updated_at: new Date().toISOString() });
    },
    async dealCreated(ctx, links) {
      await db.rpc("crm_save_links", {
        p_lead: ctx.lead.id,
        p_country: ctx.country,
        p_org: links.organization_id ?? null,
        p_person: links.person_id ?? null,
        p_deal: links.deal_id ?? null,
        p_origin: ctx.action.user_id,
        p_stage_key: ctx.action.stage_key ?? null,
        p_actor: ctx.action.user_id,
      });
    },
    async stageMoved(ctx, dealId, stageId) {
      await db.rpc("crm_apply_stage", {
        p_country: ctx.country,
        p_deal_id: dealId,
        p_stage_id: stageId,
        p_event_id: `tool:${ctx.action.id}`,
        p_occurred: new Date().toISOString(),
        p_source: "cold_caller",
        p_actor: ctx.action.user_id,
        p_actor_name: ctx.callerName || null,
        p_status: null,
        p_stage_key: ctx.action.stage_key ?? null,
      });
    },
    async markStep(actionId, step) {
      const { data } = await db
        .from("lead_actions")
        .select("crm_steps")
        .eq("id", actionId)
        .single();
      await db
        .from("lead_actions")
        .update({ crm_steps: { ...((data?.crm_steps ?? {}) as object), [step]: true } })
        .eq("id", actionId);
    },
    async downloadLogo(path) {
      const { data, error } = await db.storage.from("lead-logos").download(path);
      if (error || !data) throw new CrmError("logo_missing");
      return {
        bytes: new Uint8Array(await data.arrayBuffer()),
        contentType: data.type || "application/octet-stream",
      };
    },
    async finish(actionId, state, error) {
      const { data: act } = await db
        .from("lead_actions")
        .select("lead_id")
        .eq("id", actionId)
        .maybeSingle();
      if (act)
        await db.rpc("crm_set_sync_state", {
          p_lead: act.lead_id,
          p_state: state === "synced" ? "synced" : "failed",
        });
      await db
        .from("lead_actions")
        .update({
          crm_sync_state: state,
          crm_error: error ?? null,
          ...(state === "synced" ? { crm_synced_at: new Date().toISOString() } : {}),
        })
        .eq("id", actionId);
    },
  };
}

/** Sends one recorded action to Pipedrive. Safe to call again after an error. */
export const syncLeadAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { actionId: string }) => {
    if (!d || typeof d.actionId !== "string" || !/^[0-9a-f-]{36}$/i.test(d.actionId))
      throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    // RLS: only the author's own actions (or all for admins) are visible here.
    const { data: own } = await context.supabase
      .from("lead_actions")
      .select("id")
      .eq("id", data.actionId)
      .maybeSingle();
    if (!own) throw new Error("Aktion nicht gefunden.");
    // Test mode (on by default): nothing is sent to Pipedrive, the action is only recorded as simulated.
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: config } = await db.from("integration_config").select("test_mode").maybeSingle();
    if (config?.test_mode !== false) {
      await db
        .from("lead_actions")
        .update({ crm_sync_state: "simulated", crm_error: null })
        .eq("id", data.actionId)
        .in("crm_sync_state", ["queued", "error", "simulated"]);
      return { state: "simulated" as const };
    }
    const store = await databaseStore(context.userId, !!isAdmin);
    // The CRM client needs the lead's country, which is only known once the store has loaded the action.
    let crm: Crm | null = null;
    const lazy: Crm = new Proxy({} as Crm, {
      get:
        (_t, prop: keyof Crm) =>
        (...args: never[]) => {
          crm ??= gatewayCrm(store.country());
          return (crm[prop] as (...a: never[]) => unknown)(...args);
        },
    });
    return runSync(data.actionId, store, lazy);
  });
