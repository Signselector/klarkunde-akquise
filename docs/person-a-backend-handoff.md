# Person A – implementierte Backend-Schnittstellen

Aktueller Code verwendet die vorhandene Lovable Cloud. Der frühere nicht
veröffentlichte Branch `codex/coldcaller-rebuild` wurde nicht übernommen.
Designkomponenten von Person B bleiben erhalten. Bestehende Seiten wurden
funktional angebunden; größere Designänderungen sind weiterhin Person B zugeordnet.

## Gemeinsamer Vertrag

Typen stehen in `src/integrations/supabase/types.ts`, reproduzierbar generiert
mit `npm run types:backend`. `src/lib/backend.ts` liefert den typisierten
RPC-Aufruf. Alle unten genannten Argumentnamen beginnen tatsächlich mit `p_`.
Optionale Argumente haben SQL-Defaults. Geschäftsfehler werden als PostgREST-
Fehler mit stabilem `message` ausgeliefert; kein Erfolg wird aus einem leeren
oder fehlgeschlagenen Resultat abgeleitet.

`request_id` ist eine clientseitige UUID je beabsichtigter Mutation. Bei einem
Netzwerkfehler dieselbe ID und dieselbe Nutzlast wiederverwenden. Nach bestätigtem
Erfolg für eine neue Aktion eine neue ID erzeugen. Abweichende Nutzlast mit
vorhandener ID ergibt `idempotency_conflict`. Frontend-Retries behalten die ID
im geöffneten Formular; eine Wiederaufnahme nach vollständigem Browserreload
benötigt einen separat persistent gespeicherten Entwurf samt Request-ID.

Die Identität kommt aus `auth.uid()`, nie aus einem frei übergebenen user_id.
Caller und Admin dürfen gemeinsame Leads lesen. Historie/Statistiken sehen
Caller für sich, Admins für das Team; Angebote sind Ersteller-/Admin-gebunden.

| RPC | Argumente ohne p_-Präfix | Rückgabe / Besonderheit |
| --- | --- | --- |
| get_capabilities | keine | user_id, role und Berechtigungsflags |
| claim_next_lead | keine | lead, claim_id, expires_at, callback_id oder null; eigene fällige Rückrufe zuerst |
| renew_lead_claim | claim_id, release? | claim_id, expires_at; zehn Minuten Lease |
| record_call_outcome | request_id, lead_id, expected_attempts, outcome, note?, scheduled_at?, callback_id? | lead_id, status, attempts, status_change_id, callback_id, appointment_id; aktive eigene Lease erforderlich |
| reopen_lead | request_id, lead_id, expected_version, reason | lead_id, version; schließt alte Rückrufe |
| update_lead_contact | lead_id, expected_version, contact | Lead; nur company/contact_name/phone/email/city erlaubt |
| move_lead | lead_id, expected_version, batch_id | void; bestätigter Zielbatch erforderlich |
| archive_leads | ids | Anzahl; Admin, höchstens 500 IDs |
| archive_open_leads | keine | Anzahl; Admin; archiviert offene Leads |
| complete_callback | request_id, callback_id, expected_version | Callback; Besitzer/Admin |
| create_appointment | request_id, starts_at, notes?, lead_id? | Termin; Besitzer wird serverseitig gesetzt |
| delete_appointment | appointment_id | void; Besitzer/Admin |
| preview_import | request_id, name, rows, batch_id? | batch_id, rows, invalid; max. 500 Zeilen/Chunk, 5.000/Batch |
| import_duplicates | batch_id | Zeilennummern mit Dublettenkandidaten |
| confirm_import | request_id, batch_id, skip_rows?, allow_duplicates? | batch_id, inserted, skipped; atomare Bestätigung |
| save_offer | request_id, customer_id (nullable), items, note?, offer_id?, expected_version? | offer_id, offer_number, total, version |
| set_offer_status | offer_id, expected_version, status | Angebot; erlaubte Zustandsübergänge geprüft |
| set_user_role | user_id, role | void; Admin, letzter Admin geschützt |
| get_dashboard | from, to, scope? | daily, attempts, reached, appointments, production, Ergebniszähler, appointment_rate, timezone |
| get_batch_progress | keine | bis 500 Batches mit total/completed/import_state |
| get_quality_issues | limit?, offset? | lead_id, company, kind, acknowledged_reason; paginiert |
| acknowledge_quality | lead_id, kind, reason | void; Hinweis bleibt mit dokumentierter Ausnahme sichtbar |
| retry_integration | job_id | Job; nur Admin, nur failed |
| resolve_integration_review | job_id, organization_id, person_id, deal_id, confirmed_absent? | void; Admin, tatsächlichen CRM-Abgleich vorausgesetzt |

