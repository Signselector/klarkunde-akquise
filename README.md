# KlarKunde Akquise

Baue ein "Cold Call Tool" (Lead-Management & Kaltakquise) komplett neu, auf Deutsch, mit modernem, klarem Design (hell/dunkel), mobil nutzbar. Login per E-Mail/Passwort (Supabase Auth), mehrere Caller-Accounts mit Rollen (Admin/Caller).

Funktionen (gleicher Umfang wie die bisherige App, aber sauberer):
1. Leads: CSV/Excel-Upload mit Spaltenzuordnung und Import-Bestätigung ("Lead Batches"), Liste offener Leads, Suche/Filter, Lead-Detailansicht mit Notizen, Lead löschen/verschieben/wieder öffnen, "Alle offenen Leads löschen".
2. Anruf-Ablauf: nächster offener Lead, Gesprächsleitfaden/Script mit Platzhaltern, Ergebnis-Buttons: Nicht erreicht, Kein Interesse, Callback (Datum/Uhrzeit), Termin buchen, Deal in Produktion. Statuswechsel werden protokolliert (StatusChange-Historie).
3. Callbacks: Liste fälliger Rückrufe, "heute fällig" hervorgehoben.
4. Termine: Termin buchen, eigenen Termin eintragen, Filter "Nur meine Termine", Kalender-/Listenansicht.
5. Meine Kunden und Erledigte Leads (Completed).
6. Angebote: Kunden, Produktkatalog (Produkte anlegen/bearbeiten), Angebot erstellen (Angebotsnummer, Positionen, Hinweis im Angebot), Angebotsliste, Angebotsdetail, Einstellungen/Vorlagen.
7. Statistiken: Tagesstatistik, Meine Statistiken, Auswertung (Leads pro Wochentag, Anrufe, Termine, Quoten) mit Charts.
8. Pipedrive-Sync: Leads/Deals bei Termin bzw. Produktion nach Pipedrive übertragen (API-Token in den Einstellungen), Fehler "Pipedrive Sync fehlgeschlagen" sichtbar mit Retry.
9. Einstellungen und Account-Verwaltung für Admins.

Neu: Bei jedem Lead und jeder Aufgabe zeigt die App einen kurzen, hilfreichen Vorschlag für den nächsten Schritt (z.B. "3x nicht erreicht: andere Uhrzeit probieren", "Callback überfällig") sowie einen Fortschrittsbalken pro Lead-Batch. Beginne mit Auth, Datenbank-Schema, Lead-Import und dem Anruf-Ablauf; die übrigen Bereiche danach Schritt für Schritt.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/71b68199-7e21-4ed2-ab38-bd9d4cd133fe).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Lovable-Cloud-Backend

Die vollständige Backend-Bereitstellung und Verbindung ist in
[LOVABLE-BACKEND-SETUP.md](docs/LOVABLE-BACKEND-SETUP.md) beschrieben.
Die vorhandene Lovable Cloud bleibt zuständig; kein zusätzliches Projekt anlegen.
Die neue Anbindung ist bis zur Bereitstellung über `VITE_ATOMIC_BACKEND_ENABLED`
ausgeschaltet. Die RPC-Verträge stehen in
[person-a-backend-handoff.md](docs/person-a-backend-handoff.md).

```sh
npm test
npm run test:backend
npm run types:backend:check
npm run typecheck
npm run typecheck:worker
npm run build
```

`npm run test:backend` führt PostgreSQL-WASM-Tests ohne Cloudzugang aus.
Für echte Parallelitätstests eine **leere lokale Testdatenbank** starten und
`BACKEND_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npm run test:backend:concurrency`
ausführen. Der Test lehnt nicht lokale Hosts und vorhandene Geschäftstabellen ab.
Die GitHub-Workflowdatei `backend.yml` enthält dieselben Prüfungen mit PostgreSQL 16.
