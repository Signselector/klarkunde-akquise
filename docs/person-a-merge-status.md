# Person A – Merge- und Bereitstellungsstatus

Der Backend-Implementierungsstand umfasst jetzt Reservierungen, atomare Anrufe,
Importprüfung und -bestätigung, Datenqualität, Angebote, Rollen, Statistiken,
Pipedrive-Aufträge, Worker und Scheduler-Vorlage. Bestehende Seiten sind hinter
`VITE_ATOMIC_BACKEND_ENABLED` angebunden. Der Standard bleibt ausgeschaltet,
bis Lovable die Datenbank und Verbindungen bereitstellt.

## Lokale Prüfungen

- Anwendungs- und Worker-Tests einschließlich Rate-Limit, Timeout, Auth und Checkpoints.
- PostgreSQL-Tests für RLS, Idempotenz, Import, Angebote, Rollen, Retry und Statistiken.
- Echter PostgreSQL-16-Test mit 20 Callern, zehn gleichen Requests und zehn Workern.
- Migrationswerkzeug mit vollständigem Erstlauf und unverändertem zweiten Lauf.
- Typprüfung für App und Worker, generierte Typen und SQL-Bundle, Produktionsbuild.

Die tatsächlichen Lovable-/Pipedrive-Verbindungen und deren Live-Abnahme folgen
beim Nutzer. Weder ein Git-Merge noch die lokalen Tests führen diese Schritte aus.

## Nach dem Merge in Lovable

`docs/LOVABLE-BACKEND-SETUP.md` ausführen: Datenbank bereitstellen, Erstadmin und
Testaccounts einrichten, Cloud-Worker und Secrets verbinden, reale Pipedrive-IDs
setzen, Scheduler aktivieren, App-Flag setzen und Live-Abnahme durchführen.

Der Merge ist ein Code-Release. Produktionsfreigabe erst nach dieser Abnahme.
Bestehende Datenbanken werden weder automatisch gelöscht noch ungeprüft übernommen.
