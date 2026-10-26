export type LeadLike = {
  status: string;
  attempts: number;
  last_called_at: string | null;
};

export const STATUS_LABEL: Record<string, string> = {
  open: "Offen",
  not_reached: "Nicht erreicht",
  no_interest: "Kein Interesse",
  callback: "Rückruf vereinbart",
  in_progress: "In Bearbeitung",
  low_q: "Logo Render",
  high_q: "Realismus Render",
  reference_mail: "Referenzmail",
  on_hold: "Zukunftsprojekt",
  waiting_3d: "Logo ausstehend",
  contact_saved: "Kontaktdaten hinterlegt",
  appointment: "Termin",
  production: "Deal in Produktion",
};

/** Kurzer Vorschlag für den nächsten Schritt. */
export function suggestNextStep(
  lead: LeadLike,
  opts: { now?: Date; callbackDueAt?: string | null } = {},
): string {
  const now = opts.now ?? new Date();
  if (opts.callbackDueAt && new Date(opts.callbackDueAt) < now) {
    return "Callback überfällig – jetzt zurückrufen.";
  }
  switch (lead.status) {
    case "appointment":
      return "Termin vorbereiten: Bedarf und Ansprechpartner prüfen.";
    case "production":
      return "Deal läuft – Übergabe an Produktion sicherstellen.";
    case "no_interest":
      return "Kein weiterer Kontakt nötig.";
    case "callback":
      return "Rückruf zum vereinbarten Zeitpunkt einplanen.";
  }
  if (lead.attempts >= 3) {
    const hour = lead.last_called_at ? new Date(lead.last_called_at).getHours() : 10;
    const alt = hour < 12 ? "am Nachmittag" : "am Vormittag";
    return `${lead.attempts}x nicht erreicht: andere Uhrzeit probieren (${alt}).`;
  }
  if (lead.attempts > 0) return "Erneut versuchen – ggf. kurze Nachricht hinterlassen.";
  return "Erstkontakt: kurz vorstellen und Bedarf klären.";
}

export const DEFAULT_SCRIPT = `Guten Tag {{ansprechpartner}}, hier ist {{caller}}.

Ich rufe an, weil wir Unternehmen wie {{firma}} in {{stadt}} dabei helfen, ... 

Darf ich Ihnen kurz zwei Fragen stellen?
1. Wie lösen Sie das Thema aktuell?
2. Wer entscheidet bei Ihnen darüber?

Passt Ihnen ein kurzer Termin diese oder nächste Woche?`;

export function fillScript(tpl: string, v: Record<string, string | null | undefined>) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] || `[${k}]`);
}

/** Einfacher CSV-Parser (Komma oder Semikolon, Anführungszeichen). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/)[0] ?? "";
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
