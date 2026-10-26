/** Reads an inbound-mail webhook: who wrote, and which sent messages the mail refers to. Accepts the usual shapes. */
export type InboundReply = { from: string; refs: string[] };

const EMAIL = /[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+/;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function address(value: unknown): string {
  if (typeof value === "string") return EMAIL.exec(value)?.[0]?.toLowerCase() ?? "";
  if (Array.isArray(value)) return address(value[0]);
  if (isObject(value)) return address(value["email"] ?? value["address"] ?? value["from"]);
  return "";
}

function ids(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(ids);
  if (typeof value !== "string") return [];
  return value
    .split(/[\s,]+/)
    .map((x) => x.replace(/^<|>$/g, "").trim())
    .filter((x) => x.length > 0 && x.length < 500);
}

export function parseInboundReply(body: unknown): InboundReply | null {
  if (!isObject(body)) return null;
  const root = isObject(body["data"]) ? body["data"] : body;
  const from = address(root["from"] ?? root["sender"] ?? root["envelope_from"]);
  const headers = isObject(root["headers"]) ? root["headers"] : {};
  const header = (name: string) => {
    for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === name) return v;
    return undefined;
  };
  const refs = [
    ...ids(root["in_reply_to"] ?? root["inReplyTo"] ?? header("in-reply-to")),
    ...ids(root["references"] ?? header("references")),
  ].slice(0, 50);
  if (!from && !refs.length) return null;
  return { from, refs };
}
