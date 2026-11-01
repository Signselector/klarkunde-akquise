/** Pipedrive calendar entries in the tool: meetings and calls can be edited the same way. */
export type PdKind = "meeting" | "call" | "other";

export const pdKind = (type: string | null | undefined): PdKind =>
  type === "meeting" ? "meeting" : type === "call" ? "call" : "other";

export const PD_KIND_LABEL: Record<PdKind, string> = {
  meeting: "Meeting",
  call: "Anruf",
  other: "Aktivität",
};

/** Meetings and calls can be edited by those who may edit the entry; tasks and other types are not shown for editing. */
export const canEditPdActivity = (type: string | null | undefined, mayEdit: boolean) =>
  mayEdit && (pdKind(type) === "meeting" || pdKind(type) === "call");

const pad = (n: number) => String(n).padStart(2, "0");

/** What Pipedrive gets when a meeting is changed: subject, start (date + time in UTC) and duration. */
export function buildMeetingUpdate(i: { subject: string; startsAt: string; durationMin: number }) {
  const subject = i.subject.trim();
  const t = Date.parse(i.startsAt);
  if (!subject || subject.length > 255) throw new Error("invalid_subject");
  if (Number.isNaN(t)) throw new Error("invalid_start");
  if (!Number.isInteger(i.durationMin) || i.durationMin < 5 || i.durationMin > 12 * 60) throw new Error("invalid_duration");
  const d = new Date(t);
  return {
    subject,
    due_date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    due_time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    duration: `${pad(Math.floor(i.durationMin / 60))}:${pad(i.durationMin % 60)}`,
  };
}
