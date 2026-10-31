/** Notes and history of a deal, as shown under "Meine Kunden". E-mails are never part of it. */
export type DealNote = { id: string; at: string; author: string | null; text: string };
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
