/**
 * Live celebrations: a purely ephemeral, country-wide, anonymous signal over a Supabase Realtime broadcast channel.
 * The payload is only the kind of event. Names, companies and customer data never go over the channel.
 */
export type CelebrationType = "low_q" | "high_q" | "won";

export const CELEBRATION_EVENT = "celebrate";
export const CELEBRATION_SHOW_MS = 3000;
/** Fade-out at the end of the 3 seconds. */
export const CELEBRATION_FADE_MS = 300;

export const celebrationChannel = (country: string) => `celebrations-${country}`;

export const CELEBRATION_TEXT: Record<CelebrationType, string> = {
  low_q: "🎨 Neuer Logo Render im Team generiert!",
  high_q: "✨ Neuer Realismus Render im Team generiert!",
  won: "🏆 Ein Deal wurde erfolgreich gewonnen!",
};

export const isCelebrationType = (v: unknown): v is CelebrationType =>
  v === "low_q" || v === "high_q" || v === "won";

/** The person who triggered a result already got their own celebration: their own broadcast is skipped. */
const OWN_WINDOW_MS = 8000;
const own = new Map<CelebrationType, number>();
export function markOwnCelebration(type: CelebrationType) {
  own.set(type, Date.now());
}
export function isOwnCelebration(type: CelebrationType, now = Date.now()) {
  const at = own.get(type);
  return at !== undefined && now - at < OWN_WINDOW_MS;
}
