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
  | "callback"
  | "reference_mail"
  | "not_reached";

export type LeadAction = {
  key: LeadActionKey;
  label: string;
  hint: string;
  /** Tailwind classes for the coloured button. */
  color: string;
  stageKey?: "low_q" | "high_q" | "waiting_3d" | "on_hold" | "reference_mail";
  /** Needs the form step before it can be confirmed. */
  needs: { note?: "required" | "optional"; logo?: boolean; schedule?: "required" | "optional" };
  /** Shown as a bigger success moment. */
  celebration?: "normal" | "special";
};

export const LEAD_ACTIONS: LeadAction[] = [
  {
    key: "low_q",
    label: "Logo Render",
    hint: "Einfaches Logo-Rendering",
    color: "bg-[#eba03a] text-white hover:bg-[#d98f2c]",
    stageKey: "low_q",
    needs: { note: "required", logo: true },
    celebration: "normal",
  },
  {
    key: "high_q",
    label: "Realismus Render",
    hint: "Realistisches 3D-Rendering",
    color: "bg-[#4cb687] text-white hover:bg-[#3fa376]",
    stageKey: "high_q",
    needs: { note: "required", logo: true },
    celebration: "special",
  },
  {
    key: "waiting_3d",
    label: "Logo ausstehend",
    hint: "Kunde schickt das Logo noch",
    color: "bg-[#111827] text-white hover:bg-[#1f2937]",
    stageKey: "waiting_3d",
    needs: { note: "required" },
  },
  {
    key: "no_interest",
    label: "Kein Interesse",
    hint: "Lead abschließen",
    color: "bg-[#e0534f] text-white hover:bg-[#cc4440]",
    needs: {},
  },
  {
    key: "on_hold",
    label: "Zukunftsprojekt",
    hint: "Zukünftiges Projekt",
    color: "bg-[#a15be8] text-white hover:bg-[#8e49d6]",
    stageKey: "on_hold",
    needs: { note: "required", schedule: "optional" },
  },
  {
    key: "callback",
    label: "Rückruf",
    hint: "Neuen Anruf vereinbaren",
    color: "bg-[#e4b53a] text-white hover:bg-[#d1a32c]",
    needs: { note: "optional", schedule: "required" },
  },
  {
    key: "reference_mail",
    label: "Referenzmail",
    hint: "Mail senden, Lead abschließen",
    color: "bg-[#6366e8] text-white hover:bg-[#5255d6]",
    stageKey: "reference_mail",
    needs: {},
  },
  {
    key: "not_reached",
    label: "Nicht erreicht",
    hint: "Kontaktversuch speichern",
    color: "bg-[#ec7f36] text-white hover:bg-[#d96f28]",
    needs: {},
  },
];

export const ACTION_LABEL: Record<string, string> = {
  ...Object.fromEntries(LEAD_ACTIONS.map((a) => [a.key, a.label])),
  // No longer offered; old entries in a lead history keep their name.
  contact_details: "Kontaktdaten (früher)",
};

const ERRORS: Record<string, string> = {
  note_required: "Bitte eine Gesprächsnotiz eintragen.",
  logo_required: "Bitte das Firmenlogo hochladen.",
  invalid_schedule: "Bitte Datum und Uhrzeit in der Zukunft wählen.",
  callback_slot_taken:
    "Zu dieser Zeit ist bereits ein Rückruf eingetragen. Bitte wähle eine Minute später.",
  invalid_email: "Die E-Mail-Adresse ist ungültig.",
  email_not_sent:
    "Die E-Mail wurde nicht bestätigt versendet. Der Lead wird erst nach erfolgreichem Versand abgeschlossen.",
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
