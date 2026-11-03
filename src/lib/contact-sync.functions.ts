import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { contactLabel } from "@/lib/contact-labels";

/** After the caller edited the customer data: update the linked Pipedrive person (phone, e-mail + label). */
export const syncLeadContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { leadId: string }) => {
    if (typeof d?.leadId !== "string" || !/^[0-9a-f-]{36}$/i.test(d.leadId)) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }): Promise<{ pipedrive: "synced" | "simulated" | "skipped" | "error" }> => {
    // RLS as the caller: only leads they may see.
    const { data: lead } = await context.supabase
      .from("leads")
      .select("id,email,phone,extra")
      .eq("id", data.leadId)
      .maybeSingle();
    if (!lead) return { pipedrive: "skipped" };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: link } = await db
      .from("lead_crm_links")
      .select("country,person_id")
      .eq("lead_id", lead.id)
      .maybeSingle();
    if (!link?.person_id || link.person_id <= 0) return { pipedrive: "skipped" };
    const { data: config } = await db.from("integration_config").select("test_mode").maybeSingle();
    if (config?.test_mode !== false) return { pipedrive: "simulated" };
    try {
      const { gatewayClient } = await import("@/lib/crm-sync.functions");
      await gatewayClient(link.country).json("PUT", `/persons/${link.person_id}`, {
        email: lead.email ? [{ value: lead.email, primary: true, label: contactLabel(lead.extra, "email_label") }] : [],
        phone: lead.phone ? [{ value: lead.phone, primary: true, label: contactLabel(lead.extra, "phone_label") }] : [],
      });
      return { pipedrive: "synced" };
    } catch (e) {
      console.error("person sync failed", e instanceof Error ? e.message : e);
      return { pipedrive: "error" };
    }
  });
