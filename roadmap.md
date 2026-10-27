# Cold Call Tool – Roadmap

- [x] Accounts: Ansicht, Rollen, Passwort, Deaktivieren, Löschen, Länder beim Master-Admin

## Phase 1
- [x] Auth (E-Mail/Passwort), Profile + Rollen (Admin/Caller, erster Nutzer = Admin)
- [x] Schema: Leads, Batches, Notizen, Status-Historie, Callbacks, Termine (RLS)
- [x] CSV-Import mit Spaltenzuordnung, Bestätigung, Fortschrittsbalken pro Batch
- [x] Anruf-Ablauf (nächster Lead, Script, Ergebnis-Buttons, Vorschlag)

## Danach
- [x] Excel-Import (.xlsx)
- [x] Leads-Liste, Suche/Filter, Detail, Löschen/Verschieben/Wieder öffnen, Alle offenen löschen
- [x] Callbacks-Liste (heute fällig hervorgehoben), fällige Callbacks im Anruf-Ablauf
- [x] Termine (Liste/Kalender, Nur meine, eigenen Termin eintragen)
- [x] Meine Kunden, Erledigte Leads
- [x] Angebote (Kunden, Produkte, Angebote, Vorlagen)
- [x] Statistiken mit Charts
- [x] Pipedrive-Backend mit Outbox, Retry und serverseitiger Verbindung (keine Tokens in der Datenbank)
- [ ] Lovable-/Pipedrive-Verbindungen konfigurieren und Live-Abnahme durchführen (siehe docs/LOVABLE-BACKEND-SETUP.md)
- [x] Einstellungen (Script bearbeiten) + Account-Verwaltung (Admin)

## Backend-Abschluss Person A
- [x] Reservierungen und atomare Anrufergebnisse mit Idempotenz
- [x] Staging-Import, Dublettenprüfung und Datenqualität
- [x] Atomare Angebote und Rollenverwaltung
- [x] Cloud-Worker, Lease-Bereinigung und Scheduler-Vorlage
- [x] Datenbank-/Parallelitätstests und CI
