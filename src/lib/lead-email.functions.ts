import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  deliverEmail,
  isValidEmail,
  resendProvider,
  type MailProvider,
  type MailRow,
  type MailStore,
} from "@/lib/lead-email";

type Input = {
  requestId: string;
  leadId: string;
  kind: "reference_mail";
  to: string;
  subject: string;
  body: string;
  templateId?: string | null;
};
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Sends (or retries) one prepared e-mail for a lead and returns its status. The caller sees `sent` or `simulated`
 * only when the provider confirmed it (or test mode is on); the lead action later requires that.
 */
export const sendLeadEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => {
    if (!d || !UUID.test(d.requestId) || !UUID.test(d.leadId)) throw new Error("invalid");
    if (d.kind !== "reference_mail") throw new Error("invalid");
    if (!isValidEmail(String(d.to ?? "").trim())) throw new Error("invalid_email");
    if (!d.subject?.trim() || d.subject.length > 300) throw new Error("invalid");
    if (!d.body?.trim() || d.body.length > 20000) throw new Error("invalid");
    return d;
  })
  .handler(async ({ data, context }) => {
    // RLS: the lead must be visible to this user.
    const { data: lead } = await context.supabase
      .from("leads")
      .select("id")
      .eq("id", data.leadId)
      .maybeSingle();
    if (!lead) throw new Error("Lead nicht gefunden.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db.from("lead_emails").upsert(
      {
        request_id: data.requestId,
        lead_id: data.leadId,
        created_by: context.userId,
        kind: data.kind,
        template_id: data.templateId ?? null,
        to_email: data.to.trim().toLowerCase(),
        subject: data.subject.trim(),
        body: data.body,
      },
      { onConflict: "request_id", ignoreDuplicates: true },
    );
    const { data: row } = await db
      .from("lead_emails")
      .select("id,to_email,subject,body,status,attempts,created_by,lead_id")
      .eq("request_id", data.requestId)
      .single();
    if (!row || row.created_by !== context.userId || row.lead_id !== data.leadId)
      throw new Error("forbidden");
    const { data: config } = await db.from("integration_config").select("test_mode").maybeSingle();
    const key = process.env["RESEND_API_KEY"];
    const from = process.env["EMAIL_FROM"];
    const provider: MailProvider | null = key && from ? resendProvider(key, from) : null;
    const store: MailStore = {
      async claim(id) {
        const { data: claimed } = await db
          .from("lead_emails")
          .update({
            status: "sending",
            attempts: row.attempts + 1,
            attempted_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", id)
          .in("status", ["pending", "failed"])
          .select("id,to_email,subject,body,status,attempts")
          .maybeSingle();
        return (claimed as MailRow | null) ?? null;
      },
      async finish(id, r) {
        await db
          .from("lead_emails")
          .update({
            status: r.status,
            provider: r.provider ?? null,
            provider_message_id: r.messageId ?? null,
            error: r.error ?? null,
            ...(r.status === "failed" ? {} : { sent_at: new Date().toISOString() }),
          })
          .eq("id", id);
      },
    };
    const result = await deliverEmail(
      row as MailRow,
      { testMode: config?.test_mode !== false, provider },
      store,
    );
    return { id: row.id, status: result.status, error: result.error ?? null };
  });
