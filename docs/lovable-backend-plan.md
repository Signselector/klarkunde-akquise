# Plan A – Backend und Integrationen in Lovable

Status: Umsetzung begonnen; noch nicht vollständig und noch nicht mergebereit.

Aktuelle Entscheidung: ausschließlich die vorhandene Lovable-Cloud-Anbindung nutzen.
Die im Repository generierten Supabase-Clients sind technische Bestandteile dieser
Anbindung, keine Anforderung an ein zusätzliches externes Projekt.
Entscheidung des Nutzers: neue Datenbank, keine Altdatenmigration.
Dieser Plan ersetzt die bisherigen Annahmen zur Weiterverwendung der Datenbank.

## Zielarchitektur und Zuständigkeit

Lovable bleibt Entwicklungs- und Veröffentlichungsplattform, GitHub die gemeinsame
Codebasis. Die in Lovable Cloud vorhandene verwaltete Datenbank übernimmt
Auth, Datenhaltung und Rechte. Transaktionen laufen als PostgreSQL-RPCs; Pipedrive
und zeitgesteuerte Aufgaben laufen serverseitig über unterstützte Connectoren und
Supabase Edge Functions. Die tatsächliche Connector-Verfügbarkeit ist vor der
Integration zu prüfen. Keine zusätzliche dauerhaft betriebene Backend-Anwendung.

Person A: Migrationen, RLS, RPCs, Edge Functions, generierte Supabase-Typen,
Geschäftslogik, Integrationen, Qualitätsdaten und technische Tests.
Person B: Design, Seiten, Formulare, Lade-/Fehlerzustände und Anbindung der
vereinbarten Schnittstellen. A liefert Verträge vor der Frontend-Anbindung;
gemeinsam verwendete Dateien werden nur nach angekündigter Übergabe bearbeitet.

Annahme: ein Unternehmen mit gemeinsamem Leadpool, mehrere Caller und Admins.
Mandantenfähigkeit gehört nicht zum ersten Ausbau. Alle Zeiten werden als UTC
Timestamptz gespeichert und im Frontend in Europe/Vienna dargestellt.

## A1 – Neue Datenbank reproduzierbar aufsetzen

- Die vorhandene Lovable-Cloud-Datenbank und deren bereitgestellte Konfiguration verwenden.
  Kein separates Supabase-Projekt anlegen. Alte Datenbank nicht löschen oder zurücksetzen.
- Eine vollständige Baseline für die neue Datenbank erstellen. Vorhandene SQL-Dateien
  dienen als fachliche Vorlage, nicht als ungeprüfter Deploymentablauf.
- Genau einen Migrationsweg verwenden: zuerst den vom verbundenen Lovable-Projekt
  unterstützten Ablauf verifizieren. Die bisherige Drizzle-Historie ist unvollständig;
  keine zweite unabhängig angewendete Historie daneben aufbauen.
- Baseline in einer leeren Testdatenbank ausführen; nachfolgende Migrationen versionieren.
  Supabase-Typen aus dem resultierenden Schema generieren.
- Getrennte Test- und Produktionszugänge, sichere serverseitige Secrets und Auth-Redirects
  für die tatsächlichen Lovable-Domains konfigurieren. Keine Schlüssel in Dokumentation.
- Ersten Admin kontrolliert provisionieren. Weitere Accounts werden eingeladen;
  keine automatische Adminvergabe anhand der ersten öffentlichen Registrierung.

Abnahme: leere Datenbank lässt sich vollständig aufbauen, Admin und Caller können
sich anmelden, nicht angemeldete Requests erhalten keine Geschäftsdaten.

## A2 – Datenmodell und Rechte

