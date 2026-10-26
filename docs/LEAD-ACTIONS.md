> **Stand Migration 0020** – die Tabelle unten ist durch diese Fassung ersetzt:
>
> | Aktion | Eingaben | Folge |
> | --- | --- | --- |
> | Logo Render | Notiz, Logo, **Termin** | Termin im Terminkalender (Recruit: beim Manager des Landes, Veteran/Manager/Admin: bei sich) und als Aktivität im Pipedrive-Kalender. Lead → Abgeschlossen, Deal in 3D Low Q, Meine Kunden. |
> | Realismus Render | Notiz, Logo, **Gebäudefoto**, Termin | Wie oben, Stage 3D High Q. Das Foto geht als `GEBAEUDEFOTO.<endung>` ans Deal, das Logo als `KONFI_LOGO.<endung>`. |
> | Rückruf | Datum, Uhrzeit | Nur im Rückruf-Kalender (und Pipedrive-Kalender). Lead bleibt in Offene Leads, kein Deal. |
> | Logo ausstehend | Notiz, Rückruf optional | Lead → Abgeschlossen, Deal in 3D Waiting, Meine Kunden. |
> | Kein Interesse | Notiz optional, Haken „Nicht wieder anrufen“ | Mit Haken: Lead wird **gelöscht** (Personendaten, Notizen, Mails, Rückrufe gelöscht; die leere Hülle bleibt, damit Statistiken ihre Zahlen behalten). Ohne Haken: Lead → Abgeschlossen und in der Admin-Liste „Kein Interesse“ (Menü, CSV-Download). Kein Deal. |
> | Zukunftsprojekt | Notiz, **Monat und Jahr** | Lead → Abgeschlossen, zunächst kein Deal. Beginnt der Monat, legt `activate_future_projects()` (im geplanten Abgleich `/api/pipedrive-reconcile`) eine Aktion für den ursprünglichen Caller an und der Deal entsteht in „Zukünftiges Interesse“ (Meine Kunden). |
> | Nicht erreicht | – | Lead bleibt in Offene Leads, der Caller kann beliebig oft erneut anrufen. |
> | Referenzmail | bestätigte Mail | Wie bisher (siehe `docs/CRM-HISTORY.md`). |
>
> Die Termin-Zuordnung (`appointments.booked_by` = Caller) und die Löschung stehen in `record_lead_action` (0020). Tests: `tests/backend/action-workflows.test.mjs`.

> Stand 0014: Zuordnung der Listen, E-Mail-Pflicht, Ursprungs-Caller und Verlauf stehen in `docs/CRM-HISTORY.md`.

# Gesprächsergebnis: Aktionen nach dem Telefonat

Migration: `drizzle/migrations/0010_lead_actions.sql`. Tests: `tests/backend/lead-actions.test.mjs`
(`node --test tests/backend/lead-actions.test.mjs`); Migrationen `0010_lead_actions.sql` und `0011_actions_crm_sync.sql` (in dieser Reihenfolge). Oberfläche: Kundenakte eines Leads, Bereich
„Gesprächsergebnis“ (`src/components/caller/lead-actions.tsx`, Aktionsliste in `src/lib/lead-actions.ts`).

## Server: `record_lead_action`

Eine Funktion schreibt jede Aktion atomar und idempotent (gleiche `p_request_id` = gleiches Ergebnis).
Sie prüft: Lead existiert und ist aktuell (`p_expected_version`), Land freigeschaltet, der Lead gehört zu einem
Batch des Aufrufers (oder wurde von ihm bearbeitet, oder Admin), kein fremder aktiver Claim, Pflichtangaben.

| Aktion | Lead-Status | Liste | Pipedrive-Stage (Schlüssel) | Pflicht |
| --- | --- | --- | --- | --- |
| `low_q` (Logo Render) | `low_q` | Abgeschlossene Leads | `low_q` | Notiz, Logo |
| `high_q` (Realismus Render) | `high_q` | Abgeschlossene Leads | `high_q` | Notiz, Logo |
| `waiting_3d` (Logo ausstehend) | `waiting_3d` | Abgeschlossene Leads | `waiting_3d` | Notiz |
| `reference_mail` (Referenzmail) | `reference_mail` | Abgeschlossene Leads | `reference_mail` | bestätigte Mail |
| `callback` (Rückruf) | `callback` | bleibt in Offene Leads (siehe Rückrufe) | keine (intern) | Datum und Uhrzeit |
| `no_interest` (Kein Interesse) | `no_interest` | Abgeschlossene Leads | keine, kein Deal | – |
| `on_hold` (Zukunftsprojekt) | `on_hold` | Abgeschlossene Leads | `on_hold` | Notiz; optional Wiedervorlage (wird ein Rückruf) |
| `not_reached` (Nicht erreicht) | offen, +1 Versuch | bleibt in Offene Leads | keine, kein Deal | – |

- **Rückrufe:** Ein Caller kann pro Minute nur einen offenen Rückruf haben (Datenbank-Trigger auf `callbacks`,
  gilt für jede Funktion; Fehler `callback_slot_taken`). Die Oberfläche warnt vorher.

