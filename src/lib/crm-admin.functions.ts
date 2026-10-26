import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayClient } from "@/lib/crm-sync.functions";
import { CrmError, crmErrorMessage } from "@/lib/crm-sync";
import { gatewayReader } from "@/lib/customers.functions";
import { reconcileDeals, type ReconcileResult } from "@/lib/crm-reconcile";
import {
  buildValidationReport,
  type PipedriveField,
  type PipedriveStage,
  type ValidationReport,
} from "@/lib/stage-validation";

const COUNTRIES = ["DE", "AT", "NL"];
const countryInput = (d: { country: string }) => {
  if (!d || !COUNTRIES.includes(d.country)) throw new Error("invalid");
  return d;
};

async function requireAdmin(context: {
  supabase: {
    rpc: (n: "is_global_admin", a: { _uid: string }) => PromiseLike<{ data: unknown }>;
  };
  userId: string;
}) {
  const { data } = await context.supabase.rpc("is_global_admin", { _uid: context.userId });
  if (!data) throw new Error("Nur für Admins.");
}

type RawField = {
  key?: string;
  name?: string;
  field_type?: string;
  options?: { label?: string }[];
};
const toFields = (data: unknown): PipedriveField[] =>
  (Array.isArray(data) ? (data as RawField[]) : [])
    .filter((f) => typeof f.key === "string")
    .map((f) => ({
      key: f.key as string,
      name: String(f.name ?? f.key),
      ...(f.field_type ? { field_type: f.field_type } : {}),
      options: (f.options ?? []).map((o) => ({ label: String(o.label ?? "") })),
    }));

/**
 * Reads pipelines, stages and fields from the real Pipedrive account and checks the stage mapping against them.
 * The result is stored; synchronisation stays locked for the country until it has no error.
 */
export const validateStageMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(countryInput)
  .handler(async ({ data, context }): Promise<ValidationReport & { error?: string }> => {
    await requireAdmin(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    try {
      const { call } = gatewayClient(data.country);
      const [stages, dealFields, personFields, mapping, setting] = await Promise.all([
        call("/stages", { method: "GET" }),
        call("/dealFields", { method: "GET" }),
        call("/personFields", { method: "GET" }),
        db
          .from("pipedrive_stage_mapping")
          .select("mapping")
          .eq("country", data.country)
          .maybeSingle(),
        db
          .from("app_settings")
          .select("value")
          .eq("key", `pipedrive_origin_field_${data.country}`)
          .maybeSingle(),
      ]);
      const list = ((stages.data ?? []) as (PipedriveStage & { pipeline_name?: string })[]).map(
        (s) => ({
          id: s.id,
          name: String(s.name).trim(),
          pipeline_id: s.pipeline_id ?? null,
          pipeline_name: s.pipeline_name ?? null,
        }),
      );
      const originKey = setting.data?.value?.trim() || null;
      const report = buildValidationReport({
        mapping: (mapping.data?.mapping ?? {}) as Record<string, unknown>,
        stages: list,
        dealFields: toFields(dealFields.data),
        personFields: toFields(personFields.data),
        originFieldKey: originKey,
      });
      await db.from("pipedrive_stage_validation").upsert({
        country: data.country,
        ok: report.ok,
        report: report as never,
        origin_field_key: originKey,
        checked_at: report.checkedAt,
        checked_by: context.userId,
      });
      return report;
    } catch (e) {
      const code = e instanceof CrmError ? e.code : "network_error";
      // A failed check is a failed validation: the lock stays.
      await db.from("pipedrive_stage_validation").upsert({
        country: data.country,
        ok: false,
        report: { ok: false, items: [], error: code } as never,
        checked_at: new Date().toISOString(),
        checked_by: context.userId,
      });
      return {
        ok: false,
        items: [],
        checkedAt: new Date().toISOString(),
        error: crmErrorMessage(code),
      };
    }
  });

/** Registers the deal webhook in Pipedrive (admin, once per country). Needs the public base URL of this app. */
export const registerPipedriveWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { country: string; baseUrl: string }) => {
    countryInput(d);
    if (!/^https:\/\/[^\s/]+$/.test(d.baseUrl)) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const user = process.env["PIPEDRIVE_WEBHOOK_USER"];
    const password = process.env["PIPEDRIVE_WEBHOOK_PASSWORD"];
    if (!user || !password)
      throw new Error("PIPEDRIVE_WEBHOOK_USER und PIPEDRIVE_WEBHOOK_PASSWORD sind nicht gesetzt.");
    const { json } = gatewayClient(data.country);
    const r = await json("POST", "/webhooks", {
      subscription_url: `${data.baseUrl}/api/pipedrive-webhook?country=${data.country}`,
      event_action: "change",
      event_object: "deal",
      http_auth_user: user,
      http_auth_password: password,
    });
    return { id: (r.data as { id?: number } | undefined)?.id ?? null };
  });

async function reconcile(country: string): Promise<ReconcileResult> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data } = await db
    .from("lead_crm_links")
    .select("deal_id")
    .eq("country", country)
    .not("deal_id", "is", null)
    .limit(5000);
  return reconcileDeals(
    (data ?? []).map((l) => l.deal_id as number),
    gatewayReader(country),
    async (a) => {
      const { data: r } = await db.rpc("crm_apply_stage", {
        p_country: country,
        p_deal_id: a.dealId,
        p_stage_id: a.stageId,
        p_event_id: a.eventId,
        p_occurred: new Date().toISOString(),
        p_source: "pipedrive",
        p_actor_name: "Pipedrive (Abgleich)",
        p_status: a.status,
      } as never);
      return (r ?? {}) as { applied?: boolean; reason?: string };
    },
  );
}
export { reconcile as reconcileCountry };

/** Manual reconciliation for one country (admin). The same function runs from the scheduled endpoint. */
export const reconcileCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(countryInput)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    return reconcile(data.country);
  });
