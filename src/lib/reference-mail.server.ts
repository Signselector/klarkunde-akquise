import attachmentsManifest from "@/lib/reference-mail-attachments.json";
import { sendSmtp, type SmtpAttachment } from "@/lib/smtp.server";
import type { MailProvider } from "@/lib/lead-email";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SIGNATURE_TEXT = [
  "----------------------------------------------------------------------",
  "",
  "SIGNSELECTOR",
  "Projektberatung & Kundenservice Österreich",
  "3D-Leuchtreklame · Werbeanlagen · Lichtwerbung",
  "",
  "Manuela Greiner",
  "Office Management | SignSelector",
  "",
  "E-Mail: office@signselector.com",
  "Tel.: +43 677 63798279",
  "Web: www.signselector.com",
].join("\n");

function signatureHtml(origin: string) {
  const a = "color:#2a6ad1;font-weight:bold;text-decoration:none";
  return `<hr style="border:none;border-top:1px solid #ccc;margin:24px 0">
<p style="margin:0"><b>SIGNSELECTOR</b><br><i>Projektberatung &amp; Kundenservice Österreich</i><br>3D-Leuchtreklame · Werbeanlagen · Lichtwerbung</p>
<p style="margin:16px 0 0"><b>Manuela Greiner</b><br>Office Management | SignSelector</p>
<p style="margin:16px 0 0">E-Mail: <a style="${a}" href="mailto:office@signselector.com">office@signselector.com</a><br>Tel.: +43 677 63798279<br>Web: <a style="${a}" href="https://www.signselector.com">www.signselector.com</a></p>
<p style="margin:16px 0 0"><img src="${origin}/brand/signselector/logo-ink.png" alt="SignSelector" width="260" style="display:block;width:260px;height:auto"></p>`;
}

export function referenceHtml(body: string, origin: string) {
  const paragraphs = esc(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">
${paragraphs}
${signatureHtml(origin)}
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
  from: string;
  bcc: string | null;
  origin: string;
}): MailProvider {
  return {
    name: "s4-smtp",
    async send(mail) {
      const attachments = await loadAttachments(opts.origin);
      return sendSmtp(
        { host: "s4.meinehp.at", port: 465, user: "noreply@signselector.com", pass: opts.pass },
        {
          from: opts.from,
          to: mail.to,
          bcc: opts.bcc,
          subject: mail.subject,
          text: `${mail.body}\n\n${SIGNATURE_TEXT}`,
          html: referenceHtml(mail.body, opts.origin),
          attachments,
        },
      );
    },
  };
}
