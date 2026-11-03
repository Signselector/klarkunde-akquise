/** Pipedrive contact labels for phone/e-mail: Büro = work, Privat = home, Sonstige = other. */
export type ContactLabel = "work" | "home" | "other";
export const CONTACT_LABELS: { value: ContactLabel; text: string }[] = [
  { value: "work", text: "Büro" },
  { value: "home", text: "Privat" },
  { value: "other", text: "Sonstige" },
];

/** The stored label of a lead (kept in `extra`), "work" when unknown. */
export function contactLabel(extra: unknown, key: "phone_label" | "email_label"): ContactLabel {
  const v = extra && typeof extra === "object" ? (extra as Record<string, unknown>)[key] : null;
  return v === "home" || v === "other" ? v : "work";
}

export const contactLabelText = (l: ContactLabel) => CONTACT_LABELS.find((c) => c.value === l)!.text;
