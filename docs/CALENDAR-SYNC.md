# Kalender-Abgleich mit Pipedrive

Migration `drizzle/migrations/0019_calendar_sync.sql`. Tests: `node --test tests/backend/calendar-sync.test.mjs`, `npx vitest run src/test/calendar-sync.test.ts`.

**Stand ab Migration 0023:** Rückrufe und gespiegelte Pipedrive-Aktivitäten sieht nur der Besitzer. **Termine sieht vorerst jede Rolle für alle Länder, auf die sie Zugriff hat** (Policy `ap read`: `can_access_country(country)`), später wird das eingeschränkt. **Rückrufe werden nicht mehr nach Pipedrive geschrieben** und stehen nicht unter Termine.

## Was wie abgeglichen wird

| Richtung | Was |
| --- | --- |
| Tool → Pipedrive | Nur Termine: Aktivität „Meeting“ (30 Min), beim Deal des Leads, dem Pipedrive-Benutzer des Callers zugewiesen. Ein Eintrag behält seine Aktivitäts-ID und wird nie doppelt angelegt. |
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


## Buchungskalender (Migration 0022)

Überall, wo ein Termin oder Rückruf eingebucht wird (Logo/Realismus Render, Rückruf, Logo ausstehend, Anruf-Seite, Neuer Termin), steht ein kleiner Kalender statt eines Eingabefelds: Tag wählen, dann ein 30-Minuten-Slot (08:00–19:00).

* **Termine:** höchstens **2 gleichzeitig pro Land**. Gezählt werden die Termine aus dem Tool und alle offenen Meetings aus dem Pipedrive-Kalender der Firma. Ein vom Tool angelegtes Meeting steht in beiden Quellen und zählt einmal. Der Kalender zeigt nur Zahlen („1 von 2 belegt“, „ausgebucht“), nie wer oder was. Ausgebuchte Zeiten sind gesperrt. Die Prüfung läuft zusätzlich in der Datenbank (Trigger beim Einfügen, gegen gleichzeitiges Buchen gesperrt), Fehler `slot_full`.
* **Pipedrive-Belegung:** `pipedrive_busy` ist eine anonyme Kopie (nur Start und Ende) aller Meetings (`GET /activities?user_id=0&type=meeting`). Aktualisiert beim Öffnen des Kalenders (höchstens alle 3 Minuten) und im geplanten Abgleich. Im Testmodus wird nichts geholt, es zählen nur Tool-Termine. Ein Termin, den jemand direkt in Pipedrive anlegt, kann nicht verhindert werden und wird erst beim nächsten Abgleich sichtbar.
* **Rückrufe:** nur für den Caller sichtbar. Gesperrt sind Zeiten, zu denen er selbst schon einen Rückruf, Termin oder eine Pipedrive-Aktivität hat (Fehler `slot_conflict`). Rückrufe verbrauchen keine Termin-Plätze.
* **Termine-Seite:** zeigt alle Termine, die dem Benutzer gehören oder die er über das Tool gebucht hat (ein Recruit sieht damit, was er für den Manager gebucht hat), plus seine Pipedrive-Einträge. Andere sehen sie nicht.
* Antworten auf eine Referenzmail legen den Rückruf ohne Slot-Prüfung an, damit die Antwort immer ankommt.

## Regeln ab Migration 0023

* Rückruf: gesperrt, wenn der Caller zu der Zeit schon einen Rückruf hat oder schon 2 eigene Termine bzw. Pipedrive-Einträge. Rückrufe und Termine anderer Benutzer spielen keine Rolle.
* Bereits früher nach Pipedrive geschriebene Rückruf-Aktivitäten werden nicht gelöscht; neue entstehen nicht mehr.

## Rückruf-Raster (Migration 0027)

Rückrufe haben ein 15-Minuten-Raster (:00, :15, :30, :45) und belegen 15 Minuten. Termine bleiben im 30-Minuten-Raster. Ein Rückruf ist gesperrt, sobald der Caller im selben Fenster schon etwas hat: einen anderen Rückruf (15 Min), einen Termin (30 Min) oder eine offene Pipedrive-Aktivität (echte Dauer, mindestens 15 Min). Beispiel: Termin 15:30–16:00 sperrt die Rückruf-Slots 15:30 und 15:45, 15:15 und 16:00 bleiben frei. Diese Regel ersetzt die frühere aus 0023 (mit der Ausnahme „ein Termin allein blockiert nicht“).