| Bereich | Tabellen und Regeln |
| --- | --- |
| Accounts | profiles, user_roles; genau eine aktive Rolle pro Nutzer; letzter Admin geschützt |
| Import | lead_batches, import_rows; Fortschritt, Zeilenfehler, Quelle, bestätigter Import |
| Leads | leads; Status, Version, Versuche, Bearbeiter, Kontaktdaten, normalisierte Suchwerte |
| Bearbeitung | lead_claims; befristete Reservierung verhindert parallele Leadvergabe |
| Verlauf | lead_notes, call_events, status_changes; serverseitige Identität und unveränderliche Historie |
| Aufgaben | callbacks, appointments; Besitzer, Termin, Erledigung und Bezug zum Lead |
| Angebote | offer_customers, offer_products, offers, offer_items; eindeutige Nummern und Preis-Snapshots |
| Einstellungen | app_settings; nur nicht geheime Konfiguration, Admin-Schreibrecht |
| Integration | integration_jobs, integration_links; externe IDs, Versuche, nächster Lauf, Fehlerstatus |
| Qualität | quality_issues; Typ, Schwere, Lead-/Importbezug, Bearbeitungsstatus |
| Audit | audit_events; Rollenwechsel, Lösch-/Archivierungsaktionen, Integrationseingriffe |

Caller lesen den gemeinsamen Leadpool, bearbeiten reservierte Leads und ihre
Aufgaben. Admins verwalten Accounts, Produkte, Einstellungen und teamweite Aufgaben.
Löschen/Archivieren von Leads und Batches ist Admins vorbehalten. Historie, Rollen,
Versuchszähler, Besitzer und Sync-Zustände werden ausschließlich durch autorisierte
Backend-Operationen geändert. RLS schützt jede Geschäftstabelle; Views und RPCs
müssen dieselben Regeln beachten. SECURITY DEFINER nur mit expliziter Rechteprüfung,
festem search_path und eingeschränkten EXECUTE-Grants.

Abnahme: Rollenmatrix mit anon, Caller A, Caller B und Admin direkt gegen SQL/RPCs
testen, einschließlich manipuliertem user_id und nicht erlaubter Direktzugriffe.

## A3 – Verbindliche Backend-Schnittstellen für Person B

Folgende Verträge sind das Implementierungsziel. IDs sind UUIDs, Zeitpunkte ISO-8601.
Mutationsergebnisse verwenden serverseitige Identität. Idempotenzschlüssel sind
pro Nutzer und Operation eindeutig; andere Nutzlast mit gleichem Schlüssel ergibt
idempotency_conflict. Listen sind paginiert; Sortierung enthält einen stabilen ID-Tiebreaker.

| Operation | Argumente | Rückgabe | Berechtigung / spezielle Fehler |
| --- | --- | --- | --- |
| claim_next_lead | request_id | lead, claim_id, expires_at oder null | Caller/Admin; berücksichtigt eigene fällige Rückrufe, sonst offene Leads |
| record_call_outcome | request_id, lead_id, claim_id, expected_version, outcome, note?, scheduled_at?, callback_id? | lead, event_id, callback_id?, appointment_id?, sync_job_id? | Besitzer der Reservierung/Admin; stale_lead, claim_expired, invalid_schedule, callback_conflict |
| reopen_lead | request_id, lead_id, expected_version, reason | lead, event_id | Caller/Admin; stale_lead |
| complete_callback | request_id, callback_id, expected_version | callback | Besitzer/Admin; forbidden, stale_callback |
| create_appointment | request_id, lead_id?, starts_at, notes? | appointment | Caller für sich/Admin; invalid_schedule |
| preview_import | batch_name, mapping, rows, chunk_id | batch_id, counts, row_errors, duplicate_candidates | Caller/Admin; invalid_mapping, limit_exceeded |
| confirm_import | request_id, batch_id, duplicate_decisions | batch_id, inserted, rejected, pending | Importbesitzer/Admin; import_not_ready, invalid_duplicate_decision |
| set_user_role | request_id, user_id, role | user_id, role | Admin; last_admin, user_not_found |
| save_offer | request_id, offer_id?, expected_version?, customer_id, items, note? | offer_id, offer_number, totals, version | Ersteller/Admin; invalid_item, stale_offer |
| retry_integration | job_id | job_id, status | Admin; not_retryable, already_running |
| get_dashboard | from, to, scope | counts, rates, daily_series, quality_summary | eigene Werte für Caller, Teamwerte für Admin |

