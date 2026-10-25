# Bestätigte Richtung: klare Icons auf Graphit

Die früheren Glas-Kacheln sind durch klare, einfarbige Bibliotheks-Icons ersetzt.
Quelle: `icons.tsx` und `icons.css`. `icons-3d.tsx` bleibt lediglich als
Import-Kompatibilität erhalten; es rendert keine Glas-/3D-Ebenen mehr.

Visuelle Vorlage: `icon-options/04-klare-icons-graphit.png`, vom Nutzer bestätigt.
Hintergrund: lokale generierte Graphit-Textur, dezente rote Auswahlfläche mit
heller Oberkante und weichem Schatten. Keine farbigen Icon-Kacheln, kein
3D-Kippen und keine Lichtlaufanimationen. Alle 14 Navigationsmotive sind eindeutig.

Icons: Lucide entspricht der gewählten klaren Linienführung. Rückrufe verwenden
History, Termine CalendarDays, abgeschlossene Leads CircleCheck, Kunden Handshake,
Angebote FilePenLine. Die gleichen semantischen Motive werden in Seiten und
Dialogen konsistent verwendet. Strichstärke standardmäßig 1,8; Navigation 24px.

Produktionslayout und zusätzliche Dashboard-Navigation bleiben erhalten.
44px hohe Menüziele verhindern die zuvor angeschnittene Einstellungen-Zeile auf
einem Desktop mit 1.000px Höhe. Kleinere Displays verwenden weiterhin die
scrollbare mobile Navigation. Logo und lokale Instrument-Sans-Schrift bleiben.

Prüfung: Typprüfung, 18 Tests, Build sowie Desktop-/Mobil-Browserprüfung.
Browser-Fixtures prüfen Darstellung, eindeutige Motive und Navigation; keine
Cloud-/Benutzerkonten werden dabei verändert. Aktuelle Screenshots unter
`icon-refresh/`, visueller Vergleich und Ergebnis in `design-qa.md`.
