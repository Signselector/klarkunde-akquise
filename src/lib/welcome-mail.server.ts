import { sendSmtp } from "@/lib/smtp.server";
import { LOGO_PNG_BASE64 } from "@/lib/reference-mail-logo";

const APP_URL = "https://coldcaller-tool.signselector.com";

/** Welcome mails go out only between 06:00 and 20:59 Vienna time. */
export function inWelcomeWindow(now = new Date()): boolean {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  return h >= 6 && h <= 20;
}

function mailHtml(name: string, link: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f7f7f8;margin:0;padding:30px 15px;color:#1c1c1e">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e5ea;padding:36px 32px">
<div style="border-bottom:2px solid #b3261e;padding-bottom:20px;margin-bottom:24px"><img src="cid:signselector-logo" alt="Sign Selector" style="height:38px;width:auto;display:block"/></div>
<h1 style="font-size:20px;margin:0 0 16px">Willkommen im Cold-Caller-Tool</h1>
<p style="font-size:15px;line-height:1.55">Hallo ${esc(name)},</p>
<p style="font-size:15px;line-height:1.55">dein Account für das <strong>Sign Selector Cold-Caller-Tool</strong> wurde über das Teammanagement eingerichtet.</p>
<p style="font-size:15px;line-height:1.55">Klicke auf den Button, um dein persönliches Passwort festzulegen:</p>
<div style="text-align:center;margin:28px 0"><a href="${link}" style="display:inline-block;background:#b3261e;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:6px">Passwort jetzt festlegen</a></div>
<p style="font-size:13px;color:#636366">Der Link ist zeitlich begrenzt. Falls er abgelaufen ist, nutze auf der Login-Seite „Passwort vergessen“.</p>
<div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e5ea;font-size:13px;color:#8e8e93">
<strong>Sign Selector</strong><br>Automatische Nachricht · Bitte nicht antworten.<br>Support: office@signselector.com</div>
</div></body></html>`;
}

/** Sends the welcome/password mail to every account imported from Teammanagement that is still marked pending. */
export async function sendPendingWelcomeMails(): Promise<{ sent: number; failed: number; skipped?: string }> {
  if (!inWelcomeWindow()) return { sent: 0, failed: 0, skipped: "outside_window" };
  const pass = process.env["SMTP_PASSWORD_AT"];
  if (!pass) return { sent: 0, failed: 0, skipped: "no_smtp" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const pending: { id: string; email: string; name: string; meta: Record<string, unknown> }[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 500 });
    if (error) break;
    for (const u of data.users) {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      if (meta["welcome_pending"] === true && u.email)
        pending.push({ id: u.id, email: u.email, name: String(meta["display_name"] ?? ""), meta });
    }
    if (data.users.length < 500) break;
  }

  const logo = Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0));
  let sent = 0;
  let failed = 0;
  for (const p of pending.slice(0, 100)) {
    try {
      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: p.email,
        options: { redirectTo: `${APP_URL}/reset-password` },
      });
      const url = link?.properties?.action_link;
      if (error || !url) throw new Error("link_failed");
      const greeting = p.name || "zusammen";
      await sendSmtp(
        { host: "s4.meinehp.at", port: 465, user: "noreply@signselector.com", pass },
        {
          from: "Sign Selector <noreply@signselector.com>",
          to: p.email,
          subject: "Dein Zugang zum Sign Selector Cold-Caller-Tool",
          text: `Hallo ${greeting},\n\ndein Account für das Sign Selector Cold-Caller-Tool wurde eingerichtet.\nLege hier dein Passwort fest:\n\n${url}\n\nSign Selector\noffice@signselector.com`,
          html: mailHtml(greeting, url),
          inline: [{ filename: "logo.png", contentType: "image/png", content: logo, cid: "signselector-logo" }],
        },
      );
      await supabaseAdmin.auth.admin.updateUserById(p.id, {
        user_metadata: { ...p.meta, welcome_pending: false, welcome_sent_at: new Date().toISOString() },
      });
      sent++;
    } catch (e) {
      console.error("welcome mail failed", p.email, e instanceof Error ? e.message : e);
      failed++;
    }
  }
  return { sent, failed };
}
