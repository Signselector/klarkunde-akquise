# Sign Selector · Cold Caller Branding

Referenz: [www.signselector.com](https://www.signselector.com/), visuell und
anhand der tatsächlich geladenen Schrift, Logos und CSS-Variablen geprüft am 24. Oktober 2026. Basis dieses Branches: `main` bei `5f96266`.

## Übernommene Markenmerkmale

| Rolle    | Website-Wert | Verwendung im Tool                            |
| -------- | ------------ | --------------------------------------------- |
| Ink      | `#161515`    | Haupttext und primäre Buttons                 |
| Night    | `#0e0d0d`    | Navigation und Login-Markenfläche             |
| Paper    | `#f4f2ee`    | Warmer Seitenhintergrund                      |
| Paper 2  | `#ebe7e0`    | Sekundäre Flächen                             |
| Stone    | `#d9d4cb`    | Grenzen und gedämpfte Details                 |
| Graphite | `#57534e`    | Sekundärtext                                  |
| Accent   | `#750404`    | Markenrot, aktive Navigation, Links und Fokus |

Die Website-Hexwerte wurden für die bestehende Tokenstruktur in OKLCH
umgerechnet. Primäre Aktionen bleiben schwarz/weiß; informative Markierungen
nutzen einen hellen Rotton mit dunklem Markenrot. Warnungen, Fehler und bestätigte
Erfolge behalten unterscheidbare semantische Farben und immer eine Textbezeichnung.

- Originale Sign-Selector-Wortmarke, ohne Nachzeichnung, Umfärbung oder Verzerrung.
- Helle und dunkle Logoausführung passend zum jeweiligen Hintergrund.
- Schrift **Instrument Sans Variable**, wie auf der Website, lokal ausgeliefert.
- Rund ausgeführte Aktionsbuttons, ruhige warme Flächen und klare Konturen.
- Die spielerischen Funktionsbausteine bleiben erhalten; die bisherige
  Blau-/Lime-Marke und das Blitz-Ersatzlogo entfallen in den App-Einstiegen.
- Navigation, Login, Dashboard, Komponenten und Browser-Titel führen jetzt
  **Sign Selector · Cold Caller**. Das Repository bleibt unverändert benannt.

## Originalassets

Lokal unter `public/brand/signselector/`:

- `logo-light.png`: https://www.signselector.com/img/signselector-logo-light-v4.png
- `logo-ink.png`: https://www.signselector.com/img/signselector-logo-ink-v4.png
- `favicon-v2.svg` und `favicon-v2.ico`: gleichnamige Originaldateien der Website.
- `instrument-sans-latin.woff2` und `instrument-sans-latin-ext.woff2`: Originale
  aus https://www.signselector.com/fonts/.
- `OFL.txt`: Instrument-Sans-Schriftlizenz aus dem Google-Fonts-Repository,
  https://github.com/google/fonts/blob/main/ofl/instrumentsans/OFL.txt.

Logo, Font und Favicon erzeugen zur Laufzeit keine Anfragen an Signselector oder
Google Fonts. Die frühere externe IBM-Plex-Einbindung wurde entfernt.

## Umfang und Prüfung

Reine Markenanpassung auf dem neuesten Hauptstand. Keine Änderung an Datenbank,
Rechten, Integrationen, Speicherpfaden oder Backend-Aktivierung. Die jüngsten
Lovable-Änderungen im Hauptbranch sind Grundlage dieses Pakets.

Typprüfung, zehn vorhandene Tests, Produktionsbuild und Komponenten-Vorschau-Build
prüfen. Die echten App-Seiten werden zusätzlich mit einer ausschließlich lokal
betriebenen Testdatenverbindung visuell kontrolliert. Browsernachweise liegen
unter `signselector-screenshots/`: Original-Logo und lokale Schrift im Dashboard,
Anrufmaske sowie schmale 390px-Ansicht der echten App in einem Test-Iframe.

Der Browser hat die tatsächlich geladene Instrument-Sans-Schrift und die
Original-Logoabmessung bestätigt. Screenshots enthalten nur Testkontakte.
Sie belegen keine Veröffentlichung in Lovable. Nach Review und Merge ist die
normale Lovable-Vorschau auf den synchronisierten Hauptstand zu prüfen.
