# Rollen

Migrationen: `0015_roles_enum.sql` (neue Enum-Werte), danach `0016_roles.sql` und `0017_countries_admin_only.sql`. Tests: `node --test tests/backend/roles.test.mjs`.

| Rolle | Wer | Rechte |
| --- | --- | --- |
| **Recruit** | Caller. Jeder neue Account startet hier. | Anrufen, Aktionen, eigene Batches. Bucht **keine** Termine (die liegen beim Manager). |
| **Veteran** | Caller | Wie Recruit, plus Termine für sich selbst einbuchen. |
| **Manager** | Geschäftsführung | Admin-Rechte im eigenen Land: Accounts der Caller des Landes (deaktivieren), Recruit → Veteran, Batches zuweisen und freigeben, Statistiken, Vorlagen, Leitfaden, Monatsziel, Leads einsehen und bearbeiten. **Kein** Backend. |
| **Admin** | | Alles, in allen Ländern: Rollen vergeben (auch Manager und Admin), Länder, Backend, Integrationen, Stage Mapping, Test-Modus, Backups (Backups nur der Master-Admin), Accounts löschen. |

Die frühere Zusatzrolle „Fulfilment“ gibt es nicht mehr (Migration 0026).

## Wie es technisch gilt

* Die Rolle steht in `user_roles`, genau eine Hauptrolle je Account (eindeutiger Index). Die alte Rolle `caller` ist abgelöst: bestehende Caller wurden zu Recruits, der Enum-Wert bleibt aus technischen Gründen, `has_role(…,'caller')` meint Recruit und Veteran.
* `has_role(uid,'admin')` gilt für **Admin und Manager** („darf verwalten“). Alles, was nur der echte Admin darf, nutzt `is_global_admin(uid)`: Integrations-Konfiguration, Wiederholen und Prüfen von Integrations-Jobs, Archivieren, Audit-Protokoll, Stage Mapping und Stage-Prüfung, Test-Modus, Accounts löschen.
* Land: `has_admin_rights(uid, land)` ist für Admins immer wahr, für Manager nur in den Ländern, die ihnen freigeschaltet sind. Damit prüfen Lead-Aktionen, Batch-Freigabe und -Zuweisung. Admins sehen alle Länder (`can_access_country`).
* Rollen ändern (`set_user_role`): Admin jede Rolle (nicht den Master, nie den letzten Admin). Manager nur Recruit ↔ Veteran, nur für Caller, mit denen er ein Land teilt.
* Länder festlegen: **nur der Admin** (Migration 0017). Ein Manager arbeitet nur in den ihm zugewiesenen Ländern und kann weder Länder vergeben noch entziehen. Caller ohne Land kann er erst verwalten, wenn der Admin ein gemeinsames Land gesetzt hat.
* Deaktivieren (`set_user_active`): Admin, oder Manager für Caller des eigenen Landes.
* Termine: `save_calendar_appointment` und `create_appointment` weisen Recruits ab (`appointment_forbidden`). Veteran, Manager und Admin buchen auf sich selbst.

## Oberfläche

* Accounts: Admin wählt die Rolle im Auswahlfeld, Manager sieht „Zu Veteran“ / „Zu Recruit“. Länderschalter nur dort, wo erlaubt. Löschen nur Admin. Manager sehen in der Liste nur Accounts ihres Landes.
* Einstellungen: Manager sehen „Ziele“, E-Mail, SMS, Leitfaden. Pipedrive, Stage Mapping, Deduplication (und Backups für den Master) nur Admins.
* Dashboard: Pipedrive-Übertragungen und Datenqualität nur Admins. Termine: Recruits sehen statt „Termin anlegen“ den Hinweis, dass der Manager bucht.

## Dashboard-Ziel

„Anrufe heute“ bleibt die große Zahl im Ring. Der Ring und die Zeile „Noch X Anrufe bis zum Monatsziel“ zeigen die Anrufe des Monats (`get_caller_month`, Wiener Zeit) gegen das Monatsziel aus Einstellungen → Ziele (Standard 800, bis es gesetzt ist).

## Offen

* Die Termine „liegen beim Manager“ ist hier nur als Buchungsrecht umgesetzt: Es gibt keine automatische Zuweisung eines Termins an den Manager des Landes, weil es dafür keine Aktion mehr im Anrufablauf gibt.
* Manager sehen in Statistiken und Verlauf alles, was Admin-Abfragen liefern; eine Begrenzung der Team-Statistik auf das eigene Land ist nicht gesondert nachgeprüft (Zeilen-Zugriff läuft über `can_access_country`).

## Rechte-Matrix (Migration 0031)

| Bereich | Caller / Senior Caller | Manager | Admin |
| --- | --- | --- | --- |
| Admin-Bereich im Menü | nein | ja, ohne Einstellungen | ja |
| Einstellungen / Backend (`/settings`, Pipedrive, Stages, Backups, Testmodus) | nein | nein (Umleitung aufs Dashboard) | **nur der Master-Admin** (Migration 0032) |
| Upload (`/import`) | nein | nur eigenes Land (fest) | Zielland frei wählbar (Pflicht) |
| Kein Interesse, Zukunftsprojekte, Referenzmail offen | nein | nur eigenes Land | Land wählbar oder „Alle Länder“ (Spalte „Land“) |
| Accounts | nein | nur Accounts des eigenen Landes (neue Accounts ohne Land sehen nur Admins); Rollen Caller / Senior Caller | alle Accounts, alle Rollen und Länder, Löschen |
| Account ohne Land | Sperrschirm „Account wartet auf Freischaltung“ (gilt für alle außer Admins) | | |

Datenbank: `get_no_interest_leads`, `get_future_projects_leads`, `get_unanswered_reference_leads` akzeptieren `'ALL'` nur für Admins. Der Import ist für Manager und Admins; das Zielland setzt `set_import_batch_country` (Manager nur für ihr Land), `confirm_import` prüft das Land des Batches.
