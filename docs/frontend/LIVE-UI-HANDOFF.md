# Echte App-Oberfläche · erstes Umsetzungspaket

Basis: `main` bei `41557cb299954ea5a5b45694cc896f326db910e3`.
Arbeitsbranch: `feature/coldcaller-live-ui`. Stand: 24. Oktober 2026.

## Was jetzt tatsächlich angeschlossen ist

- Die normale Anmeldung verwendet den KlarKunde-Stil mit eigener Mobilansicht.
- Das authentifizierte App-Layout verwendet die dunkle Navigation, größere
  Symbole, aktive Seitenmarkierung, Mobilmenü und einen Tastatur-Sprunglink.
- Anrufen und Rückrufe sind direkt in der Navigation erreichbar.
- Das Dashboard zeigt einen direkten Arbeitsstart und die vorhandenen Batches.
  Die bisherige Fortschrittsberechnung bleibt erhalten und ist ausdrücklich
  keine Abschlussquote. Es wurden keine neuen Performanceformeln hinzugefügt.
- Die echte Leadliste enthält Suche, Statusfilter, erkennbare Statusanzeigen,
  Leer-/Fehler-/Ladezustände sowie eine gestaltete Detailansicht.
- Die echte Anrufmaske verwendet das Komponentenpaket, Kontaktdaten, sichere
  Website-/Mapslinks und den vorhandenen Gesprächsleitfaden.
- Ein fälliger Rückruf wird bewusst im Dialog geöffnet und anschließend in
  den Arbeitsplatz übernommen. Ein anderer bereits geöffneter Lead wird nicht
  alleine durch das Eintreffen eines Rückrufs verdrängt.
- Notiz, Rückrufzeit und Formularzustand werden je angezeigtem Lead getrennt
  im Seitenspeicher gehalten. Dialoge und der Wechsel zwischen offenem Lead
  und Rückruf verlieren diese Entwürfe nicht. Navigation/Reload sichern sie
  weiterhin NICHT dauerhaft; die Hilfe in der Oberfläche sagt das ausdrücklich.
- Die neue Anrufmaske bietet keine Termin-Neuanlage. Bestehende Backendhandler
  bleiben kompatibel; ihre Unterstützung für `appointment` wurde nicht entfernt.

Das ist eine Änderung der tatsächlichen App-Routen, keine weitere separate
Komponenten-Vorschau. Datenbank, Rechte, RPCs, Supabase-Typen, Accounts-Seite
und Backend-Aktivierungsflag wurden nicht verändert.

## Übergabe an Backend-Verantwortliche

`record` und `recordLegacy` sind fachlich erhalten. Die einzige zielbezogene
Anpassung ist `selectedCallback`: Rückruf-ID und Erledigung beziehen sich auf
den tatsächlich im Arbeitsplatz gewählten Rückruf, nicht bloß auf einen
gleichzeitig verfügbaren fälligen Rückruf. Nutzlasten und Flag bleiben erhalten.

Während dieses Pakets gehört `call.tsx` der Frontend-Arbeit. Zukünftige
Schnittstellenänderungen bitte zuerst als Vertrag/Modul übergeben und dann
gezielt in diese Version einbinden, nicht eine ältere Call-Seite zurückkopieren.

Keine Migration angewendet und kein produktives Flag aktiviert. Die bereits
vorhandenen Grenzen des Legacy-Speicherns bestehen weiter: mehrere getrennte
Schreibvorgänge statt Transaktion. Dieses UI-Paket ersetzt die Backendfreigabe
nicht und führt keine zweite Geschäftslogik ein.

## Prüfung

- App-Typprüfung, vorhandene Tests und Produktionsbuild.
- Zehn Unit-/Routingtests insgesamt, darunter drei neue Prüfungen für sichere
  importierte Website-/Adresslinks.
- Geänderte TS/TSX-Dateien mit ESLint prüfen.
- Browserprüfungen auf den echten Routen mit ausschließlich abgefangenen
  Testantworten, sowohl mit deaktiviertem als auch aktiviertem Backendflag.
- Login, Dashboard, Suche/Filter, Detaildialog, Mobilnavigation, Rückrufdialog,
  getrennte Leadentwürfe und Notizerhalt nach simuliertem Speicherfehler.
- Bei aktiviertem Flag: wiederholter fehlgeschlagener Aufruf verwendet denselben
  Request-Schlüssel; ein offener Lead erhält keine fremde Rückruf-ID.
- Caller-Testfixture zeigt keine Adminnavigation und keine Sammellöschaktion.
- Bildschirmbreiten 320, 390, 768 und 1440 Pixel ohne Seitenüberlauf.
- Simulierter Lesefehler führt zu sichtbarer Fehlermeldung mit Wiederholungsaktion.

Die Browserprüfung ist wiederholbar. Playwright optional außerhalb der
Anwendungsabhängigkeiten installieren; kein Lockfilewechsel erforderlich:

```sh
# Terminal 1: tatsächliche App, Standardweg
npx vite --host 127.0.0.1 --port 4176

# Terminal 2: Pfad zur separat installierten Playwright-Bibliothek übergeben
UI_TEST_URL=http://127.0.0.1:4176 node tests/frontend/live-ui.cjs /absolute/path/to/playwright

# Zweiter Durchlauf mit vorbereitetem RPC-Weg, nur lokal und mit Mockantworten
VITE_ATOMIC_BACKEND_ENABLED=true npx vite --host 127.0.0.1 --port 4177
UI_TEST_URL=http://127.0.0.1:4177 node tests/frontend/live-ui.cjs /absolute/path/to/playwright
```

Alle entfernten Browseranfragen werden abgefangen. Anmeldung und Datensätze
sind lokale Testfixtures; es gibt keine produktiven Schreibvorgänge. Erwartete
HTTP-500-Meldungen gehören zu den simulierten Fehlerprüfungen.
Screenshots unter `live-ui-screenshots/` zeigen diese Testdaten, keine echten
Kunden und keinen Nachweis einer Lovable-Veröffentlichung.

## Noch offen / bewusste Paketgrenze

- Die normale Lovable-Vorschau ist erst nach Review und Merge auf diesen
  Branchstand zu prüfen. Die lokale Prüfung ist kein Cloud-Veröffentlichungsnachweis.
- In Lovable mit echten Testaccounts anmelden und Login, Navigation, Leadliste,
  Gesprächsnotiz und Rückruf erneut prüfen. Keine produktiven Kunden für Tests ändern.
- Noch keine vollständige Neugestaltung von Import, Rückrufliste, Kunden,
  Kalender, Angeboten, Statistiken, Mail-Editor oder Shop. Sie verwenden bereits
  den neuen App-Rahmen, ihre Fachoberflächen folgen in eigenen Paketen.
- Die alte Terminseite besitzt weiterhin ihre bisherige Anlagefunktion. Der
  geforderte Kalenderumbau muss sie durch reine CRM-Terminverschiebung ersetzen.
- Veteran/Manager/Recruit und persönliche Leadzuweisung fehlen noch als
  freigegebene Backendverträge. Dieses Paket erfindet keine Rollenrechte.
- Keine neuen Coins, Ranglisten, Qualitätsberechnungen oder behaupteten Syncs.
