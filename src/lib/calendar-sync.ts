/**
 * Two-way sync between the callbacks/appointments of one user and that user's Pipedrive activities (the Pipedrive
 * calendar). Pure logic with injected dependencies. Nothing is created twice: an item keeps its Pipedrive activity id.
 */
export type CalItem = {
  kind: "callback" | "appointment";
  id: string;
  startsAt: string;
  subject: string;
  note: string | null;
  dealId: number | null;
  pdActivityId: number | null;
};
export type PdActivity = {
  id: number;
  subject: string | null;
  type: string | null;
  due_at: string;
  duration_min: number;
  done: boolean;
  deal_id: number | null;
  person_name: string | null;
  org_name: string | null;
  note: string | null;
};
export type QueueEntry = { id: string; activityId: number; action: "delete" | "done" };

export interface CalendarCrm {
  users(): Promise<{ id: number; email: string | null }[]>;
  createActivity(payload: Record<string, unknown>): Promise<number>;
  updateActivity(id: number, payload: Record<string, unknown>): Promise<void>;
  deleteActivity(id: number): Promise<void>;
  list(pdUserId: number, from: string, to: string): Promise<unknown[]>;
}
export type CalendarStore = {
  mappedUser(): Promise<number | null>;
  saveMapping(pdUserId: number): Promise<void>;
  pending(): Promise<CalItem[]>;
  markPushed(item: CalItem, activityId: number): Promise<void>;
  markFailed(item: CalItem, error: string): Promise<void>;
  queue(): Promise<QueueEntry[]>;
  dequeue(id: string): Promise<void>;
  apply(a: PdActivity): Promise<void>;
  prune(from: string, to: string, keep: number[]): Promise<void>;
};

export type CalendarResult = {
  state: "synced" | "no_pipedrive_user" | "error";
  pushed: number;
  pulled: number;
  error?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
/** Pipedrive stores activity times in UTC as date + HH:MM. */
export function toPipedriveTime(iso: string) {
  const d = new Date(iso);
  return {
    due_date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    due_time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}
export const durationFor = (kind: CalItem["kind"]) => (kind === "callback" ? 15 : 60);

export function activityPayload(item: CalItem, pdUserId: number) {
  const dur = durationFor(item.kind);
  return {
    subject: item.subject,
    type: item.kind === "callback" ? "call" : "meeting",
    ...toPipedriveTime(item.startsAt),
    duration: `${pad(Math.floor(dur / 60))}:${pad(dur % 60)}`,
    user_id: pdUserId,
    ...(item.dealId ? { deal_id: item.dealId } : {}),
    ...(item.note ? { note: item.note } : {}),
    done: 0,
  };
}

export const matchPipedriveUser = (
  email: string | null | undefined,
  users: { id: number; email: string | null }[],
) =>
  email ? (users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null) : null;

type Raw = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const minutes = (v: unknown) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 30;
};
export function parseActivity(raw: unknown): PdActivity | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Raw;
  const id = num(a["id"]);
  const date = typeof a["due_date"] === "string" ? a["due_date"] : null;
  if (!id || !date) return null;
  const time =
    typeof a["due_time"] === "string" && a["due_time"] ? a["due_time"].slice(0, 5) : "00:00";
  const due = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(due.getTime())) return null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    id,
    subject: text(a["subject"]),
    type: text(a["type"]),
    due_at: due.toISOString(),
    duration_min: minutes(a["duration"]),
    done: a["done"] === true || a["done"] === 1 || a["done"] === "1",
    deal_id: num(a["deal_id"]),
    person_name: text(a["person_name"]),
    org_name: text(a["org_name"]),
    note: text(a["note"]),
  };
}

export async function syncCalendar(args: {
  store: CalendarStore;
  crm: CalendarCrm;
  email: string | null;
  window: { from: string; to: string };
}): Promise<CalendarResult> {
  const { store, crm } = args;
  let pdUser = await store.mappedUser();
  if (!pdUser) {
    pdUser = matchPipedriveUser(args.email, await crm.users());
    if (!pdUser) return { state: "no_pipedrive_user", pushed: 0, pulled: 0 };
    await store.saveMapping(pdUser);
  }
  let pushed = 0;
  let firstError: string | undefined;
  // 1. what happened here since the last run
  for (const entry of await store.queue()) {
    try {
      if (entry.action === "delete") await crm.deleteActivity(entry.activityId);
      else await crm.updateActivity(entry.activityId, { done: 1 });
      await store.dequeue(entry.id);
    } catch (e) {
      firstError ??= e instanceof Error ? e.message : "unexpected_error";
    }
  }
  for (const item of await store.pending()) {
    try {
      const payload = activityPayload(item, pdUser);
      // An item that already has an activity is only moved, never created again.
      const id = item.pdActivityId ?? (await crm.createActivity(payload));
      if (item.pdActivityId) await crm.updateActivity(item.pdActivityId, payload);
      await store.markPushed(item, id);
      pushed++;
    } catch (e) {
      const error = e instanceof Error ? e.message : "unexpected_error";
      await store.markFailed(item, error);
      firstError ??= error;
    }
  }
  // 2. what changed in Pipedrive
  let pulled = 0;
  try {
    const keep: number[] = [];
    for (const raw of await crm.list(pdUser, args.window.from, args.window.to)) {
      const a = parseActivity(raw);
      if (!a) continue;
      keep.push(a.id);
      await store.apply(a);
      pulled++;
    }
    await store.prune(args.window.from, args.window.to, keep);
  } catch (e) {
    firstError ??= e instanceof Error ? e.message : "unexpected_error";
  }
  return firstError
    ? { state: "error", pushed, pulled, error: firstError }
    : { state: "synced", pushed, pulled };
}
