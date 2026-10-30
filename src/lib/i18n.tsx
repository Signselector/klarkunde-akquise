import { useSyncExternalStore } from "react";

export type Lang = "de" | "en";
const KEY = "cc-lang";

let current: Lang = "de";
try {
  if (typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "en") current = "en";
} catch {
  /* storage can be blocked */
}
const listeners = new Set<() => void>();

export function setLang(next: Lang) {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
    () => "de" as Lang,
  );
}

/**
 * English texts, keyed by the German original. The German text stays in the code, so a missing entry simply shows
 * German. New screens are translated by adding their strings here and wrapping them with `t(...)`.
 */
export const EN: Record<string, string> = {
  // Navigation
  "Dein Arbeitsplatz": "Your workspace",
  Dashboard: "Dashboard",
  "Offene Leads": "Open leads",
  Rückrufe: "Callbacks",
  "Abgeschlossene Leads": "Completed leads",
  "Meine Kunden": "My customers",
  Termine: "Appointments",
  Statistik: "Statistics",
  "Admin-Bereich": "Admin area",
  "Kein Interesse": "No interest",
  Zukunftsprojekte: "Future projects",
  "Referenzmail offen": "Reference mail open",
  Upload: "Upload",
  Accounts: "Accounts",
  Aktivitätsprotokoll: "Activity log",
  Einstellungen: "Settings",
  // Shell
  Abmelden: "Sign out",
  "Zur Admin-Sicht": "Back to admin view",
  "Caller-Ansicht": "Caller view",
  "Profil wird geladen …": "Loading profile …",
  Sprache: "Language",
  "Mein Profil & Einstellungen": "My profile & settings",
  "Mein Profil und Einstellungen öffnen": "Open my profile and settings",
  "Hauptnavigation": "Main navigation",
  "Zum Arbeitsbereich": "Skip to workspace",
  "Ansicht beenden": "End view",
  "Account wartet auf Freischaltung": "Account waiting for activation",
  // Roles
  Caller: "Caller",
  "Senior Caller": "Senior caller",
  Manager: "Manager",
  Admin: "Admin",
  // Profile
  "Mein Profil": "My profile",
  Konto: "Account",
  "E-Mail": "Email",
  Rolle: "Role",
  Länder: "Countries",
  Profilbild: "Profile picture",
  "Bild hochladen": "Upload picture",
  Entfernen: "Remove",
  Anzeigename: "Display name",
  Speichern: "Save",
  "Passwort ändern": "Change password",
  // Appointments
  Terminkalender: "Appointment calendar",
  "Vorherige Woche": "Previous week",
  "Nächste Woche": "Next week",
  "Termine der Woche": "Appointments of the week",
  "Selbst wahrnehmen": "Take it myself",
  "Termin verschieben": "Move appointment",
  Verschieben: "Move",
  Abbrechen: "Cancel",
  // Common
  Schließen: "Close",
  Bestätigen: "Confirm",
  Erneut: "Again",
  "Erneut versuchen": "Try again",
  Heute: "Today",
};

export function useT() {
  const lang = useLang();
  return (text: string) => (lang === "en" ? (EN[text] ?? text) : text);
}