`record_call_outcome` akzeptiert not_reached/no_interest/callback/appointment/production.
not_reached hält den Lead offen. Datum für Rückruf/Termin muss zukünftig sein.
`expected_attempts` schützt den Anrufzähler; Kontaktänderungen verwenden `version`.
Eine wiederholte erfolgreiche Call-Mutation benötigt keine neue Lease.

Importdaten werden nach Spaltenzuordnung als JSON-Objekte übergeben, mit optionalem
`extra` für Original-Zusatzfelder. E-Mail/Whitespace werden normalisiert. Telefon-
Dublettenvergleich entfernt Formatzeichen, errät aber keine Landesvorwahl.
Die Oberfläche überspringt erkannte ungültige Zeilen/Dubletten erst nach Bestätigung.
API-Clients können Dubletten ausdrücklich zulassen. Keine automatische Zusammenführung.

Fehler: unauthenticated/forbidden, request_id_required, idempotency_conflict,
claim_expired, stale_lead/offer, callback_conflict, lead_claimed, invalid_schedule,
invalid_import/rows/item/contact, duplicate_decision_required, invalid_transition,
last_admin, not_retryable, review_required. Constraints können zusätzlich SQLSTATE
23514 liefern. Bei Konflikten aktuellen Datensatz laden; bei Verbindungsfehlern
mit derselben Request-ID wiederholen. Keine ungeprüften Änderungen als Erfolg zeigen.

## Pipedrive und Worker

`integration_jobs` ist lesbar, aber nicht direkt beschreibbar. Zustände:
pending/running/succeeded/failed/needs_review. Für Person Bs `SyncIndicator`:
pending/running → queued, succeeded → synced, failed → error, needs_review → review.

Nur der Worker darf claim_integration_jobs, checkpoint_integration,
finish_integration_job und backend_maintenance ausführen. Die Endpunkte sind
für anon/authenticated gesperrt. Ein Auftrag erzeugt höchstens eine aktive Lease;
weitere Jobs desselben Leads warten auf den älteren Auftrag. Fehlertexte enthalten
keine Provider-Nutzlasten oder Secrets. Nach acht Versuchen ist manueller Retry nötig.

Der Portable-Worker in `supabase/functions/_shared` ist unabhängig von der
Auth-Verbindung testbar. Produktionsadapter: Pipedrive HTTP API v2, API-Token oder
extern erneuertes OAuth-Access-Token. Die tatsächliche Lovable-Verbindung ist ein
Deployment-Schritt, kein hier behaupteter vorhandener Connector.

## Aktivierung und Grenzen

`docs/LOVABLE-BACKEND-SETUP.md` beschreibt Datenbankpaket, sichere Bindings,
Worker, Scheduler, Erstadmin und Live-Abnahme. `VITE_ATOMIC_BACKEND_ENABLED=true`
erst mit dem vollständig bereitgestellten Backend aktivieren und neu bauen.

Das Rollenmodell ist Admin/Caller. Zusätzliche im Design-Entwurf erwähnte Rollen,
Rewards und frei konfigurierbare Produktionsstages sind nicht Teil des vereinbarten
Backend-Plans. Keine UI soll dafür Berechtigungen oder erfolgreiche Aktionen erfinden.
