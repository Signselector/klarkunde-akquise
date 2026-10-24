# Plan A – umgesetzt für Lovable Cloud

Die vorhandene Lovable Cloud ist das Backend. Ein separates Supabase-Projekt wird
nicht benötigt. Die frühere Annahme eines extern neu anzulegenden Projekts ist
aufgehoben. Für die vereinbarte leere Geschäftsdatenbank liegt ein vollständiges
SQL-Paket vor; vorhandene Datenbanken werden nicht automatisch zurückgesetzt.

| Etappe | Implementierter Stand |
| --- | --- |
| A1 Basis | Checksummierte Migrationen, Fresh-Database-Paket, generierte Typen, kontrollierter Erstadmin |
| A2 Rechte | Admin/Caller, RLS, RPC-Schreibwege, letzte-Admin-Schutz, Audit |
| A3 Anrufablauf | Exklusive befristete Reservierung, atomare Speicherung, Idempotenz, Rückrufe und Termine |
| A4 Daten | Staging-Import, Validierung/Dubletten, Qualitätsdaten, Kontaktkorrekturen, atomare Angebote und Wiener Tagesstatistiken |
| A5 Pipedrive | Transaktionale Outbox, API-v2-Adapter, Checkpoints, Backoff, manuelle Prüfung unklarer Anlagen |
| A6 Automationen | Gesicherter Worker, Lease-Bereinigung, Scheduler-Vorlage, Statusanzeige und Retry |
| A7 Abnahme | Lokale Funktions-, Datenbank-, Parallelitäts- und Build-Prüfungen; Live-Abnahme nach Verbindung |

Quellen und Verträge: `docs/person-a-backend-handoff.md`.
Verbindung/Deployment: `docs/LOVABLE-BACKEND-SETUP.md`.
Merge-Status: `docs/person-a-merge-status.md`.

Person A besitzt Backend und Schnittstellen, Person B Design. Bestehende Oberflächen
sind funktional angebunden; das Designkit von Person B bleibt erhalten. Aktuelle
Basis ist der verfügbare Git-Stand; der fehlende codex/coldcaller-rebuild-Branch
wurde nicht übernommen.

Nach Übernahme des Codes bleibt für den Nutzer die Verbindung in Lovable:
Datenbank anwenden, Auth konfigurieren, sichere Pipedrive-Bindings und Zielphasen
setzen, Worker/Zeitplanung bereitstellen und die dokumentierten Live-Tests ausführen.
