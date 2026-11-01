import { cell, pick } from "@/lib/no-interest-csv";

/** Leads that were tried for 20 days without success. The columns can be imported again as a new batch. */
export type UnreachedLead = {
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
  attempts: number;
  last_attempt_at: string | null;
};

export const UNREACHED_HEADER = [
  "Land",
  "Firma",
  "Ansprechpartner",
  "Telefon",
  "E-Mail",
  "Stadt",
  "Website",
  "Adresse",
  "Batch",
  "Caller",
  "Versuche",
  "Letzter Versuch",
];

export function unreachedCsv(rows: UnreachedLead[]) {
  const lines = [
    UNREACHED_HEADER,
    ...rows.map((r) => [
      r.country,
      r.company,
      r.contact_name,
      r.phone,
      r.email,
      r.city,
      pick(r.extra, ["website", "webseite", "web", "url"]),
      pick(r.extra, ["adresse", "address", "anschrift"]),
      r.batch,
      r.caller,
      r.attempts,
      r.last_attempt_at
        ? new Date(r.last_attempt_at).toLocaleDateString("de-DE", { timeZone: "Europe/Vienna" })
        : "",
    ]),
  ];
  return "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
}
