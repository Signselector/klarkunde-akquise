# CRM-Abgleich, Caller-Zuordnung und Aktivitätsverlauf

Migration: `drizzle/migrations/0014_crm_history.sql` (muss **vor** dem neuen Code in Lovable/Supabase eingespielt werden, nach 0010–0013).
Tests: `node --test tests/backend/crm-history.test.mjs tests/backend/lead-actions.test.mjs`, `npx vitest run`.

## Zuordnung der Listen (gilt seit dieser Änderung)

| Aktion           | Liste                                                | Pipedrive-Stage                           | Meine Kunden                    |
| ---------------- | ---------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| Logo Render      | Abgeschlossen                                        | 3D Low Q (`low_q`)                        | ja                              |
| Realismus Render | Abgeschlossen                                        | 3D High Q (`high_q`)                      | ja                              |
| Logo ausstehend  | Abgeschlossen                                        | 3D Waiting (`waiting_3d`)                 | ja                              |
| Zukunftsprojekt  | Abgeschlossen                                        | `on_hold` (Zukünftiges Interesse)         | ja                              |
| Kein Interesse   | Abgeschlossen (intern „Kein Interesse“)              | kein Deal                                 | nein                            |
| Rückruf          | **bleibt in Offene Leads**, erscheint unter Rückrufe | kein Deal                                 | nein                            |
| Nicht erreicht   | bleibt in Offene Leads, Versuch gespeichert          | kein Deal                                 | nein                            |
| Referenzmail     | Abgeschlossen, nach bestätigter Mail                 | `reference_mail`                          | erst nach späterem Kunden-Stage |

Das ersetzt die frühere Anweisung, dass Kein Interesse und Zukunftsprojekt in Offene Leads bleiben.

## Drei Identitäten

- **Ursprünglicher Caller** (`lead_crm_links.origin_caller_id`): der erste Caller mit einer CRM-Aktion. Wird einmal gesetzt, ein
  Datenbank-Trigger verhindert jede Änderung (`origin_caller_immutable`). Dasselbe gilt für die Deal-ID (`deal_immutable`).
  Zusätzlich steht der Caller im Pipedrive-Feld, dessen Schlüssel unter Einstellungen → Stage Mapping hinterlegt ist.
- **Aktueller Deal-Besitzer**: liegt allein in Pipedrive und wird hier nie als Caller-Zuordnung verwendet.
- **Ausführender Benutzer** (`lead_activity.acting_user_*`): wer eine einzelne Handlung ausgelöst hat; bei Pipedrive-Ereignissen „Pipedrive“.

## Kunden-Zuordnung

`lead_crm_links.is_customer` wird `true`, sobald der Deal in `low_q`, `high_q`, `waiting_3d`, `on_hold` oder `future_interest` steht
(aus dem Tool oder durch Pipedrive) und bleibt es. „Meine Kunden“ zeigt Deals mit `is_customer` und `origin_caller_id = Caller`.
Beispiel Referenzmail: Deal entsteht, Lead ist abgeschlossen, **kein** Kunde → Fulfillment setzt 3D Low Q → Webhook (oder Abgleich) →
`crm_apply_stage` → Kunde beim ursprünglichen Caller, Eintrag „Kunde zugeordnet“ im Verlauf.

## Synchronisierung

- Tool → Pipedrive: `syncLeadAction` (wie bisher, jetzt mit Ursprungs-Caller im Deal-Feld, Verlaufs- und Stage-Eintrag). Pro Lead höchstens ein
  Deal (`lead_crm_links`, eindeutig je Land und Deal-ID). Zustände `pending → syncing → synced | failed` (`lead_crm_links.sync_state`; die Aktion
  selbst trägt `queued/syncing/synced/error/simulated`).
- Pipedrive → Tool: Webhook `POST /api/pipedrive-webhook?country=DE` (Basic-Auth). Verarbeitung idempotent über die Ereignis-ID
  (`lead_activity.external_id` ist eindeutig), späte alte Ereignisse werden verworfen (`stale`).
- Abgleich: `POST /api/pipedrive-reconcile` (gleiche Basic-Auth) liest alle verknüpften Deals und wendet Unterschiede an. „Meine Kunden“ führt
  den Abgleich für die eigenen Deals bei jedem Laden aus. Der Endpunkt muss von einem Scheduler aufgerufen werden (z. B. stündlich).
- Testmodus (`integration_config.test_mode`, standardmäßig an): kein Pipedrive-Aufruf, keine echte Mail.

## Stage-Prüfung (Pflicht vor dem echten Betrieb)

