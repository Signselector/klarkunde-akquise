/**
 * Minimal SMTP client (implicit TLS, AUTH LOGIN) that runs on Cloudflare Workers (cloudflare:sockets)
 * and on Node (node:tls, used by the dev preview). Builds a multipart MIME message with HTML + attachments.
 */
type Conn = {
  write(data: Uint8Array): Promise<void>;
  read(): Promise<Uint8Array | null>;
  close(): void;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

async function openConn(host: string, port: number): Promise<Conn> {
  const isWorker = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
  if (isWorker) {
    const spec = "cloudflare:sockets";
    const { connect } = (await import(/* @vite-ignore */ spec)) as {
      connect: (a: { hostname: string; port: number }, o: { secureTransport: "on" }) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
        close(): Promise<void>;
      };
    };
    const socket = connect({ hostname: host, port }, { secureTransport: "on" });
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    return {
      write: (d) => writer.write(d),
      read: async () => {
        const r = await reader.read();
        return r.done ? null : r.value;
      },
      close: () => void socket.close().catch(() => {}),
    };
  }
  const spec = "node:tls";
  const tls = (await import(/* @vite-ignore */ spec)) as typeof import("node:tls");
  const socket = tls.connect({ host, port, servername: host });
  const queue: Uint8Array[] = [];
  let waiting: ((v: Uint8Array | null) => void) | null = null;
  let ended = false;
  socket.on("data", (b: Buffer) => {
    const u = new Uint8Array(b);
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(u);
    } else queue.push(u);
  });
  const end = () => {
    ended = true;
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(null);
    }
  };
  socket.on("end", end);
  socket.on("close", end);
  socket.on("error", end);
  return {
    write: (d) =>
      new Promise((res, rej) => socket.write(d, (e) => (e ? rej(e) : res()))),
    read: () =>
      queue.length
        ? Promise.resolve(queue.shift()!)
        : ended
          ? Promise.resolve(null)
          : new Promise((r) => (waiting = r)),
    close: () => socket.end(),
  };
}

function b64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(s);
}
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(enc.encode(s))}?=`);

export type SmtpAttachment = { filename: string; contentType: string; content: Uint8Array };
export type SmtpMail = {
  from: string; // e.g. "Sign Selector <noreply@signselector.com>"
  to: string;
  bcc?: string | null;
  subject: string;
  text: string;
  html: string;
  attachments?: SmtpAttachment[];
};

const addr = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim();

export function buildMime(mail: SmtpMail, messageId: string): string {
  const mixed = `mix_${crypto.randomUUID()}`;
  const alt = `alt_${crypto.randomUUID()}`;
  const fromName = mail.from.match(/^(.*)<[^>]+>/)?.[1]?.trim();
  const lines = [
    `From: ${fromName ? `${encWord(fromName)} <${addr(mail.from)}>` : addr(mail.from)}`,
    `To: ${mail.to}`,
    `Subject: ${encWord(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(enc.encode(mail.text))),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(enc.encode(mail.html))),
    `--${alt}--`,
  ];
  for (const a of mail.attachments ?? []) {
    const fn = encodeURIComponent(a.filename);
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType}; name="${encWord(a.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename*=UTF-8''${fn}`,
      "",
      wrap76(b64(a.content)),
    );
  }
  lines.push(`--${mixed}--`, "");
  return lines.join("\r\n");
}

export async function sendSmtp(
  cfg: { host: string; port: number; user: string; pass: string },
  mail: SmtpMail,
): Promise<{ messageId: string }> {
  const conn = await openConn(cfg.host, cfg.port);
  let buf = "";
  const readReply = async (): Promise<{ code: number; text: string }> => {
    for (;;) {
      const lines = buf.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]!)) {
          const text = lines.slice(0, i + 1).join("\n");
          buf = lines.slice(i + 1).join("\r\n");
          return { code: Number(lines[i]!.slice(0, 3)), text };
        }
      }
      const chunk = await conn.read();
      if (!chunk) throw new Error("send_failed");
      buf += dec.decode(chunk);
    }
  };
  const cmd = async (line: string, expect: number[]) => {
    await conn.write(enc.encode(line + "\r\n"));
    const r = await readReply();
    if (!expect.includes(r.code)) {
      console.error("SMTP rejected", line.split(" ")[0], r.code, r.text.slice(0, 200));
      throw new Error(r.code >= 500 && r.code < 600 ? "rejected" : "send_failed");
    }
    return r;
  };
  try {
    const hello = await readReply();
    if (hello.code !== 220) throw new Error("send_failed");
    await cmd("EHLO signselector.com", [250]);
    await cmd("AUTH LOGIN", [334]);
    await cmd(btoa(cfg.user), [334]);
    await cmd(btoa(cfg.pass), [235]);
    await cmd(`MAIL FROM:<${addr(mail.from)}>`, [250]);
    await cmd(`RCPT TO:<${addr(mail.to)}>`, [250, 251]);
    if (mail.bcc) await cmd(`RCPT TO:<${addr(mail.bcc)}>`, [250, 251]);
    await cmd("DATA", [354]);
    const messageId = `<${crypto.randomUUID()}@signselector.com>`;
    const data = enc.encode(buildMime(mail, messageId) + "\r\n.\r\n");
    for (let i = 0; i < data.length; i += 64 * 1024) await conn.write(data.subarray(i, i + 64 * 1024));
    const r = await readReply();
    if (r.code !== 250) throw new Error(r.code >= 500 ? "rejected" : "send_failed");
    await cmd("QUIT", [221]).catch(() => {});
    return { messageId };
  } finally {
    conn.close();
  }
}
