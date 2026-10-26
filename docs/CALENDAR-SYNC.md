# Kalender-Abgleich mit Pipedrive

Migration `drizzle/migrations/0019_calendar_sync.sql`. Tests: `node --test tests/backend/calendar-sync.test.mjs`, `npx vitest run src/test/calendar-sync.test.ts`.

**Regel: Jeder sieht nur seine eigenen Einträge.** Das gilt für Rückrufe, Termine und die gespiegelten Pipedrive-Aktivitäten, auch für Manager und Admins (Zeilen-Policies `user_id = auth.uid()`). Team-Zahlen laufen weiter über die Statistik-Funktionen.

## Was wie abgeglichen wird

| Richtung | Was |
| --- | --- |
| Tool → Pipedrive | Rückruf wird eine Aktivität „Anruf“ (15 Min), Termin eine Aktivität „Meeting“ (60 Min), beim Deal des Leads, dem Pipedrive-Benutzer des Callers zugewiesen. Ein Eintrag behält seine Aktivitäts-ID und wird nie doppelt angelegt. |
| Tool → Pipedrive | Erledigter Rückruf: Aktivität wird erledigt. Gelöschter Termin: Aktivität wird gelöscht (über die Warteschlange `pd_calendar_queue`, übersteht Ausfälle). |
| Pipedrive → Tool | Verschiebt oder erledigt jemand die Aktivität in Pipedrive, ändert sich der Rückruf oder Termin hier. Aktivitäten, die es nur in Pipedrive gibt, erscheinen im Kalender als „Aus Pipedrive“ (nur lesen). Gelöschte verschwinden wieder. |

Zeitfenster: 30 Tage zurück bis 180 Tage voraus. Zeiten liegen in Pipedrive in UTC.

## Wann es läuft

* Beim Öffnen von Termine und Rückrufe, danach alle 5 Minuten, sowie mit „Jetzt abgleichen“ und direkt nach einem neuen Rückruf oder Termin.
* Zusätzlich im geplanten Abgleich (`POST /api/pipedrive-reconcile`, Basic-Auth wie beim Webhook): alle Benutzer mit Pipedrive-Zuordnung. Dort kommen auch Änderungen an, ohne dass jemand die Seite öffnet.
* Im Testmodus passiert nichts (Statuszeile „Testmodus“); neue Einträge bleiben `pending` und gehen beim Umschalten hinaus.

## Zuordnung Benutzer → Pipedrive

Beim ersten Abgleich wird der Pipedrive-Benutzer mit **derselben E-Mail-Adresse** gesucht und in `pipedrive_user_map` gespeichert (je Land). Gibt es keinen, steht „Kein Pipedrive-Benutzer mit deiner E-Mail-Adresse gefunden“; es wird nichts gesendet.

## Offen

* Nicht gegen echtes Pipedrive getestet (Gateway-Pfade `/users`, `/activities`).
* Änderungen an der Uhrzeit eines Rückrufs im Tool selbst gibt es nicht (ein neuer Rückruf ersetzt den alten, der alte wird erledigt).
* Pipedrive-Webhooks für Aktivitäten sind nicht angeschlossen; Änderungen kommen über Seitenaufruf, 5-Minuten-Takt und den geplanten Abgleich.
* Frühere Rückrufe und Termine (vor der Migration) werden nicht nachträglich nach Pipedrive geschrieben.
