# Glas-Icon-Familie

Die Icons verwenden lokale SVG-Geometrie mit transparenten rubinroten Flächen,
roséfarbenen Lichtkanten und dezenten Schatten. Die Glastiefe, Reflexionen und
Hover-Effekte bleiben erhalten. Helle gravierte Motive sind auch auf dunklen
Glasflächen lesbar; kleine funktionale Controls passen sich weiterhin der
Textfarbe an.
Gemeinsame Implementierung: `icons-3d.tsx`/`.css`.
Keine externen Bild-/Font-Dienste und keine zusätzliche Laufzeitabhängigkeit.

Jeder der 14 Navigationspunkte hat eine andere Silhouette. Rückrufe verwenden
Wecker, Termine einen bestätigten Kalender, Tagesstatistik eine Sonne, Auswertung
ein Kreisdiagramm, Kunden einen Handschlag und Angebote einen Beleg. Dieselbe
Funktion verwendet an mehreren Stellen bewusst dasselbe Motiv.

Anrufmaske, Dashboard, Lead-Details, Kontaktangaben, Accounts, Anmeldung,
Feedback und Dialoge verwenden dieselbe Familie. Kleine funktionale Pfeile,
Suche, Schließen und Navigationsschalter haben einen leichteren Reliefstil.
Checkbox-/Radio-Zustände und Größen-Griffe bleiben native funktionale Controls.

Hover-/Druckbewegungen sind dezent und werden bei reduzierter Bewegung deaktiviert.
Beschriftungen bleiben erhalten; die Icons sind dekorativ und für Screenreader
verborgen. Einzigartige React-useId-Werte verhindern kollidierende SVG-Verläufe.

Prüfung: Typprüfung, 18 bestehende Tests und Produktionsbuild bestanden.
Mit lokalen Browser-Fixtures Desktop und 390px-Mobilnavigation geprüft:
14 einzigartige Navigationsmotive, keine Page-Exceptions, reduzierte Bewegung
wirksam. Screenshots unter `docs/frontend/icon-refresh/`. Die Fixtures stellen
keinen Test der Cloud-Verbindungen oder echter Konten dar.

Die verstärkte Glasversion ergänzt eine deutlich versetzte Rückplatte, eine
innere Brechungskante, mehrere spiegelnde Facetten und einen einmaligen Lichtlauf
bei Hover. Die Hover-Neigung nutzt CSS-Perspektive. Bei reduzierter Bewegung
werden auch die Animationen der inneren SVG-Ebenen deaktiviert.
