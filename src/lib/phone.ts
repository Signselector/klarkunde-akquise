const CC: Record<string, string> = { AT: "43", DE: "49", NL: "31" };

/** Normalises a phone number to E.164 using the lead's market; null when it is not dialable. */
export function toE164(raw: string | null | undefined, country?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s\-/().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) {
    const cc = CC[country ?? ""];
    if (!cc) return null;
    if (s.startsWith("0")) s = `+${cc}${s.replace(/^0+/, "")}`;
    else if (s.startsWith(cc)) s = `+${s}`;
    else s = `+${cc}${s}`;
  }
  // "+43 (0) 670" style: drop the national trunk zero after the country code.
  s = s.replace(/^\+(43|49|31)0/, "+$1");
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

export function telHref(raw: string | null | undefined, country?: string | null): string | null {
  const n = toE164(raw, country);
  return n ? `tel:${n}` : null;
}
