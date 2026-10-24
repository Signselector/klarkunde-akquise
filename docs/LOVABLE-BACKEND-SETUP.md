# Lovable Cloud: Backend verbinden und aktivieren

Der Backend-Code ist für das vorhandene Lovable-Cloud-Projekt vorbereitet.
Es wird kein separates Supabase-Projekt benötigt. Namen wie `SUPABASE_URL`
und `supabase/functions` gehören zur bestehenden technischen Cloud-Anbindung.

## 1. Code übernehmen und Datenbank bereitstellen

Den Backend-Branch über GitHub in den mit Lovable verbundenen Branch übernehmen.
Währenddessen `VITE_ATOMIC_BACKEND_ENABLED` noch nicht auf `true` setzen.

Für die vereinbarte neue, leere Geschäftsdatenbank enthält
`backend/bootstrap.sql` alle sieben Migrationen in einer Transaktion samt
Prüfsummen-Historie. Das verwaltete Auth-Schema wird vorausgesetzt und bleibt
bestehen. Das Paket bricht bei bereits vorhandener `public.profiles` ab;
es löscht oder ersetzt keine vorhandene Datenbank.

Lovable soll das Paket mit seiner vertrauenswürdigen Datenbankverwaltung
anwenden. Alternativ, wenn Lovable eine sichere `LOVABLE_DB_MIGRATION_URL`
bereitstellt:

```sh
npm run backend:plan
npm run backend:migrate
```

Die Verbindung prüft TLS-Zertifikate. Der zweite Lauf führt bereits registrierte
Migrationen nicht erneut aus. Bei einer bestehenden, unregistrierten Datenbank
stoppt das Werkzeug: Lovable muss zuerst den tatsächlichen Schemazustand mit den
Migrationen abgleichen und die nötigen Upgrades gezielt anwenden. Nicht blind
`bootstrap.sql` wiederholen und keine Datenbank zurücksetzen.

`drizzle/migrations/*.sql` sind die Quelle; `npm run backend:bundle` erzeugt das
Paket daraus. Die alte unvollständige Drizzle-Journaldatei ist nicht der Ausführungsweg.
Nicht parallel `drizzle-kit migrate` für dieselben Migrationen starten.

## 2. Auth und ersten Admin einrichten

In Lovable Cloud die tatsächlichen App-/Preview-Redirect-URLs konfigurieren.
Öffentliche Registrierungen nach Bedarf deaktivieren und Accounts über die
verwaltete Einladung anlegen. Jeder neue Account erhält im Backend zunächst
`caller`; niemand wird allein durch die erste Registrierung Admin.

Den ersten Admin anhand seiner verifizierten Auth-Benutzer-ID über die
vertrauenswürdige Datenbankverwaltung in `public.user_roles` auf `admin` setzen.
Es gibt absichtlich keinen öffentlichen Bootstrap-Endpunkt. Danach verwaltet
die App Rollen mit `set_user_role`; sie schützt den letzten Admin.

## 3. App aktivieren

Nach erfolgreichem Datenbankaufbau und Einrichtung eines Test-Admins sowie
zweier Test-Caller `VITE_ATOMIC_BACKEND_ENABLED=true` in Lovable setzen und
neu bauen. Der Schalter aktiviert Reservierungen und alle neuen RPC-Anbindungen.
Die Migrationen entziehen alte direkte Schreibrechte: nach ihrer Anwendung
muss die passende App-Version aktiviert werden. In einer frischen Umgebung
beide Schritte vor Benutzerfreigabe durchführen.

## 4. Pipedrive-Verbindung serverseitig bereitstellen

Es ist ein HTTP-Adapter für Pipedrive API v2 implementiert. Ein nativer
Lovable-Pipedrive-Connector wurde hier nicht als verfügbar verifiziert. Falls
Lovable einen Connector verwendet, muss dessen serverseitige Authentifizierung
an den Adapter angebunden werden. Alternativ die Zugangsdaten direkt als
Cloud-Secret der Funktion bereitstellen; keine Tokens in Tabellen, Browsercode
oder Chat eintragen.

| Runtime-Binding | Zweck |
| --- | --- |
| `SUPABASE_URL` | URL des vorhandenen Cloud-Backends; normalerweise Plattform-Binding |
| `SUPABASE_SERVICE_ROLE_KEY` | Ausschließlich serverseitiger Zugriff auf die Worker-RPCs |
| `PIPEDRIVE_TOKEN` | Sicheres API-Token oder aktuell gültiges OAuth-Access-Token |
| `PIPEDRIVE_AUTH_MODE` | `api_token` (Standard) oder `oauth` |
| `COLD_CALLER_SCHEDULER_SECRET` | Eigener zufälliger, ausreichend langer Scheduler-Schlüssel |

Der OAuth-Modus übernimmt kein Refresh-Token-Management; ein verwendeter
Connector muss das Access-Token erneuern. Ohne Connector ist der API-Token-Modus
der vollständige unterstützte Verbindungsweg. Erforderliche HTTPS-Ziele sind die
tatsächliche Cloud-Backend-Domain und `api.pipedrive.com`.

