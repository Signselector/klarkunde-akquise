# Design QA – klare Icons / Graphit

final result: passed

## Vergleichsziel und Evidenz

- Quelle: `docs/frontend/icon-options/04-klare-icons-graphit.png`.
- Render: `docs/frontend/icon-refresh/desktop.png`, `mobile.png`, `sidebar.png`.
- Gemeinsamer Vergleich: `docs/frontend/icon-refresh/comparison.png`; Quelle und
  gerenderter Sidebar-Ausschnitt wurden zusammen in einem Browserframe geöffnet.
- Desktop-Viewport 1440 × 1000 CSS px, deviceScaleFactor 1; Mobile 390 × 844.
- Referenz 887 × 1774 Bildpixel; reine Stilvorlage der Navigation. Die kombinierte
  Vergleichsansicht zeigt beide Seiten mit 248px Breite. Die Vorlage ist auf
  diese Breite skaliert, die tatsächliche Sidebar ist 248 × 1000 bei 1:1-Dichte.
- Zustand: Anrufen aktiv, Admin-Fixture Alex Beispiel, Menü offen. App-Inhalt rechts
  ist eine leere Test-Arbeitsliste und nicht Teil des gewählten Gestaltungsumfangs.
- Geprüfter Umfang: Icon-Familie, Graphit-Material und Auswahlbalken. Die bestehende
  App-Breite, Schriftgröße und Informationsarchitektur sollten erhalten bleiben;
  die Referenz ist keine Anweisung zur Verkleinerung aller Produktionscontrols.

## Findings und Iterationen

- [P2, behoben] Erste Umsetzung schnitt den letzten Menüpunkt am Footer an.
  Die Menüzeilen wurden von 48 auf 44px reduziert, Padding entsprechend angepasst.
  Die erneute Aufnahme `sidebar.png` und `comparison.png` zeigt Einstellungen
  vollständig oberhalb des Footers. Die 44px-Touchflächen bleiben erhalten.
- Keine verbleibenden P0/P1/P2-Abweichungen im bestätigten Gestaltungsumfang.

## Erforderliche Fidelity-Flächen

- Typografie: lokale Instrument Sans bleibt lesbar, warmweiße Beschriftung, keine
  neue Schrift oder geänderte Texte. Produktionsgrößen bleiben absichtlich erhalten.
- Rhythmus/Layout: 24px-Icons, konsistente Ausrichtung, 14px Abstand zwischen Motiv
  und Label, 44px hohe Ziele. Mobile Drawer scrollt; Footer bleibt bedienbar.
  Dashboard ist gegenüber der reinen Stilvorlage weiterhin vorhanden.
- Farben: Graphit statt flachem Schwarz, tiefes Burgund (#620b12), feine rote
  Kontur (#8d2931), Offwhite-Symbole. Kein metallisches oder rotes Icon-Material.
- Assets: echte Lucide-Bibliotheksglyphen statt handgebauter SVGs; keine
  Glaskacheln, Schatten oder Gradients in Glyphen. Lokales Original-Logo erhalten.
  Hintergrund ist ein generiertes Rastermaterial, keine CSS-Zeichnung.
- Text/Inhalt: bestehende deutschen Ziele und Rollen-/Accountanzeige erhalten.
  Unterschiedliche Motive für Rückrufe, Termine, Statistik und Auswertung.

## Funktionelle Prüfung

- Browserfixture zeigt 14 verschiedene Navigationsmotive, keine Page-Exceptions.
- Navigationswechsel zu Anrufen aktiviert den korrekten roten Balken.
- Mobile Drawer öffnet über den beschrifteten Navigationsschalter.
- Reduzierte Bewegung geprüft; keine Glaskomponenten/Gradient-Defs im gerenderten
  Icon-DOM mehr vorhanden. Backend-/Auth-Verbindungen nicht Gegenstand des Tests.
- Typprüfung, 18 vorhandene Tests und Produktionsbuild bestanden.

## Follow-up Polish

- P3: Bibliotheks-Kalender verwendet ein Punktraster statt einer festen „31“.
  Bewusst keine feste Zahl als reale Tagesinformation eingeführt.
- Die Grafikvorlage hat andere Außenränder und eine andere Skalierung; bestehende
  App-Container wurden gemäß dem Änderungsumfang beibehalten.
