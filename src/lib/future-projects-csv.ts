import { cell, pick } from "@/lib/no-interest-csv";

/** One lead that was completed as "Zukunftsprojekt". `target_month` is `YYYY-MM`. */
export type FutureProjectLead = {
  lead_id: string;
  country?: string | null;
  company: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  extra: Record<string, unknown> | null;
  batch: string | null;
  caller: string | null;
  target_month: string | null;
  created_at: string | null;
  note: string | null;
};

export const FUTURE_HEADER = [
  "Land",
  "Zielmonat",
  "Firma",
  "Ansprechpartner",
  "Telefon",
  "E-Mail",
  "Stadt",
  "Website",
  "Adresse",
  "Batch",
  "Caller",
  "Erfasst am",
  "Notiz",
];

/** `2027-03` becomes `03/2027`; anything else is shown as it is. */
export function monthLabel(month: string | null) {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  return m ? `${m[2]}/${m[1]}` : (month ?? "");
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Vienna" }) : "";

/** CSV for download (semicolon separated, with BOM for German Excel). */
export function futureProjectsCsv(rows: FutureProjectLead[]) {
  const lines = [
    FUTURE_HEADER,
    ...rows.map((r) => [
      r.country,
      monthLabel(r.target_month),
      r.company,
      r.contact_name,
      r.phone,
      r.email,
      r.city,
      pick(r.extra, ["website", "webseite", "web", "url"]),
      pick(r.extra, ["adresse", "address", "anschrift"]),
      r.batch,
      r.caller,
      day(r.created_at),
      r.note,
    ]),
  ];
  return "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
}