In der einmaligen Zeile von `public.integration_config` die **realen** IDs für
`pipeline_id`, `appointment_stage_id`, `production_stage_id` und optional
`owner_id` eintragen. Diese IDs müssen aus dem verbundenen Konto stammen.
Erst nach Prüfung `enabled=true` setzen. Die Zielphase wird aktualisiert;
Deals werden nicht automatisch als „gewonnen“ markiert.

## 5. Worker und Zeitplanung

`supabase/functions/coldcaller-worker/index.ts` inklusive `_shared` im vorhandenen
Cloud-Projekt deployen. `supabase/config.toml` schaltet die vorgeschaltete
User-JWT-Prüfung für diesen Endpunkt aus; die Funktion prüft stattdessen selbst
konstantzeitnah den dedizierten Scheduler-Schlüssel. Ohne konfigurierten oder
korrekten Schlüssel lehnt sie den Aufruf ab.

Der Scheduler ruft einmal pro Minute die tatsächliche HTTPS-Funktionsadresse
per POST auf, mit `Authorization: Bearer <Scheduler-Secret>`. Dieser Header
wird ausschließlich im sicheren Scheduler/Vault gespeichert. Kein Browseraufruf.

Bei verfügbaren `pg_cron`, `pg_net` und Vault ist `backend/scheduler.sql` die
wiederholbare Einrichtungsvorlage. Zuvor die Vault-Einträge
`coldcaller_worker_url` und `coldcaller_scheduler_secret` sicher anlegen.
Fehlen diese Plattformfunktionen, denselben POST-Aufruf über den von Lovable
unterstützten Scheduler konfigurieren. Das Skript installiert keine Extensions
auf Verdacht und enthält keine Secrets.

Ein Lauf verarbeitet einen Auftrag und bereinigt abgelaufene Reservierungen.
Für höhere Last sind parallele Aufrufe möglich; Datenbanksperren schützen die
Übernahme. Rückrufe bleiben Aufgaben in der App; es werden keine Kunden-E-Mails
oder SMS automatisch verschickt.

## 6. Live-Abnahme vor Veröffentlichung

- Admin und zwei Caller anmelden; unerlaubte Rollenänderung als Caller ablehnen.
- Import mit gültiger Zeile, ungültiger Zeile und Dublette prüfen/bestätigen.
- Beide Caller gleichzeitig Anrufen öffnen: derselbe Lead darf nicht doppelt
  reserviert werden. Reservierung läuft nach zehn Minuten ab und wird bei
  offener Anrufseite alle zwei Minuten verlängert.
- Anrufergebnis, Notiz, Rückruf/Termin speichern; Wiederholung darf keine
  zusätzlichen Versuche, Termine oder Übertragungen anlegen.
- Angebot speichern und Summe/Nummer prüfen; fremde Angebote sind für Caller
  nicht sichtbar. Übergänge: Entwurf → gesendet → angenommen/abgelehnt;
  abgelehnt → Entwurf. Angenommene Angebote bleiben unverändert.
- Mit einem Pipedrive-Testkontakt Übernahme, Phasenwechsel und Retry prüfen.
- Fehlendes/ungültiges Token und einen vorübergehenden Ausfall prüfen.
- Statistik mit bekannten Ereignissen abgleichen; Tagesgrenzen: Europe/Vienna.

Diese Live-Prüfungen benötigen deine Verbindungen und wurden hier nicht gegen
Lovable oder Pipedrive ausgeführt. Bis dahin ist die Verbindung nicht als
produktiv verifiziert zu betrachten.

## Fehler und Wiederherstellung

Nach acht automatischen Versuchen bleibt ein Job `failed`. Admins können ihn
in den Einstellungen erneut starten. Bei Timeout nach einer möglichen externen
Neuanlage, fehlgeschlagenem Checkpoint oder abgelaufener Worker-Lease wird er
`needs_review`. Das verhindert blinde erneute Anlagen.

Ein Admin gleicht dann Organisation/Kontakt/Deal in Pipedrive ab. Die kontrollierte
RPC `resolve_integration_review` übernimmt gefundene externe IDs oder eine
explizite Bestätigung, dass keine Anlage stattfand. Danach kann derselbe Auftrag
weiterlaufen. Falsche manuelle Zuordnungen können fremde CRM-Datensätze ändern;
daher nur nach tatsächlichem Abgleich ausführen. Der Deal-Titel enthält zur
Zuordnung `[CC:<Lead-ID>]`. Neu importierte Leads werden nicht automatisch mit
bereits vorhandenen Pipedrive-Kontakten gleichen Namens zusammengeführt.

Backups und Aufbewahrungsfristen sind Plattform-/Betriebseinstellungen. Es wird
keine automatische Löschung von Audit-/Idempotenzdaten eingerichtet. Archivierung
entfernt Leads aus der aktiven Bearbeitung und erhält die Historie.
