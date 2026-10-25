# Lead-Batches: ein Caller pro Batch

Migration: `drizzle/migrations/0009_batch_assignment.sql`. Tests: `tests/backend/batch-assignment.test.mjs`
(`node --test tests/backend/batch-assignment.test.mjs`; der Test überspringt nur den `pg_cron`-Zeitplan,
weil PGlite die Erweiterung nicht kennt).

## Verhalten

- Ein bestätigter Batch ist **frei** oder gehört **genau einem Caller**.
- `claim_batch(p_batch_id)`: übernimmt einen freien Batch atomar. Wiederholen durch denselben Caller ist
  harmlos. Ist der Batch vergeben: `batch_taken` (40001). Nicht bestätigt oder unbekannt:
  `batch_not_found`. Land nicht freigeschaltet: `forbidden`.
- `release_batch(p_batch_id)`: nur Admin. Macht den Batch wieder frei. Bereits bearbeitete Leads bleiben
  beim Bearbeiter, eine laufende Reservierung läuft nach höchstens 10 Minuten aus.
- `claim_next_lead(p_country)` vergibt offene Leads nur aus Batches des Anrufers. Eigene fällige
  Rückrufe bleiben unabhängig davon erreichbar.
- `get_batch_progress()` liefert zusätzlich `assigned_to`, `assigned_name`, `assigned_at` und `open`.
- Beide Aktionen stehen in `audit_events` (`claim_batch`, `release_batch`). Direkte Schreibzugriffe auf
  `lead_batches` bleiben gesperrt.
- Es gibt kein Limit, wie viele Batches ein Caller übernehmen darf.

## Einspielen

1. Migration `0009` auf der bestehenden Datenbank anwenden (nicht `bootstrap.sql` wiederholen).
2. Danach erscheinen im Dashboard unter „Lead Batches“ die Aktionen „Batch übernehmen“ und „Freigeben“,
   und „Offene Leads“ zeigt nur Leads der eigenen Batches.

Vor dem Einspielen läuft die Oberfläche unverändert weiter: Die Leads-Seite erkennt die fehlende Spalte
und zeigt dann alle Leads des Landes, das Dashboard blendet die Aktionen aus. Bereits übernommene
Leads sind dann noch nicht exklusiv.

`backend/bootstrap.sql` ist nicht neu erzeugt (war schon vorher nicht auf dem Stand der Migrationen).
