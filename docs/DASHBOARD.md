# Dashboard: Kennzahlen, Rangliste, Batches

Migration: `drizzle/migrations/0012_dashboard_metrics.sql`. Tests: `tests/backend/dashboard-metrics.test.mjs`,
`src/test/dashboard.test.ts`, `src/test/team-metrics.test.ts`. Alle Zahlen kommen vom Server, nichts wird im Browser
erfunden. Fehlt eine Quelle, steht „–“ und der Grund.

## Obere Karten

| Karte | Quelle |
| --- | --- |
| Leadqualität | `get_team_metrics()`: der zuletzt synchronisierte Wert aus dem Team-Management-Tool, unverändert. Ohne Sync: „Team Management noch nicht verbunden“. |
| Eingebrachte Leads | dieselbe Funktion, `leads_contributed`. Ein Sync ersetzt den Wert je Mitarbeiter und Monat, er wird nie addiert. |
| Durchschnitt | `get_monthly_quality()`, standardmäßig der letzte abgeschlossene Monat, dazu die Änderung zum Vormonat. Anzeige `Ø 18,85` mit „Leads / 100“, ohne Prozentzeichen. |
| Anrufe heute | `get_caller_day()`: jeder dokumentierte Anrufversuch des Tages (Wiener Zeit), egal welches Ergebnis. Aktualisiert sich alle 30 Sekunden. |

**Durchschnitt:** `(Logo Render + Realismus Render) / bearbeitete Leads × 100` je Mitarbeiter und Monat. Bearbeitet = Lead mit
mindestens einem dokumentierten Gesprächsergebnis im Monat, jeder Lead einmal (Wiedereröffnen zählt nicht). Qualifiziert =
Lead, der im Monat Logo Render oder Realismus Render erreicht hat, einmal gezählt nach seiner letzten Qualifizierung, damit
sich beide nie überschneiden. Bei 0 bearbeiteten Leads ist der Wert leer („–“). Ein abgeschlossener Monat wird beim ersten
Abruf oder durch den nächtlichen Job (`freeze_monthly_quality`, pg_cron 01:10 UTC, wenn verfügbar) in `monthly_quality`
gespeichert und danach nie neu berechnet.

Die beiden Aufgabentexte (28,3 % und 18,85 Leads / 100) beschreiben dieselbe Formel. Gezeigt wird die zweite Form.

## Tagesstatistik (7 Karten)

Erreicht und Gesamt Leads zählen jeden Lead einmal. Kein Interesse und Nicht erreicht zählen jedes dokumentierte Ergebnis.
Logo Render, Realismus Render und Logo ausstehend zählen die Leads, die heute diesen Status erreicht haben. Die Zahlen
müssen sich nicht addieren. Quelle ist das Statusprotokoll (`status_changes`), das auch die alten Ergebnisse enthält.

## Team Management anbinden

Das Tool selbst ist von hier aus nicht erreichbar. Vorbereitet ist die Schnittstelle:

- Edge Function `team-metrics` (`supabase/functions/team-metrics`), geschützt durch das Geheimnis
  `TEAM_MANAGEMENT_SYNC_SECRET` (Header `Authorization: Bearer …`).
- Aufruf: `POST` mit `{"rows":[{"email":"anna@firma.de","period":"2026-09","lead_quality":8.4,"leads_contributed":31}]}`
  (bis 5000 Zeilen, alles oder nichts). Zuordnung über die E-Mail-Adresse des Profils; unbekannte Adressen kommen in
  `unmatched` zurück. Antwort: `{"updated":n,"unmatched":[…]}`.
- Zu tun: Funktion deployen, Geheimnis setzen, das Team-Management-Tool (oder einen Job) die Zeilen senden lassen.

## Wochenrangliste und Punkte

Die Rangliste liest `points_ledger` (Wochen Montag bis Sonntag, Wiener Zeit). Solange nichts gebucht ist, zeigt sie
„Noch keine Punkte“. Es gibt keine eigene Punkteberechnung. Das spätere Punktesystem bucht Zeilen mit
`(source_type, source_id, reason)`; dieselbe Quelle kann dieselben Punkte nur einmal bekommen. Coins liegen getrennt in
`coins_ledger`. Eine abgelaufene Woche wird beim ersten Abruf in `weekly_ranking_snapshots` gespeichert und bleibt so.
Platz 1 bis 3 sind hervorgehoben, die eigene Platzierung steht darunter; mit den Pfeilen blättert man in frühere Wochen.

## Lead Batches

`get_batch_progress()` liefert je Batch Leads, bearbeitete und unbearbeitete Leads (je Lead einmal), Besitzer und
Importdatum. Archivierte Leads zählen nicht. Der Fortschritt ergibt sich aus den Leads und bleibt deshalb nach Freigabe
und erneuter Übernahme gleich. Übernehmen ist atomar (`claim_batch`). Freigeben darf der Besitzer oder ein Admin
(`release_batch`), Neu zuweisen nur ein Admin (`reassign_batch`).

## Rollen

Es gibt weiterhin nur `admin`, `caller` und `fulfilment`. Recruit und Veteran sind Caller, Manager und Admin sind Admins.
Rollen wurden nicht geändert. Callern zeigt das Dashboard nur eigene Zahlen, die Rangliste zeigt Namen und Punkte aller.
Teamstatistiken stehen weiter in der Admin-Ansicht („Statistiken“).

## Testmodus

Solange `integration_config.test_mode` an ist (Standard), sendet die Übertragung von Gesprächsergebnissen **nichts** an
Pipedrive: Die Aktion bekommt den Zustand `simulated`. Das Dashboard löst keine CRM-Aktionen aus.
