import { EN_0 } from "./i18n-en-0";
import { EN_1 } from "./i18n-en-1";
import { EN_2 } from "./i18n-en-2";
import { EN_3 } from "./i18n-en-3";
import { EN_4 } from "./i18n-en-4";
import { EN_5 } from "./i18n-en-5";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Exact texts: German → English. Entries with `{}` are patterns for texts that contain values. */
const EXACT = new Map<string, string>();
const PATTERNS: { re: RegExp; to: string; literal: number }[] = [];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const dict of [EN_0, EN_1, EN_2, EN_3, EN_4, EN_5]) {
  for (const [de, en] of Object.entries(dict)) {
    const key = clean(de);
    if (key.includes("{}")) {
      const re = new RegExp("^" + key.split("{}").map(escape).join("(.+?)") + "$");
      PATTERNS.push({ re, to: en, literal: key.replace(/\{\}/g, "").length });
    } else EXACT.set(key, en);
  }
}
// Patterns with more fixed text are more specific and are tried first.
PATTERNS.sort((a, b) => b.literal - a.literal);

function fill(template: string, groups: string[]) {
  let i = 0;
  return template.replace(/\{(\d*)\}/g, (_m, n: string) => groups[n === "" ? i++ : Number(n)] ?? "");
}

/** English version of a German text, or the text itself when there is none. */
export function translateText(text: string): string {
  const key = clean(text);
  if (!key) return text;
  const hit = EXACT.get(key);
  if (hit !== undefined) return hit;
  for (const p of PATTERNS) {
    const m = p.re.exec(key);
    if (m) return fill(p.to, m.slice(1).map((g) => EXACT.get(g) ?? g));
  }
  return text;
}
