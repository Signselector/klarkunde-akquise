/**
 * The conversation outcomes a caller can record for a lead. `stageKey` is the key in
 * `pipedrive_stage_mapping`; actions without one never touch the CRM.
 */
export type LeadActionKey =
  | "low_q"
  | "high_q"
  | "waiting_3d"
  | "no_interest"
  | "on_hold"
  | "contact_details"
  | "callback"
  | "reference_mail"
  | "not_reached";

export type LeadAction = {
  key: LeadActionKey;
  label: string;
  hint: string;
  /** Tailwind classes for the coloured button. */
  color: string;
  stageKey?: "low_q" | "high_q" | "waiting_3d" | "on_hold" | "no_interest";
  /** Needs the form step before it can be confirmed. */
  needs: { note?: "required" | "optional"; logo?: boolean; schedule?: "required" | "optional" };
  /** Shown as a bigger success moment. */
  celebration?: "normal" | "special";
};

export const LEAD_ACTIONS: LeadAction[] = [
  {
    key: "low_q",
    label: "3D-R-LowQ",
    hint: "Einfaches Logo-Rendering",
    color: "bg-orange-600 text-white hover:bg-orange-700",
    stageKey: "low_q",
    needs: { note: "required", logo: true },
    celebration: "normal",
  },
  {
    key: "high_q",
    label: "3D-R-HighQ",
    hint: "Realistisches 3D-Rendering",
    color: "bg-emerald-700 text-white hover:bg-emerald-800",
    stageKey: "high_q",
    needs: { note: "required", logo: true },
    celebration: "special",
  },
  {
    key: "waiting_3d",
    label: "3D-Waiting",
    hint: "Kunde schickt das Logo noch",
    color: "bg-neutral-900 text-white hover:bg-neutral-800",
    stageKey: "waiting_3d",
    needs: { note: "required" },
  },
  {
    key: "no_interest",
    label: "Kein Interesse",
    hint: "Lead abschließen",
    color: "bg-red-600 text-white hover:bg-red-700",
    stageKey: "no_interest",
    needs: {},
  },
  {
    key: "on_hold",
    label: "On Hold",
    hint: "Zukünftiges Projekt",
    color: "bg-violet-600 text-white hover:bg-violet-700",
    stageKey: "on_hold",
    needs: { note: "required", schedule: "optional" },
  },
  {
    key: "contact_details",
    label: "Kontaktdaten",
    hint: "Daten ergänzen, keine Stage",
    color: "bg-teal-700 text-white hover:bg-teal-800",
    needs: {},
  },
  {
    key: "callback",
    label: "Rückruf",
    hint: "Neuen Anruf vereinbaren",
    color: "bg-yellow-400 text-neutral-900 hover:bg-yellow-500",
    needs: { note: "optional", schedule: "required" },
  },
  {
    key: "reference_mail",
    label: "Referenzmail",
    hint: "Mail vorbereiten, keine Stage",
    color: "bg-blue-600 text-white hover:bg-blue-700",
    needs: {},
  },
  {
    key: "not_reached",
    label: "Nicht erreicht",
    hint: "Kontaktversuch speichern",
    color: "bg-orange-800 text-white hover:bg-orange-900",
    needs: {},
  },
];

export const ACTION_LABEL: Record<string, string> = Object.fromEntries(
  LEAD_ACTIONS.map((a) => [a.key, a.label]),
);

const ERRORS: Record<string, string> = {
  note_required: "Bitte eine Gesprächsnotiz eintragen.",
  logo_required: "Bitte das Firmenlogo hochladen.",
  invalid_schedule: "Bitte Datum und Uhrzeit in der Zukunft wählen.",
  invalid_email: "Die E-Mail-Adresse ist ungültig.",
  stale_lead:
    "Der Lead wurde inzwischen geändert. Die Ansicht wird aktualisiert, bitte erneut versuchen.",
  lead_claimed: "Der Lead wird gerade von jemand anderem bearbeitet.",
  not_your_lead: "Dieser Lead gehört nicht zu deinen Batches.",
  forbidden: "Dafür fehlt dir die Berechtigung.",
  lead_not_found: "Der Lead ist nicht mehr verfügbar.",
  note_too_long: "Die Notiz ist zu lang.",
};

export function actionErrorMessage(message: string) {
  if (message.includes("record_lead_action") || message.includes("schema cache"))
    return "Diese Funktion ist noch nicht freigeschaltet: Die Datenbank-Migration 0010 fehlt.";
  const code = Object.keys(ERRORS).find((k) => message.includes(k));
  return code ? ERRORS[code] : "Das hat nicht geklappt. Bitte versuche es erneut.";
}

/** Fill the template placeholders used in Settings → E-Mail. */
export function fillTemplate(
  text: string,
  values: {
    firma?: string | null;
    ansprechpartner?: string | null;
    stadt?: string | null;
    caller?: string | null;
  },
) {
  return text
    .replace(/{{\s*firma\s*}}/g, values.firma ?? "")
    .replace(/{{\s*ansprechpartner\s*}}/g, values.ansprechpartner ?? "")
    .replace(/{{\s*stadt\s*}}/g, values.stadt ?? "")
    .replace(/{{\s*caller\s*}}/g, values.caller ?? "");
}
