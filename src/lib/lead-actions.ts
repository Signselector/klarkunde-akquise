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
  /** Tooltip: when to use it and what it does. */
  help: { when: string; effect: string };
  /** Tailwind classes for the coloured button. */
  color: string;
  stageKey?: "low_q" | "high_q" | "waiting_3d";
  /** Needs the form step before it can be confirmed. */
  needs: {
    note?: "required" | "optional";
    logo?: boolean;
    /** Realismus Render: photo of the building. */
    photo?: boolean;
    /** Logo/Realismus Render: the appointment, which goes to the calendar and the CRM. */
    appointment?: boolean;
    schedule?: "required" | "optional";
    /** Zukunftsprojekt: month and year of the customer's interest. */
    month?: boolean;
    /** Kein Interesse: tick box "do not call again". */
    doNotCall?: boolean;
  };
  /** Shown as a bigger success moment. */
  celebration?: "normal" | "special";
};

/** All outcome buttons look the same: white, anthracite on hover. */
const ACTION_BUTTON = "bg-white text-foreground hover:bg-[#2b2f36] hover:text-white";

export const LEAD_ACTIONS: LeadAction[] = [
  {
    key: "low_q",
    help: { when: 'Kunde will einen 3D-Logo-Entwurf, Logo liegt vor.', effect: 'Bucht den Fulfilmenttermin und legt den Deal in Pipedrive an (Stage „Logo Render“).' },
    label: "Logo Render",
    hint: "Termin eintragen und Logo hochladen",
    color: ACTION_BUTTON,
    stageKey: "low_q",
    needs: { note: "required", logo: true, appointment: true },
    celebration: "normal",
  },
  {
    key: "high_q",
    help: { when: 'Kunde will eine fotorealistische Ansicht am Gebäude, Logo und Gebäudefoto liegen vor.', effect: 'Bucht den Fulfilmenttermin und legt den Deal in Pipedrive an (Stage „Realismus Render“).' },
    label: "Realismus Render",
    hint: "Termin, Logo und Gebäudefoto",
    color: ACTION_BUTTON,
    stageKey: "high_q",
    needs: { note: "required", logo: true, photo: true, appointment: true },
    celebration: "special",
  },
  {
    key: "waiting_3d",
    help: { when: 'Kunde hat Interesse, schickt das Logo aber erst nach.', effect: 'Legt den Deal in Pipedrive an (Stage „Logo ausstehend“), optional mit Rückruf.' },
    label: "Logo ausstehend",
    hint: "Kunde schickt das Logo noch, Rückruf optional",
    color: ACTION_BUTTON,
    stageKey: "waiting_3d",
    needs: { note: "required", schedule: "optional" },
  },
  {
    key: "no_interest",
    help: { when: 'Kunde hat keinen Bedarf.', effect: 'Schließt den Lead ab, optional mit Sperre „Nie wieder anrufen“.' },
    label: "Kein Interesse",
    hint: "Lead abschließen, optional nie wieder anrufen",
    color: ACTION_BUTTON,
    needs: { note: "optional", doNotCall: true },
  },
  {
    key: "on_hold",
    help: { when: 'Projekt ist erst in einigen Monaten geplant.', effect: 'Merkt den Monat vor. Ab dann kommt der Lead automatisch als Deal in Pipedrive.' },
    label: "Zukunftsprojekt",
    hint: "Monat wählen, dann kommt der Lead ins CRM",
    color: ACTION_BUTTON,
    needs: { note: "required", month: true },
  },
  {
    key: "callback",
    help: { when: 'Ansprechpartner bittet um Anruf zu einem bestimmten Zeitpunkt.', effect: 'Trägt den Rückruf in deinen Kalender ein, der Lead bleibt aktiv.' },
    label: "Rückruf",
    hint: "Neuen Anruf vereinbaren",
    color: ACTION_BUTTON,
    needs: { note: "optional", schedule: "required" },
  },
  {
    key: "reference_mail",
    help: { when: 'Kunde möchte vorab Referenzen und Produktionsbilder sehen.', effect: 'Sendet die Referenzmail an den Kontakt und schließt den Lead ab.' },
    label: "Referenzmail",
    hint: "Mail senden, Lead abschließen",
    color: ACTION_BUTTON,
    needs: {},
  },
  {
    key: "not_reached",
    help: { when: 'Niemand abgehoben, besetzt oder Mailbox.', effect: 'Speichert den Kontaktversuch, der Lead kann später erneut angerufen werden.' },
    label: "Nicht erreicht",
    hint: "Kontaktversuch speichern",
    color: ACTION_BUTTON,
    needs: {},
  },
];

export const ACTION_LABEL: Record<string, string> = {
  ...Object.fromEntries(LEAD_ACTIONS.map((a) => [a.key, a.label])),
  // No longer offered; old entries in a lead history keep their name.
  contact_details: "Kontaktdaten (früher)",
  future_interest_due: "Zukunftsprojekt fällig",
};

const ERRORS: Record<string, string> = {
  note_required: "Bitte eine Gesprächsnotiz eintragen.",
  appointment_required: "Bitte einen Termin in der Zukunft eintragen.",
  photo_required: "Bitte das Gebäudefoto hochladen.",
  invalid_month: "Bitte einen Monat in der Zukunft wählen.",
  logo_required: "Bitte das Firmenlogo hochladen.",
  invalid_schedule: "Bitte Datum und Uhrzeit in der Zukunft wählen.",
  callback_slot_taken:
    "Zu dieser Zeit ist bereits ein Rückruf eingetragen. Bitte wähle eine Minute später.",
  slot_full:
    "Dieser Zeitpunkt ist inzwischen ausgebucht (maximale Anzahl gleichzeitiger Termine erreicht). Bitte wähle eine andere Zeit.",
  appointment_too_soon:
    "Termine können frühestens in 3 Tagen gebucht werden.",
  slot_conflict:
    "Zu dieser Zeit hast du schon einen Termin oder Rückruf. Bitte wähle eine andere Zeit.",
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
