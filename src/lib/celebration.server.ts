import { celebrationChannel, CELEBRATION_EVENT, type CelebrationType } from "@/lib/celebration";

const COUNTRIES = ["DE", "AT", "NL"];
const recent = new Map<string, number>();
const DEDUPE_MS = 10 * 60_000;

/**
 * Sends one anonymous celebration to everybody who is online in that country right now. Nothing is stored; a user who
 * is offline never gets it later. A failure is ignored: a celebration must never break the action that caused it.
 * `dedupeKey` keeps one real-world event (for example a deal that is won) from being announced twice.
 */
export async function broadcastCelebration(
  country: string,
  type: CelebrationType,
  dedupeKey?: string,
) {
  if (!COUNTRIES.includes(country)) return false;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return false;
  if (dedupeKey) {
    const now = Date.now();
    for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
    if (recent.has(dedupeKey)) return false;
    recent.set(dedupeKey, now);
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        messages: [
          {
            topic: celebrationChannel(country),
            event: CELEBRATION_EVENT,
            // Only the kind of event. No names, no company, no ids.
            payload: { type },
            private: true,
          },
        ],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