- Notizen landen in `lead_notes` (mit Mitarbeiter und Zeitstempel), jede Aktion zusätzlich in `lead_actions`
  und `audit_events`. Statuswechsel stehen in `status_changes`. Ein neues Ergebnis erledigt frühere offene Rückrufe.
- Aktionen mit Stage-Schlüssel stehen zuerst auf `crm_sync_state = 'queued'`. Direkt danach überträgt die
  Server-Funktion `syncLeadAction` (`src/lib/crm-sync.functions.ts`, Logik in `src/lib/crm-sync.ts`) sie nach Pipedrive:
  Organisation, Person, **Deal in der Stage aus `pipedrive_stage_mapping` des Landes**, die Gesprächsnotiz (mit
  Mitarbeiter und Zeit) und bei den Render-Aktionen das Logo als **`KONFI_LOGO.<endung>`** am Deal. Es gibt pro Lead
  höchstens einen Deal (`lead_crm_links`); weitere Aktionen verschieben ihn nur. Zustände: `queued` → `syncing` →
  `synced` oder `error` (mit `crm_error`, sichtbar im Verlauf, „Erneut übertragen“). Teilschritte (Notiz, Logo)
  werden gemerkt und bei einem Wiederholen nicht doppelt gesendet.
- Das Logo wird im privaten Storage-Bucket `lead-logos` unter `<user-id>/<lead-id>/…` abgelegt; die Funktion
  prüft, dass der Pfad dem Aufrufer und dem Lead gehört. Der Bucket wird von der Migration angelegt (nur wo es
  ein `storage`-Schema gibt).

## Voraussetzungen und was noch fehlt

1. **Pipedrive-Verbindung.** Die Übertragung nutzt dieselbe Verbindung wie „Stages laden“ (Lovable-Connector,
   `LOVABLE_API_KEY` plus `PIPEDRIVE_API_KEY` für DE und `PIPEDRIVE_API_KEY_1` für AT; für NL gibt es keine).
   Die Stage-IDs müssen unter Einstellungen → Stage Mapping für `low_q`, `high_q`, `waiting_3d`, `on_hold` und
   `reference_mail` eingetragen sein, sonst meldet die Oberfläche „keine Stage zugeordnet“. Es werden nie Stages
   angelegt. Die Aufrufe gehen an die Pfade `/organizations`, `/persons`, `/deals`, `/notes` und `/files` des
   Connector-Gateways; das ist **nicht gegen echtes Pipedrive getestet** (nur mit einem Testdouble). Beim ersten
   echten Lauf prüfen, ob Deal, Notiz und die Datei `KONFI_LOGO.*` ankommen.
2. **Deal-Besitzer.** Der Deal gehört dem Konto der API-Verbindung. Eine Zuordnung des Callers zu einem
   Pipedrive-Benutzer gibt es nicht.
3. **E-Mail-Versand.** Es gibt keine Versand-Integration. Die Referenzmail öffnet das E-Mail-Programm
   (`mailto:`); ein Versand aus dem Tool und der Beleg im CRM brauchen einen Mail-Connector.
4. **Rollen Recruit / Veteran / Manager** existieren nicht (nur `admin`, `caller`, `fulfilment`). Die Aktionen stehen
   Callern und Admins offen; Stage-Bearbeitung für Veteranen und Fulfillment-Zuweisungen sind nicht gebaut.
5. **Coins/Punkte.** Es werden keine vergeben. Eine spätere Vergabe sollte an `lead_actions.id` hängen.

## Meine Kunden (Pipedrive-Stages)

`src/components/caller/customers-pipeline.tsx` zeigt die Deals des Callers in der **aktuellen Pipedrive-Stage**.
Die Server-Funktion `loadMyCustomers` (`src/lib/customers.functions.ts`) liest nur: Sie nimmt die Leads, für die der
Caller eine Aktion mit Stage gespeichert hat (`lead_actions` + `lead_crm_links`), und fragt den aktuellen Stand der
Deals bei Pipedrive ab (gebündelt per `ids`, sonst einzeln). Änderungen in Pipedrive erscheinen nach „Aktualisieren“.
Ist Pipedrive nicht erreichbar, steht ein Hinweis „Nicht mit Pipedrive synchronisiert“ und es wird die zuletzt hier
gespeicherte Stage gezeigt.

Die Spalten stehen in `src/lib/customer-stages.ts`; ihre Stage-IDs kommen aus dem Stage Mapping des Landes
(Einstellungen → Stage Mapping, neue Gruppe „Weitere Spalten für Meine Kunden“). Fehlt eine ID, sagt die Spalte
„Stage nicht zugeordnet“. Deals in Stages ohne Spalte stehen in „Weitere Stages“. „Gewonnen“ fasst
`won_other_percent`, `won_production_planning` und `won_zero_percent` zusammen.

Nicht getestet gegen echtes Pipedrive: die Gateway-Pfade `/deals?ids=…`, `/deals/{id}` und `/stages`.
