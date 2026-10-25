# Gesprächsergebnis: Aktionen nach dem Telefonat

Migration: `drizzle/migrations/0010_lead_actions.sql`. Tests: `tests/backend/lead-actions.test.mjs`
(`node --test tests/backend/lead-actions.test.mjs`). Oberfläche: Kundenakte eines Leads, Bereich
„Gesprächsergebnis“ (`src/components/caller/lead-actions.tsx`, Aktionsliste in `src/lib/lead-actions.ts`).

## Server: `record_lead_action`

Eine Funktion schreibt jede Aktion atomar und idempotent (gleiche `p_request_id` = gleiches Ergebnis).
Sie prüft: Lead existiert und ist aktuell (`p_expected_version`), Land freigeschaltet, der Lead gehört zu einem
Batch des Aufrufers (oder wurde von ihm bearbeitet, oder Admin), kein fremder aktiver Claim, Pflichtangaben.

| Aktion | Lead-Status | CRM-Stage-Schlüssel | Pflicht |
| --- | --- | --- | --- |
| `low_q` (Logo Render) | In Bearbeitung | `low_q` | Notiz, Logo |
| `high_q` (Realismus Render) | In Bearbeitung | `high_q` | Notiz, Logo |
| `waiting_3d` (Logo ausstehend) | Logo ausstehend | `waiting_3d` (Logo ausstehend) | Notiz |
| `no_interest` | Kein Interesse | `no_interest` | – |
| `on_hold` (Zukunftsprojekt) | Zukunftsprojekt | `on_hold` (Zukunftsprojekt) | Notiz; optional Wiedervorlage (wird ein Rückruf) |
| `callback` | Rückruf vereinbart | – (interne Aktion) | Datum und Uhrzeit in der Zukunft |
| `not_reached` | offen, +1 Versuch („Nicht erreicht“) | – (interner Status) | – |
| `contact_details` | unverändert | – | – (ändert nur Daten, kein Versuch) |
| `reference_mail` | unverändert | – | – (nur vermerkt, keine Stage) |

- Notizen landen in `lead_notes` (mit Mitarbeiter und Zeitstempel), jede Aktion zusätzlich in `lead_actions`
  und `audit_events`. Statuswechsel stehen in `status_changes`. Ein neues Ergebnis erledigt frühere offene Rückrufe.
- Aktionen mit Stage-Schlüssel erhalten `crm_sync_state = 'queued'`. **Das heißt nur „vorgemerkt“.** Nichts wird
  durch diese Migration an Pipedrive gesendet, die Oberfläche zeigt es als „noch nicht übertragen“.
- Das Logo wird im privaten Storage-Bucket `lead-logos` unter `<user-id>/<lead-id>/…` abgelegt; die Funktion
  prüft, dass der Pfad dem Aufrufer und dem Lead gehört. Der Bucket wird von der Migration angelegt (nur wo es
  ein `storage`-Schema gibt).

## Was noch fehlt (bewusst nicht erfunden)

1. **CRM-Übertragung.** Der vorhandene Worker (`supabase/functions/_shared/integration-worker.ts`) kennt nur die
   Ergebnisse `appointment`/`production`. Er muss die `queued`-Zeilen aus `lead_actions` lesen, mit
   `pipedrive_stage_mapping` (Schlüssel `low_q`, `high_q`, `waiting_3d`, `on_hold`, `no_interest`) die Stage setzen,
   Notiz und Logo am Deal hinterlegen und `crm_sync_state` auf `synced`/`error`/`review` setzen. Ohne vorhandenen
   Deal gibt es nichts zu übertragen. Nie neue Stages anlegen.
2. **E-Mail-Versand.** Es gibt keine Versand-Integration. Die Referenzmail öffnet das E-Mail-Programm
   (`mailto:`) und wird als „vorbereitet“ vermerkt. Direkter Versand und Dokumentation im CRM brauchen eine
   Integration (z. B. einen Mail-Connector).
3. **Rollen Recruit / Veteran / Manager.** Es gibt nur `admin`, `caller`, `fulfilment`. Die Aktionen stehen
   Callern (= Recruit) und Admins offen. Stage-Bearbeitung für Veteranen und Fulfillment-Zuweisungen sind nicht
   gebaut; dafür müssen die Rollen erst serverseitig definiert werden.
4. **Coins/Punkte.** Es werden keine vergeben. Die Erfolgsanimation erscheint erst nach der bestätigten
   Server-Antwort; eine spätere Punktevergabe muss an `lead_actions.id` hängen, damit nichts doppelt zählt.
