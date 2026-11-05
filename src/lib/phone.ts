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

/* ---- Searching for phone numbers --------------------------------------------------------------------------- */

const SEARCH_CC = ["49", "43", "31"];
const PHONE_CHARS = /^[+\d\s\-/().]+$/;

/**
 * The significant digits of a phone number for searching: separators, the country code (+49, 0049, +43, 0043, +31,
 * 0031) and leading zeros are removed, so "+49 8161 6097754" and "08161/6097754" both give "81616097754".
 */
export function normalizePhoneDigits(raw: string): string {
  let s = (raw ?? "").trim().replace(/[\s\-/().]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  else return s.replace(/\D/g, "").replace(/^0+/, "");
  s = s.replace(/\D/g, "");
  for (const cc of SEARCH_CC) {
    if (s.startsWith(cc)) {
      s = s.slice(cc.length);
      break;
    }
  }
  return s.replace(/^0+/, "");
}

/** Whether a search text looks like a phone number (only digits and separators) with at least 3 digits. */
export function isPhoneQuery(query: string): boolean {
  const q = query.trim();
  return PHONE_CHARS.test(q) && q.replace(/\D/g, "").length >= 3;
}

/**
 * True when the search matches the phone number: the text itself is part of it (ignoring case), or the significant
 * digits of the search are contained in those of the number (or the other way round for long numbers). The digit
 * comparison only runs for searches that look like a phone number, so "Hauptstraße 12345" does not hit phones.
 */
export function phoneSearchMatches(
  query: string,
  candidatePhone: string | null | undefined,
): boolean {
  const q = (query ?? "").trim().toLocaleLowerCase();
  if (!q || !candidatePhone) return false;
  if (candidatePhone.toLocaleLowerCase().includes(q)) return true;
  if (!isPhoneQuery(q)) return false;
  const qd = normalizePhoneDigits(q);
  const cd = normalizePhoneDigits(candidatePhone);
  if (qd.length < 3 || !cd) return false;
  return cd.includes(qd) || (cd.length >= 6 && qd.includes(cd));
}

/** Search in a list: the text fields as before (case-insensitive), the phone number tolerant of how it is written. */
export function searchMatches(
  query: string,
  textFields: (string | null | undefined)[],
  phone: string | null | undefined,
): boolean {
  const q = (query ?? "").trim().toLocaleLowerCase();
  if (!q) return true;
  if (textFields.filter(Boolean).join(" ").toLocaleLowerCase().includes(q)) return true;
  return phoneSearchMatches(q, phone);
}

/**
 * `ilike` patterns for the database: the typed text, the digits without country code and with the national zero,
 * and (for six or more digits) the digits with anything between them, because numbers are stored with spaces,
 * slashes or dashes ("08161 6097754", "+49 8161/6097754"). Empty when the search is not a phone number.
 */
export function phoneDbPatterns(query: string): string[] {
  if (!isPhoneQuery(query)) return [];
  const core = normalizePhoneDigits(query);
  if (core.length < 3) return [];
  const out = new Set<string>([`%${core}%`, `%0${core}%`]);
  if (core.length >= 6) out.add(`%${core.split("").join("%")}%`);
  return [...out];
}
