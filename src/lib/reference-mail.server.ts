import attachmentsManifest from "@/lib/reference-mail-attachments.json";
import { sendSmtp, type SmtpAttachment } from "@/lib/smtp.server";
import type { MailProvider } from "@/lib/lead-email";
import { LOGO_PNG_BASE64 } from "@/lib/reference-mail-logo";

const LOGO_CID = "signselector-logo";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Country = "AT" | "DE";
const SIG: Record<Country, { region: string; name: string; email: string; tel: string; web: string }> = {
  AT: { region: "Österreich", name: "Manuela Greiner", email: "office@signselector.com", tel: "+43 677 63798279", web: "www.signselector.com" },
  DE: { region: "Deutschland", name: "Linda Weber", email: "office@signselector.de", tel: "+49 177 5909248", web: "www.signselector.de" },
};
const SMTP: Record<Country, { host: string; user: string }> = {
  AT: { host: "s4.meinehp.at", user: "info@signselector.com" },
  DE: { host: "s5.meinehp.at", user: "info@signselector.de" },
};

function signatureText(c: Country) {
  const s = SIG[c];
  return [
    "----------------------------------------------------------------------",
    "",
    "SIGNSELECTOR",
    `Projektberatung & Kundenservice ${s.region}`,
    "3D-Leuchtreklame · Werbeanlagen · Lichtwerbung",
    "",
    s.name,
    "Office Management | SignSelector",
    "",
    `E-Mail: ${s.email}`,
    `Tel.: ${s.tel}`,
    `Web: ${s.web}`,
  ].join("\n");
}

function signatureHtml(c: Country) {
  const s = SIG[c];
  const a = "color:#2a6ad1;font-weight:bold;text-decoration:none";
  return `<hr style="border:none;border-top:1px solid #ccc;margin:24px 0">
<p style="margin:0"><b>SIGNSELECTOR</b><br><i>Projektberatung &amp; Kundenservice ${s.region}</i><br>3D-Leuchtreklame · Werbeanlagen · Lichtwerbung</p>
<p style="margin:16px 0 0"><b>${s.name}</b><br>Office Management | SignSelector</p>
<p style="margin:16px 0 0">E-Mail: <a style="${a}" href="mailto:${s.email}">${s.email}</a><br>Tel.: ${s.tel}<br>Web: <a style="${a}" href="https://${s.web}">${s.web}</a></p>
<p style="margin:16px 0 0"><img src="cid:${LOGO_CID}" alt="SignSelector" width="260" style="display:block;width:260px;height:auto"></p>`;
}

export function referenceHtml(body: string, country: Country = "AT") {
  const paragraphs = esc(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">
${paragraphs}
${signatureHtml(country)}
</body></html>`;
}

async function loadAttachments(origin: string): Promise<SmtpAttachment[]> {
  return Promise.all(
    attachmentsManifest.map(async (a) => {
      const res = await fetch(new URL(a.url, origin));
      if (!res.ok) throw new Error("send_failed");
      return {
        filename: a.filename,
        contentType: a.contentType,
        content: new Uint8Array(await res.arrayBuffer()),
      };
    }),
  );
}

/** Referenzmail over the S4 mail server, with signature, logo and the 28 reference photos attached. */
export function s4ReferenceProvider(opts: {
  pass: string;
  country: Country;
  bcc: string | null;
  origin: string;
}): MailProvider {
  return {
    name: "s4-smtp",
    async send(mail) {
      const attachments = await loadAttachments(opts.origin);
      return sendSmtp(
        { host: SMTP[opts.country].host, port: 465, user: SMTP[opts.country].user, pass: opts.pass },
        {
          from: `Sign Selector <${SMTP[opts.country].user}>`,
          to: mail.to,
          bcc: opts.bcc,
          subject: mail.subject,
          text: `${mail.body}\n\n${signatureText(opts.country)}`,
          html: referenceHtml(mail.body, opts.country),
          attachments,
          inline: [
            {
              cid: LOGO_CID,
              filename: "signselector-logo.png",
              contentType: "image/png",
              content: Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0)),
            },
          ],
        },
      );
    },
  };
}
