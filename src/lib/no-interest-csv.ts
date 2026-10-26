/** CSV of the "Kein Interesse" leads for download. Semicolon separated with a BOM so German Excel opens it correctly. */
export type NoInterestLead = {
  lead_id: string;
  company: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  extra: Record<string, unknown> | null;
  batch: string | null;
  caller: string | null;
  declined_at: string | null;
  note: string | null;
};

const pick = (extra: Record<string, unknown> | null, names: string[]) => {
  for (const [k, v] of Object.entries(extra ?? {}))
    if (names.includes(k.trim().toLowerCase()) && v !== null && v !== undefined && String(v).trim())
      return String(v).trim();
  return "";
};

/** Cells starting with = + - @ would run as formulas in Excel, so they get a leading apostrophe. */
const cell = (value: unknown) => {
  let t = value === null || value === undefined ? "" : String(value).replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(t) && !/^[+-]?\d[\d\s().-]*$/.test(t)) t = `'${t}`;
  return /[";]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export const NO_INTEREST_HEADER = [
  "Firma",
  "Ansprechpartner",
  "Telefon",
  "E-Mail",
  "Stadt",
  "Website",
  "Adresse",
  "Batch",
  "Caller",
  "Datum",
  "Notiz",
];

export function noInterestCsv(rows: NoInterestLead[]) {
  const lines = [
    NO_INTEREST_HEADER,
    ...rows.map((r) => [
      r.company,
      r.contact_name,
      r.phone,
      r.email,
      r.city,
      pick(r.extra, ["website", "webseite", "web", "url"]),
      pick(r.extra, ["adresse", "address", "anschrift"]),
      r.batch,
      r.caller,
      r.declined_at
        ? new Date(r.declined_at).toLocaleDateString("de-DE", { timeZone: "Europe/Vienna" })
        : "",
      r.note,
    ]),
  ];
  return "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
}
