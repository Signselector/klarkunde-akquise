/** Notes and history of a deal, as shown under "Meine Kunden". E-mails are never part of it. */
export type DealNote = { id: string; at: string; author: string | null; text: string; editable?: boolean };
export type DealEvent = { id: string; at: string; text: string; by: string | null };

const ACTIVITY_LABEL: Record<string, string> = {
  call: "Anruf",
  meeting: "Meeting",
  task: "Aufgabe",
  deadline: "Frist",
  email: "E-Mail-Aktivität",
  lunch: "Mittagessen",
};

/** Plain text of a note: Pipedrive stores notes as HTML. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pipedrive times are "YYYY-MM-DD HH:MM:SS" in UTC. */
export function pdTime(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)
    ? `${value.replace(" ", "T")}${value.length === 16 ? ":00" : ""}Z`
    : value;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

export function parseNotes(raw: unknown): DealNote[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((n): DealNote | null => {
      const o = obj(n);
      const at = pdTime(o["add_time"]);
      const text = typeof o["content"] === "string" ? stripHtml(o["content"]) : "";
      if (!at || !text) return null;
      const user = obj(o["user"]);
      return {
        id: String(o["id"] ?? at),
        at,
        author: typeof user["name"] === "string" ? user["name"] : null,
        text,
      };
    })
    .filter((n): n is DealNote => !!n)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Deal history from Pipedrive's flow: stage and status changes, activities and files. Notes are listed separately,
 * everything that has to do with e-mail is left out.
 */
export function parseFlow(
  raw: { data?: unknown; related_objects?: unknown } | null | undefined,
  stageNames: Record<number, string>,
): DealEvent[] {
  const list = Array.isArray(raw?.data) ? (raw!.data as unknown[]) : [];
  const users = obj(obj(raw?.related_objects)["user"]);
  const userName = (id: unknown) => {
    const u = obj(users[String(id)]);
    return typeof u["name"] === "string" ? u["name"] : null;
  };
  const stage = (v: unknown) => {
    const id = Number(v);
    return Number.isInteger(id) ? (stageNames[id] ?? `Stage ${id}`) : String(v ?? "–");
  };
  const events: DealEvent[] = [];
  list.forEach((entry, i) => {
    const e = obj(entry);
    const kind = String(e["object"] ?? "");
    if (/mail/i.test(kind) || kind === "note") return;
    const data = obj(e["data"]);
    const at = pdTime(e["timestamp"]) ?? pdTime(data["add_time"]);
    if (!at) return;
    const by = userName(data["user_id"]);
    let text: string | null = null;
    if (kind === "dealChange") {
      const key = String(data["field_key"] ?? "");
      if (key === "stage_id")
        text = `Stage: ${stage(data["old_value"])} → ${stage(data["new_value"])}`;
      else if (key === "status")
        text = `Status: ${String(data["old_value"] ?? "–")} → ${String(data["new_value"] ?? "–")}`;
      else if (key === "add_time") text = "Deal angelegt";
    } else if (kind === "activity") {
      const type = String(data["type"] ?? "");
      const subject = typeof data["subject"] === "string" ? data["subject"] : "";
      text = `${ACTIVITY_LABEL[type] ?? "Aktivität"}${subject ? `: ${subject}` : ""}${data["done"] ? " (erledigt)" : ""}`;
    } else if (kind === "file") {
      const name =
        typeof data["file_name"] === "string"
          ? data["file_name"]
          : typeof data["name"] === "string"
            ? data["name"]
            : "";
      text = `Datei${name ? `: ${name}` : ""}`;
    }
    if (text) events.push({ id: `${kind}-${String(data["id"] ?? i)}-${at}`, at, text, by });
  });
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/** One entry of the Pipedrive feed in the customer file. */
export type StreamKind = "stage" | "status" | "created" | "activity" | "email" | "file";
export type StreamItem = {
  id: string;
  at: string;
  by: string | null;
  kind: StreamKind;
  /** Headline: "Stage: A → B", the activity subject, the mail subject or the file name. */
  text: string;
  /** Activity type (call, meeting, task …) in German. */
  activity?: string;
  /** Activity date, e-mail recipient(s) or file size, ready for display. */
  detail?: string;
  /** E-mail state such as GEPLANT. */
  state?: string;
  /** Start of the e-mail text. */
  preview?: string;
  /** Activity is done. */
  done?: boolean;
};

/** Text of a note without the "date · caller" header line the tool puts on notes it sends to Pipedrive. */
export function noteBody(text: string): string {
  return text.replace(/^[^\n]*·[^\n]*\n/, "").trim();
}

function fileSize(bytes: unknown): string | undefined {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

/**
 * Full Pipedrive feed of a deal (stage changes, activities, e-mails, files). Notes come from {@link parseNotes}.
 * With `staff: false` (callers) only stage changes remain: the filter lives here so the server never hands out
 * e-mails, files or activities to a caller.
 */
export function parseStream(
  raw: { data?: unknown; related_objects?: unknown } | null | undefined,
  stageNames: Record<number, string>,
  opts: { staff: boolean },
): StreamItem[] {
  const list = Array.isArray(raw?.data) ? (raw!.data as unknown[]) : [];
  const users = obj(obj(raw?.related_objects)["user"]);
  const userName = (id: unknown) => {
    const u = obj(users[String(id)]);
    return typeof u["name"] === "string" ? u["name"] : null;
  };
  const stage = (v: unknown) => {
    const id = Number(v);
    return Number.isInteger(id) ? (stageNames[id] ?? `Stage ${id}`) : String(v ?? "–");
  };
  const items: StreamItem[] = [];
  list.forEach((entry, i) => {
    const e = obj(entry);
    const kind = String(e["object"] ?? "");
    if (kind === "note") return;
    const data = obj(e["data"]);
    const at = pdTime(e["timestamp"]) ?? pdTime(data["add_time"]);
    if (!at) return;
    const by = userName(data["user_id"]);
    const id = `${kind}-${String(data["id"] ?? i)}-${at}`;
    if (kind === "dealChange") {
      const key = String(data["field_key"] ?? "");
      if (key === "stage_id")
        items.push({ id, at, by, kind: "stage", text: `Stage: ${stage(data["old_value"])} → ${stage(data["new_value"])}` });
      else if (!opts.staff) return;
      else if (key === "status")
        items.push({ id, at, by, kind: "status", text: `Status: ${String(data["old_value"] ?? "–")} → ${String(data["new_value"] ?? "–")}` });
      else if (key === "add_time") items.push({ id, at, by, kind: "created", text: "Deal angelegt" });
      return;
    }
    if (!opts.staff) return;
    if (kind === "activity") {
      const type = String(data["type"] ?? "");
      const subject = typeof data["subject"] === "string" ? data["subject"] : "";
      const due = [data["due_date"], data["due_time"]].filter((x) => typeof x === "string" && x).join(" ");
      items.push({
        id,
        at,
        by,
        kind: "activity",
        text: subject || (ACTIVITY_LABEL[type] ?? "Aktivität"),
        activity: ACTIVITY_LABEL[type] ?? "Aktivität",
        done: !!data["done"],
        ...(due ? { detail: due } : {}),
      });
    } else if (/mail/i.test(kind)) {
      const to = (Array.isArray(data["to"]) ? (data["to"] as unknown[]) : [])
        .map((r) => {
          const o = obj(r);
          return String(o["name"] || o["email_address"] || "");
        })
        .filter(Boolean)
        .join(", ");
      const body = data["snippet"] ?? data["body"] ?? data["body_url"];
      const preview =
        typeof body === "string" && !/^https?:/.test(body) ? stripHtml(body).slice(0, 200) : "";
      const state = data["draft"]
        ? "ENTWURF"
        : data["sent_flag"] === 0 || data["sent_flag"] === false
          ? "GEPLANT"
          : data["sent_flag"] === 1 || data["sent_flag"] === true
            ? "GESENDET"
            : undefined;
      items.push({
        id,
        at,
        by,
        kind: "email",
        text: typeof data["subject"] === "string" && data["subject"] ? data["subject"] : "(Ohne Betreff)",
        ...(to ? { detail: to } : {}),
        ...(state ? { state } : {}),
        ...(preview ? { preview } : {}),
      });
    } else if (kind === "file") {
      const name = String(data["file_name"] ?? data["name"] ?? "Datei");
      const size = fileSize(data["file_size"]);
      items.push({ id, at, by, kind: "file", text: name, ...(size ? { detail: size } : {}) });
    }
  });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
