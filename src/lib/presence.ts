/** A client counts as online while its last heartbeat (every 45 s) is younger than this. */
export const ONLINE_WINDOW_MS = 90_000;

export function presenceState(lastSeen: string | null | undefined, now = Date.now()) {
  if (!lastSeen) return { online: false, label: "Noch nie online" };
  const diff = Math.max(0, now - new Date(lastSeen).getTime());
  if (diff < ONLINE_WINDOW_MS) return { online: true, label: "Online" };
  const min = Math.floor(diff / 60_000);
  if (min < 60) return { online: false, label: `Zuletzt online vor ${min} Min.` };
  const h = Math.floor(min / 60);
  if (h < 24) return { online: false, label: `Zuletzt online vor ${h} Std.` };
  const d = Math.floor(h / 24);
  return { online: false, label: `Zuletzt online vor ${d} ${d === 1 ? "Tag" : "Tagen"}` };
}
