# Person A: Backend-Bestandsaufnahme und Schnittstellenentwurf

Historische Bestandsaufnahme. Der aktuelle vollständige Plan steht in
[lovable-backend-plan.md](lovable-backend-plan.md). Laut neuer Nutzerentscheidung
wird eine neue Datenbank verwendet; dortige Verträge und Prioritäten haben Vorrang.

Stand: 24.10.2026. Arbeitsbranch: `codex/person-a-backend`, Basis `main`
(`8ac2a63500070bf78569677d24d28f1defae0b00`).

## Übergabe und Zusammenarbeit

`AGENTS.md`, README, Roadmap, Migrationen und die Anbindung im Code wurden
geprüft. `codex/coldcaller-rebuild` ist weder als lokaler Branch noch in den
Remote-Heads vorhanden. Ein früherer, nicht gepushter Arbeitsstand wurde nicht
übernommen. Verfügbare Remote-Branches: `main`, `phase-2-features`,
`claude/amazing-feynman-8whaho`, `claude/serene-pascal-d038gi`.
Der geprüfte Stand `claude/serene-pascal-d038gi` enthält keine zusätzlichen
Commits gegenüber `main`; vorhandene Frontend-Arbeit wurde nicht ersetzt.

Git-Lesezugriff funktioniert. GitHub GraphQL und REST werden mit 403 blockiert.
Die Pull-Refs 1 und 2 existieren; daraus lässt sich ihr offener/geschlossener
Status nicht ableiten. Offene PRs sind deshalb noch nicht abschließend geprüft.

Person A verantwortet Migrationen, RLS, Supabase-Typen, RPCs und Edge Functions.
Person B verantwortet Design und Oberflächen. Diese Bestandsaufnahme verändert
keine bestehenden Laufzeitschnittstellen. Der folgende Vertrag ist ein Entwurf,
keine implementierte oder ausgerollte API. Vor der Anbindung mit Person B
abstimmen; keine parallelen Änderungen an `call.tsx`.

## Befunde aus dem Code

- `call.tsx` schreibt Leadstatus, Historie, Notiz, Rückruf und Termin getrennt.
  Teilfehler hinterlassen widersprüchliche Daten; `attempts` wird aus einem
  möglicherweise veralteten Browserstand erhöht.
- Die Erledigung eines Rückrufs wird vorab gespeichert, ohne dessen Fehler
  auszuwerten. Die Auswahl fälliger Rückrufe filtert nicht nach Besitzer,
  während RLS die Änderung auf Besitzer oder Admin beschränkt.
- `accounts.tsx` ersetzt Rollen durch getrenntes Löschen und Einfügen.
  Fehler können einen Nutzer ohne Rolle hinterlassen. Ein Schutz des letzten
  Admins ist in den Migrationen nicht vorhanden.
- `handle_new_user()` bestimmt den ersten Admin mit `NOT EXISTS`, ohne
  Serialisierung konkurrierender Registrierungen.
- Caller teilen laut Schema bewusst Leads. RLS erlaubt breite Lead-Updates;
  Versuche und Bearbeiter sind dadurch direkt vom Client änderbar. Historie
  kann ebenfalls vom Client mit frei gewähltem Ergebnis angelegt werden.
- Angebot und Angebotspositionen werden getrennt angelegt. Validierung von
  Mengen, Preisen, Statuswerten und importierten Qualitätsdaten benötigt eine
  eigene fachliche Festlegung.
- Die Roadmap markiert Pipedrive über einen Connector als offen. Im geprüften
  Code existiert kein Sync-Worker, kein Retry und keine Edge Function dafür.
  Keine API-Token in `app_settings` oder Browsercode einführen.

## Vorgeschlagener Vertrag: `record_call_outcome`

Nur authentifizierte Caller/Admins. Identität ausschließlich über `auth.uid()`;
kein frei übergebbarer `user_id` und kein Service-Role-Schlüssel im Frontend.

Argumente:

| Name | Typ | Zweck |
| --- | --- | --- |
| `request_id` | UUID | Idempotenzschlüssel für Wiederholungen |
| `lead_id` | UUID | Bearbeiteter Lead |
| `expected_attempts` | Integer | Schutz gegen veraltete Bearbeitung |
| `outcome` | Enum | `not_reached`, `no_interest`, `callback`, `appointment`, `production` |
| `note` | String/null | Optionale Gesprächsnotiz |
| `scheduled_at` | Timestamptz/null | Für Callback/Termin erforderlich |
| `callback_id` | UUID/null | Explizit bearbeiteter Rückruf |

Rückgabe: `lead_id`, `status`, `attempts`, `status_change_id`, optional
`callback_id`, `appointment_id` und `sync_job_id`.

Eine Transaktion sperrt den Lead, validiert erwartete Versuche und Rechte,
erhöht Versuche serverseitig und schreibt sämtliche abhängigen Datensätze.
`not_reached` hält den Lead auf `open`, protokolliert aber das Ergebnis als
`not_reached`, damit vorhandene Statistiken kompatibel bleiben. Ein übergebener
Rückruf muss zum Lead gehören und dem Caller gehören oder durch einen Admin
bearbeitet werden. Eine identische Wiederholung liefert dasselbe Ergebnis;
derselbe Schlüssel mit abweichender Nutzlast wird zurückgewiesen.

Fehler: `unauthenticated`, `forbidden`, `lead_not_found`, `stale_lead`,
`invalid_outcome`, `invalid_schedule`, `callback_conflict`,
`idempotency_conflict`. Validierungs- und Berechtigungsfehler bewirken keine
Teiländerung. Pipedrive-Netzwerkfehler dürfen das Anrufergebnis nicht verwerfen;
ein späterer Sync benötigt eine transaktional angelegte Outbox und sichere
Connector-Anbindung. Retry darf keine doppelten externen Deals erzeugen.

## Prüfung und offene Voraussetzungen

Erfolgreich in dieser Instanz: Bun 1.3.14 mit Frozen-Lockfile, vier Tests in zwei
Dateien, Produktionsbuild, `tsc --noEmit`, Devserver und HTTP-Loginseite mit
E-Mail-/Passwortfeldern. Keine Anwendungsdateien oder Lockfiles durch Setup
verändert. Installations- und Startanweisungen sind im Umgebungsentwurf
gespeichert.

Supabase Auth-Settings waren wegen Proxy-403 nicht erreichbar. Der konkrete
Host wurde zur Netzwerkfreigabe im Entwurf ergänzt. Nach Anwendung der
Einstellungen erneut prüfen. Keine Migration gegen die gemeinsame Datenbank
ausgeführt; RLS und angemeldete Workflows sind nicht live validiert. Die vier
vorhandenen Tests ersetzen keine Rollen-, Transaktions- oder Integrationstests.

Der Nutzerauftrag endet unvollständig bei „01 – Technische Basis“. Weitere
Anforderungen und ein eventuell extern vorhandener Übergabestand stehen noch
aus. Vor Implementierung insbesondere Connector-Verfügbarkeit, gewünschte
Pipedrive-Felder und Rollenregeln festlegen. Geheimnisse ausschließlich über
die sicheren Umgebungseinstellungen bereitstellen.
