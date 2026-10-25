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
| `reference_mail` (Referenzmail) | `reference_mail` | Abgeschlossene Leads | `reference_mail` | – |
| `callback` (Rückruf) | `callback` | Abgeschlossene Leads | keine (intern) | Datum und Uhrzeit |
| `no_interest` (Kein Interesse) | `no_interest` | bleibt in Offene Leads | keine, kein Deal | – |
| `on_hold` (Zukunftsprojekt) | `on_hold` | bleibt in Offene Leads | `on_hold` | Notiz; optional Wiedervorlage (wird ein Rückruf) |
| `not_reached` (Nicht erreicht) | offen, +1 Versuch | bleibt in Offene Leads | keine, kein Deal | – |
| `contact_details` | unverändert | – | keine | – (in der Oberfläche nicht mehr angeboten, Funktion bleibt) |

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
