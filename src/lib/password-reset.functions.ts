import { createServerFn } from "@tanstack/react-start";

const SMTP = {
  AT: { host: "s4.meinehp.at", user: "noreply@signselector.com", support: "office@signselector.com", secret: "SMTP_PASSWORD_AT" },
  DE: { host: "s5.meinehp.at", user: "noreply@signselector.de", support: "office@signselector.de", secret: "SMTP_PASSWORD_DE" },
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function html(link: string, support: string, code: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f7f7f8;margin:0;padding:30px 15px;color:#1c1c1e">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e5ea;padding:36px 32px">
<div style="border-bottom:2px solid #b3261e;padding-bottom:20px;margin-bottom:24px"><img src="cid:signselector-logo" alt="Sign Selector" style="height:38px;width:auto;display:block"/></div>
<h1 style="font-size:20px;margin:0 0 16px">Passwort zurücksetzen</h1>
<p style="font-size:15px;line-height:1.55">Für deinen Account im <strong>Sign Selector Cold-Caller-Tool</strong> wurde ein neues Passwort angefordert.</p>
<div style="text-align:center;margin:28px 0"><a href="${esc(link)}" style="display:inline-block;background:#b3261e;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:6px">Neues Passwort festlegen</a></div>
${code ? `<p style="font-size:14px;line-height:1.55;text-align:center">Alternativ auf der Seite „Neues Passwort“ diesen Code eingeben:<br><span style="display:inline-block;margin-top:8px;font-size:22px;font-weight:700;letter-spacing:4px">${esc(code)}</span></p>` : ""}
<p style="font-size:13px;color:#636366">Der Link ist zeitlich begrenzt. Wenn du das nicht angefordert hast, kannst du diese Mail ignorieren.</p>
<div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e5ea;font-size:13px;color:#8e8e93">
<strong>Sign Selector</strong><br>Automatische Nachricht · Bitte nicht antworten.<br>Support: ${support}</div>
</div></body></html>`;
}

/** Public: sends a password-reset link over our own S4 (AT) / S5 (DE) mail servers. Always answers ok (no account probing). */
export const sendPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; origin: string }) => {
    const email = String(input.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Ungültige E-Mail.");
    const origin = String(input.origin ?? "");
    const allowed = /^https:\/\/([a-z0-9-]+\.)*(lovable\.app|signselector\.com)$/.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    return { email, origin: allowed ? origin : "https://coldcaller-tool.signselector.com" };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin.from("profiles").select("id").ilike("email", data.email).maybeSingle();
    if (!prof) return { ok: true };

    const { data: cs } = await supabaseAdmin.from("user_countries").select("country").eq("user_id", prof.id);
    const list = (cs ?? []).map((r) => r.country);
    const c = list.includes("DE") && !list.includes("AT") ? "DE" : "AT";
    const cfg = SMTP[c];
    const pass = process.env[cfg.secret];
    if (!pass) throw new Error("Mailserver nicht konfiguriert.");

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
      options: { redirectTo: `${data.origin}/reset-password` },
    });
    const hash = link?.properties?.hashed_token;
    const code = link?.properties?.email_otp ?? "";
    if (error || !hash) throw new Error("Link konnte nicht erstellt werden.");
    // Scanner-safe: link points to our own page; token is only redeemed when the user submits the new password.
    const url = `${data.origin}/reset-password?token_hash=${encodeURIComponent(hash)}&email=${encodeURIComponent(data.email)}`;

    const { sendSmtp } = await import("@/lib/smtp.server");
    const { LOGO_PNG_BASE64 } = await import("@/lib/reference-mail-logo");
    await sendSmtp(
      { host: cfg.host, port: 465, user: cfg.user, pass },
      {
        from: `Sign Selector <${cfg.user}>`,
        to: data.email,
        subject: "Passwort zurücksetzen – Sign Selector Cold-Caller-Tool",
        text: `Für deinen Account wurde ein neues Passwort angefordert.\nLege es hier fest:\n\n${url}\n\nAlternativ: Öffne ${data.origin}/reset-password und gib diesen Code ein: ${code}\n\nWenn du das nicht angefordert hast, ignoriere diese Mail.\n\nSign Selector\n${cfg.support}`,
        html: html(url, cfg.support, code),
        inline: [{ filename: "logo.png", contentType: "image/png", cid: "signselector-logo", content: Uint8Array.from(atob(LOGO_PNG_BASE64), (x) => x.charCodeAt(0)) }],
      },
    );
    return { ok: true };
  });