Einstellungen → Stage Mapping → „Stages prüfen“ liest Pipelines, Stages, Deal- und Personenfelder aus Pipedrive und prüft: ID vorhanden, eigene
Stage je Aktion, Name plausibel, ob „Zukünftiges Interesse“ eine Deal-Stage oder ein Lifecycle-Wert der Person ist, ob das Ursprungs-Caller-Feld
existiert. Bis die Prüfung ohne Fehler ist, sendet `syncLeadAction` nichts (`stages_not_validated`). Ergebnis: Tabelle `pipedrive_stage_validation`.
Es werden nie Stages oder Felder angelegt. **Offen:** In der Datenbank teilen sich `on_hold` und `future_interest` in DE die ID 30; ob das stimmt, zeigt nur die Prüfung.

## E-Mail

`sendLeadEmail` (Server) speichert jede Mail in `lead_emails` (Status `pending/sending/sent/simulated/failed`, `request_id` verhindert Doppelversand) und sendet über
einen Provider-Adapter (Resend, aktiv mit `RESEND_API_KEY` und `EMAIL_FROM`). Als `sent` gilt eine Mail nur mit Nachrichten-ID des Anbieters. Im Testmodus
`simulated`. Die Aktionen Die Referenzmail verlangt serverseitig eine eigene, bestätigte Mail (`email_not_sent`), sonst wird der Lead nicht
abgeschlossen; bei Fehler zeigt die Oberfläche „Erneut senden“. Vorlagen: Einstellungen → E-Mail.
Nicht gegen einen echten Anbieter getestet.

## Verlauf und Auswertung

- `lead_activity`: unveränderlich (Trigger), je Eintrag Lead, Deal, ursprünglicher Caller, ausführender Benutzer samt Name, Aktion, vorherige und neue Stage,
  Zeit, Quelle (`cold_caller`/`pipedrive`). Erfasst: Lead angelegt, erster Kontakt, jede Aktion (Anrufversuch, Rückruf, …), Logo, Mail, Deal angelegt, Stage-Wechsel,
  Kunde zugeordnet, Angebot, gewonnen/verloren. Anzeige: Kundenakte → „Aktivitätsverlauf“.
- `get_caller_performance(von, bis, tag|woche|monat, user)`: pro Zeitraum und ursprünglichem Caller bearbeitete Leads, qualifizierte Leads (jeder Lead einmal, Low Q und
  High Q zusammen), Deals, gewonnene Deals, Abschlussquote, qualifizierte Leads pro 100. Es gibt kein Belohnungssystem.
- `get_completed_overview`: Abgeschlossene Leads mit Firma, Kontakt, ursprünglichem Caller, Aktion, CRM-Stage, Deal-ID, Abschluss- und letzter Aktivitätszeit.

## Einzurichten

1. Migration 0014 einspielen (nach 0010–0013; 0012/0013 siehe Dashboard-Doku).
2. Secrets: `PIPEDRIVE_WEBHOOK_USER`, `PIPEDRIVE_WEBHOOK_PASSWORD`; für echte Mails `RESEND_API_KEY`, `EMAIL_FROM`.
3. In Pipedrive je Land ein Text-Deal-Feld „Ursprünglicher Caller“ anlegen, den Schlüssel in Einstellungen → Stage Mapping eintragen.
4. „Stages prüfen“ ausführen und Fehler beheben (IDs, doppelte Zuordnungen, Zukünftiges Interesse klären).
5. „Webhook registrieren“ und den Abgleich-Endpunkt per Scheduler aufrufen.
6. Erst dann den Testmodus ausschalten.

## Noch offen

- Nicht gegen echtes Pipedrive getestet: Webhook-Registrierung über den Connector-Gateway, Feld-Schlüssel, Abruf der Felder, v1/v2-Webhook-Formate (Parser deckt beide ab).
- Deal-Besitzer in Pipedrive entspricht dem API-Konto; eine Zuordnung Caller → Pipedrive-Benutzer gibt es nicht.
- Wer in Pipedrive einen Stage-Wechsel auslöst, ist nur als „Pipedrive“ bekannt (Webhook liefert keine Zuordnung zu Mitarbeitern des Tools).
- Rollen Recruit/Veteran/Manager existieren nicht; Fulfillment liest den Verlauf, schreibt ihn aber nicht.
- Gamification: nur die Datenbasis, keine Punkte, Coins oder Level.

> Die Aktion „Kontaktdaten“ wurde wieder entfernt (Migration 0018). Alte Verlaufseinträge bleiben als „Kontaktdaten (früher)“ lesbar.
