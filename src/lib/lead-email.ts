/**
 * Sends one prepared e-mail. An e-mail only counts as sent after the provider confirmed it with a message id.
 * Test mode records "simulated" and never contacts a provider. Pure logic with injected dependencies.
 */
export type MailRow = {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  status: "pending" | "sending" | "sent" | "simulated" | "failed";
  attempts: number;
};
export interface MailProvider {
  name: string;
  send(mail: { to: string; subject: string; body: string }): Promise<{ messageId: string }>;
}
export type MailStore = {
  /** Moves pending/failed to sending; null when another request already took it or it is final. */
  claim(id: string): Promise<MailRow | null>;
  finish(
    id: string,
    result: {
      status: "sent" | "simulated" | "failed";
      provider?: string;
      messageId?: string;
      error?: string;
    },
  ): Promise<void>;
};
export type MailResult = { status: MailRow["status"]; error?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (v: string) => v.length <= 254 && EMAIL.test(v.trim());

export async function deliverEmail(
  row: MailRow,
  opts: { testMode: boolean; provider: MailProvider | null },
  store: MailStore,
): Promise<MailResult> {
  if (row.status === "sent" || row.status === "simulated") return { status: row.status };
  const claimed = await store.claim(row.id);
  if (!claimed) return { status: row.status };
  if (opts.testMode) {
    await store.finish(row.id, { status: "simulated", provider: "test-mode" });
    return { status: "simulated" };
  }
  if (!opts.provider) {
    await store.finish(row.id, { status: "failed", error: "email_provider_not_configured" });
    return { status: "failed", error: "email_provider_not_configured" };
  }
  try {
    const { messageId } = await opts.provider.send({
      to: claimed.to_email,
      subject: claimed.subject,
      body: claimed.body,
    });
    if (!messageId) throw new Error("no_confirmation");
    await store.finish(row.id, { status: "sent", provider: opts.provider.name, messageId });
    return { status: "sent" };
  } catch (e) {
    const error = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : "send_failed";
    await store.finish(row.id, { status: "failed", provider: opts.provider.name, error });
    return { status: "failed", error };
  }
}

const MESSAGES: Record<string, string> = {
  email_provider_not_configured:
    "Es ist kein E-Mail-Versand eingerichtet. Die Mail wurde nicht gesendet und der Lead nicht abgeschlossen.",
  no_confirmation: "Der E-Mail-Dienst hat den Versand nicht bestätigt. Bitte erneut versuchen.",
  send_failed: "Die E-Mail konnte nicht gesendet werden. Bitte erneut versuchen.",
  rejected: "Der E-Mail-Dienst hat die Mail abgelehnt. Bitte Adresse und Inhalt prüfen.",
};
export const emailErrorMessage = (code: string | null | undefined) =>
  (code && MESSAGES[code]) || (code ? MESSAGES["send_failed"]! : "");

/** Resend (https://resend.com) as the first real provider; active only when its key and sender are configured. */
export function resendProvider(apiKey: string, from: string, bcc?: string | null): MailProvider {
  return {
    name: "resend",
    async send(mail) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.body,
          // Pipedrive Smart BCC: the mail is filed in Pipedrive under the contact.
          ...(bcc ? { bcc: [bcc] } : {}),
        }),
      }).catch(() => {
        throw new Error("send_failed");
      });
      if (res.status === 422 || res.status === 400) throw new Error("rejected");
      if (!res.ok) throw new Error("send_failed");
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      if (!json.id) throw new Error("no_confirmation");
      return { messageId: json.id };
    },
  };
}
