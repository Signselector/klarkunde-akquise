# Person A – Merge-Status

**Vorbereitender Merge mit deaktivierter neuer Anbindung.** Dieser Branch enthält einen ersten implementierten
Backend-Teil, nicht den abgeschlossenen Gesamtplan.

## Umgesetzt

- Lovable Cloud bleibt das Backend; kein separates Supabase-Projekt erforderlich.
- Additive SQL-Migration `0002_atomic_call.sql`: atomare Anrufergebnisse,
  Idempotenz, Versionsprüfung anhand des Versuchszählers und Besitzerprüfung
  für Rückrufe. Bestehende Call-Seite verwendet die neue RPC.
- `0003_role_management.sql`: atomarer Rollenwechsel, Schutz des letzten Admins,
  kein direkter Rollen-Schreibzugriff für angemeldete Benutzer. Accounts-Seite
  verwendet die RPC. Neue Registrierungen erhalten immer Caller.
- Erstadmin muss anhand der tatsächlichen Auth-Benutzer-ID über die vertrauenswürdige
  Lovable-Cloud-Datenbankverwaltung provisioniert werden. Keine öffentliche
  Bootstrap-Funktion und kein automatisch privilegierter erster Signup.
- SQL-Tests gegen PGlite (PostgreSQL in WASM), einschließlich Rollback bei
  erzwungenem Fehler, Wiederholung, Konflikt und Rollenberechtigungen.

## Test ausführen

Node und die Projektabhängigkeiten werden vorausgesetzt. Testabhängigkeit separat
installieren, damit Anwendungsabhängigkeiten und Lockdatei unverändert bleiben:

```sh
npm install --prefix /workspace/.backend-test --cache /workspace/.npm-cache --no-package-lock @electric-sql/pglite@0.3.14
cd /workspace/klarkunde-akquise
node tests/backend/atomic-call.mjs /workspace/.backend-test/node_modules/@electric-sql/pglite/dist/index.js
npm test
./node_modules/.bin/tsc --noEmit
npm run build
```

Die lokale Auth-Testfunktion bildet auth.uid() nach. Das ersetzt weder den Test
gegen das tatsächliche Lovable-Backend noch einen Test paralleler DB-Verbindungen.

## Vor Merge erforderlich

1. Deploymentweg im tatsächlichen Lovable-Projekt prüfen. Das vorhandene
   Drizzle-Journal führt Phase 2 nicht auf. Die neuen SQL-Dateien sind bewusst
   noch nicht automatisch registriert: ein blind korrigiertes Journal könnte
   bereits manuell angewendete Tabellen und Policies erneut anlegen.
2. Neue Datenbank in der vorhandenen Lovable-Cloud-Anbindung initialisieren und
   Rollen/Erstadmin kontrolliert einrichten. Bestehendes Backend nicht zurücksetzen.
3. SQL-Migrationen vor der neuen Frontend-Anbindung anwenden. Ohne die RPCs können
   die geänderten Seiten keine Anrufergebnisse/Rollenwechsel speichern.
4. Noch offene Planpunkte umsetzen: Leadreservierung, vollständige Einschränkung
   direkter Lead-/Historienänderungen, Importvorschau/Dubletten, atomare Angebote,
   Qualitätsdaten, Pipedrive-Outbox/Worker, Zeitplanung, vollständige Abnahme.
5. Pipedrive-Connector und Zielpipeline im Lovable-Projekt verifizieren.
6. Integrationstests mit echten Testaccounts, Frontend-Abstimmung mit Person B,
   Prüfung offener PRs und anschließend abschließender Review.

In dieser Umgebung ist kein Lovable-Verwaltungsconnector verfügbar und keine
LOVABLE_DB_MIGRATION_URL injiziert. GitHub-API-Abfragen waren mit 403 blockiert.
Ein Git-Push oder Merge ersetzt weder Migration noch Cloud-Veröffentlichung.

## Sicherer vorbereitender Merge

Die neuen RPC-Aufrufe sind hinter `VITE_ATOMIC_BACKEND_ENABLED=true` geschützt.
Ohne diese Variable verwenden beide Seiten den bisherigen Ablauf. Erst nach
Deployment und Prüfung der Migrationen in Lovable aktivieren und neu bauen.
Das Flag bleibt bis dahin unset. Dieser Merge schließt den Gesamtplan nicht ab.
Vor Aktivierung alle oben genannten Migrations-/Abnahmeschritte ausführen.