Gemeinsame Fehler: unauthenticated, forbidden, not_found, validation_failed,
idempotency_conflict. Datenbankfehler werden in stabile Anwendungscodes übersetzt;
keine SQL-Details oder Zugangsdaten im Frontend. Fehlerantworten enthalten einen
Korrelationsbezeichner. Person B zeigt Konflikte mit Aktualisierungsoption und
Validierungsfehler feldbezogen an.

Anrufergebnisse: not_reached, no_interest, callback, appointment, production.
not_reached lässt den Lead offen. Die RPC schreibt Ergebnis, Versuche, Notiz,
Statushistorie, Aufgabe und gegebenenfalls Sync-Auftrag in einer Transaktion.
Bei Fehlern erfolgt vollständiger Rollback. Reservierungen laufen nach einer
konfigurierten kurzen Frist ab; aktive Clients können sie kontrolliert verlängern.

Abnahme: gleichzeitige Caller bekommen keinen doppelt reservierten Lead; Wiederholung
erzeugt weder doppelte Termine noch erhöhte Versuchszähler; Teilfehler hinterlassen
keine halbfertigen Datensätze.

## A4 – Import, Qualitätsdaten, Angebote und Statistiken

CSV/Excel werden in begrenzten Chunks vorvalidiert, danach explizit bestätigt.
Normalisierung: Whitespace, E-Mail-Schreibweise und Telefonformat mit explizitem
Länderkontext; Originalwerte bleiben nachvollziehbar. Gleiche normalisierte
Telefonnummer oder E-Mail erzeugt einen Dublettenkandidaten, keine automatische
Zusammenführung. Ohne sichere Übereinstimmung nur Hinweis, kein Löschen.

Qualitätshinweise: fehlende Telefonnummer, ungültige E-Mail, mögliche Dublette,
überfälliger Rückruf und fehlende Pflichtdaten für Pipedrive. Hinweise sind aus
Daten reproduzierbar; Erledigungen und bewusste Ausnahmen bleiben nachvollziehbar.

Angebotsnummern werden serverseitig eindeutig vergeben. Preise und Beschreibung
werden beim Anlegen als Snapshot gespeichert; Produktänderungen ändern alte Angebote
nicht. Positionen und Angebot werden gemeinsam gespeichert. Beträge mit NUMERIC,
positive Mengen und nicht negative Preise; Summen serverseitig berechnen.

Statistiken basieren auf call_events statt überschreibbarem Leadstatus. Tagesgrenzen
verwenden Europe/Vienna einschließlich Sommerzeit. Zähler: Versuche, erreichte
Kontakte, Termine, Produktion; Quotennenner dokumentieren und Division durch null
als 0 darstellen. Batchfortschritt basiert auf bestätigten Importzeilen und Leadstatus.

## A5 – Pipedrive

1. Connector-Verfügbarkeit und serverseitige Nutzung in Lovable prüfen. Falls der
   Connector nicht genügt, eine serverseitige API-Anbindung planen; notwendige
   Zugangsdaten sicher hinterlegen, keine Tokens im Browser oder app_settings.
2. Organisation ← Firma, Kontakt ← Name/E-Mail/Telefon, Deal ← Lead und Status.
   Pipeline, Zielphasen, Eigentümer und eventuelle Pflichtfelder im Zielkonto lesen
   und als validierte Admin-Konfiguration speichern; keine erfundenen IDs.
3. Termin und Produktion erzeugen transaktional einen Auftrag. Je Lead bleibt eine
   stabile externe Zuordnung erhalten; Produktion aktualisiert denselben Deal.
4. Worker reserviert Aufträge atomar mit Ablaufzeit und verarbeitet begrenzte Batches.
   Rate-Limits/Retry-After beachten, exponentieller Backoff, maximal acht automatische
   Versuche; danach manueller Retry. 401/403 als Konfigurationsproblem behandeln.
5. Unklare Ergebnisse nach Timeout zuerst über gespeicherte Zuordnung bzw. eindeutigen
   externen Korrelationswert abgleichen. Keine Zusage von Exactly-once über HTTP;
   unauflösbare Fälle zur manuellen Prüfung markieren.
