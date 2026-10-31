/** The Pipedrive task that a showroom result adds to the deal: subject "Termin Review", due now, optional priority. */
export const REVIEW_TASK_SUBJECT = "Termin Review";

const pad = (n: number) => String(n).padStart(2, "0");

export function buildReviewTask(a: {
  dealId: number;
  note: string;
  /** Pipedrive's id of the priority "High"; without it no priority is sent (Pipedrive's default behaviour). */
  priorityId?: number | null;
  now?: Date;
}) {
  const now = a.now ?? new Date();
  return {
    subject: REVIEW_TASK_SUBJECT,
    type: "task",
    deal_id: a.dealId,
    note: a.note,
    // Due right now. Pipedrive takes the time in UTC.
    due_date: now.toISOString().slice(0, 10),
    due_time: `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`,
    done: 0,
    ...(a.priorityId != null ? { priority: a.priorityId } : {}),
  };
}

type Field = { key?: unknown; name?: unknown; options?: unknown };
type Option = { id?: unknown; label?: unknown };

/** Finds the id of the option "High" in the answer of Pipedrive's /activityFields. */
export function highPriorityId(fields: unknown): number | null {
  if (!Array.isArray(fields)) return null;
  const field = (fields as Field[]).find(
    (f) =>
      f &&
      (f.key === "priority" ||
        (typeof f.name === "string" && /^(priority|priorität)$/i.test(f.name))),
  );
  if (!field || !Array.isArray(field.options)) return null;
  const high = (field.options as Option[]).find(
    (o) =>
      o && typeof o.label === "string" && /^(high|hoch|hohe|hohe priorität)$/i.test(o.label.trim()),
  );
  return high && Number.isInteger(high.id) ? (high.id as number) : null;
}