6. Frontend erhält pending/running/succeeded/failed/needs_review, letzten sicheren
   Fehlertext und Zeitpunkt. Retry führt ausschließlich die erlaubte Backend-Aktion aus.

Abnahme: Sandbox-/Testkonto prüft Erstellung, Aktualisierung, Timeout, Rate-Limit,
fehlende Berechtigung, konkurrierende Worker und wiederholte Jobs ohne doppelte Deals.

## A6 – Automationen und Betrieb

Zeitplanung über die im Projekt unterstützte Supabase-Scheduling-Funktion:
Sync-Aufträge regelmäßig verarbeiten, abgelaufene Reservierungen freigeben und
Qualitätshinweise aktualisieren. Scheduler-Aufrufe authentifizieren und Zugriffe
auf Worker-Funktionen einschränken. Jobläufe mit Dauer, Ergebnis und Korrelations-ID
protokollieren; personenbezogene Nutzlasten und Secrets nicht in Logs schreiben.

Rückrufe zunächst als Aufgaben in der App. Keine automatischen Kunden-E-Mails oder
SMS im ersten Umfang. Systemfehler und dauerhaft fehlgeschlagene Jobs sind für Admins
sichtbar. Datenlöschung und Aufbewahrungsfristen vor Produktivbetrieb festlegen;
Backup-/Wiederherstellungsweg passend zum gewählten Supabase-Tarif überprüfen.

## A7 – Tests und Veröffentlichung

Pflichtprüfungen je Lieferung: Unit-Tests, Typprüfung, Build sowie echte Datenbanktests
für Constraints, RLS, Transaktionen, Idempotenz und Konkurrenz. Migrationen sowohl
auf leerer Datenbank als auch als Upgrade des vorherigen neuen Schemas testen.
Integrationen mit deterministischen Fehlerszenarien und anschließend Testkonto prüfen.

Endabnahme in Lovable: Admin einrichten → Caller einladen → Import prüfen/bestätigen
→ Lead reservieren → Ergebnis speichern → Rückruf erledigen → Termin erzeugen
→ Pipedrive-Sync prüfen → Angebot speichern → Statistik abgleichen.
Unberechtigte Rollenaktionen müssen nachweisbar abgewiesen werden.

Freigabe erfolgt etappenweise: getestete Backend-Schnittstelle bereitstellen,
Person B anbinden lassen, gemeinsame Tests, PR in verbundenen Branch übernehmen,
Lovable veröffentlichen und Smoke-Test ausführen. Git-Sync allein führt keine
Datenbankmigration aus und bestätigt keine Veröffentlichung.

## Lieferreihenfolge und externe Voraussetzungen

A1 → A2 → A3 → A4 → A5 → A6 → A7. Person B kann nach den Verträgen aus A3 parallel
mit typisierten Beispieldaten arbeiten; Vertragsänderungen werden vorab dokumentiert.
Erste Lieferung: neue Baseline, Rollenregeln und Tests; zweite Lieferung: atomarer
Anrufablauf samt Reservierung und Übergabe an Person B.

Für tatsächliches Deployment benötigt: Zugriff auf das bestehende Lovable-Cloud-Backend,
wirksamer Zugriff darauf, sichere Deployment-Berechtigung und Testkonten. Für Pipedrive
zusätzlich Connector/API-Zugang und Zielpipeline. Diese Voraussetzungen blockieren
Deployment bzw. Integrationstests, nicht die lokale Implementierung.

Aktuell sind lokale Abhängigkeiten, vier vorhandene Tests, Build, Typprüfung und
Login-SSR verifiziert. Die bisherige Supabase-Adresse liefert aus der Cloud-Umgebung
Proxy-403; für die neue Datenbank muss die neue Zieladresse freigegeben werden.
Noch keine neue Datenbank angelegt, keine Backend-Funktion umgesetzt und keine
Änderung nach Lovable veröffentlicht. codex/coldcaller-rebuild bleibt nicht verfügbar.
