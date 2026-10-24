# Frontend-Vorbereitung · Person B

## Umfang und Abgrenzung

Eigenständige Komponenten und isolierte Design-Werkstatt. Bestehende Seiten,
globale Styles, generierter Route-Baum, Datenbank, Supabase-Typen, RPCs und
Integrationen bleiben unverändert. Grundlage: main 8ac2a635.
`codex/coldcaller-rebuild` war bei Arbeitsbeginn am 24.10.2026 noch nicht auf
GitHub sichtbar. Die Grundlage von Person A wird nicht als freigegeben behandelt.

## Designrichtung

Konzentrierter Arbeitsplatz mit Spielcharakter: Marineblau für Navigation,
helle Arbeitsflächen, kräftiges Blau für primäre Aktionen, Gold für Rückrufe
und Rewards, Grün für bestätigte Erfolge. Status hat immer einen Text.
Große Symbole, 44px-Bedienflächen, sichtbarer Fokus, kurze Animationen (220–420ms).
Systemschrift ohne externe Font-Abfragen; IBM Plex Sans, falls lokal vorhanden.

Desktop: Navigation seitlich, Anrufmaske neben Rückrufen. Mobil: kompakte,
horizontal scrollbare Navigation, Arbeitsbereiche untereinander. Tabellen
scrollen in ihrem eigenen Container. Keine wichtigen Informationen ausblenden.

## Vorschau und Prüfungen

Nach Installation der vorhandenen Abhängigkeiten:

```sh
npx vite --config frontend-preview/vite.config.ts
npx tsc --noEmit
npx tsc --project frontend-preview/tsconfig.json --noEmit
npm test
npm run build
npx vite build --config frontend-preview/vite.config.ts
```

Vorschau: http://127.0.0.1:4175. Keine App-Routen, kein Supabase-Client,
keine produktiven Netzwerkaktionen. Firma, Adresse, Telefonnummer und
`.example`-Domain sind Beispieldaten. Kennzahlen bleiben leer, Coins deaktiviert.
Suche, Info-Popover, Rückrufdialog, Zustandsauswahl und Animationsvorschau sind
bedienbar. Nicht angebundene Aktionen sind deaktiviert.

## Komponentenvertrag

Werte, Berechtigungen und Aktionen kommen über Props. Zum Einbinden `theme.css`
importieren und den Arbeitsbereich mit `cc-theme` versehen. Die Portalflächen
`cc-dialog` und `cc-help` tragen eigene Tokens. Kein globaler Body-Reset im Kit.

| Komponente     | Verantwortung                                                  |
| -------------- | -------------------------------------------------------------- |
| ActionButton   | Primäre, sekundäre, destruktive Aktionen; normale Button-Props |
| InfoButton     | Klick-/Tastatur-Popover für Begriffserklärungen                |
| StatusBadge    | Gelieferter Anzeigetext und Farbe, keine Stage-Regeln          |
| MetricCard     | Gelieferter Wert, Kontext und Erklärung, keine Berechnung      |
| Surface        | Arbeitsfläche mit Überschrift und optionaler Aktion            |
| SyncIndicator  | Expliziter Zustand queued/synced/error/review                  |
| FeedbackState  | Laden, leer oder Fehler mit optionaler Aktion                  |
| CallbackDialog | Kontrolliertes Overlay ohne eigenen Anrufentwurf               |
| SuccessBanner  | Bestätigter Erfolg, schließbar, Animation optional             |

SuccessBanner spielt keinen Ton, vergibt keine Punkte und leitet keinen Erfolg
aus Stage-Namen ab. Kein automatischer Fokuswechsel. Bei reduzierter Bewegung
entfallen alle Kit-Animationen; Ladezustände bleiben als Text sichtbar.

## Benötigte Übergabe von Person A

1. **Rechte:** Capability-Flags je Aktion, Leadzuweisung, Kunden- und
   Fulfillment-Verantwortliche. Keine eigene Rechteableitung im Frontend.
   Einsteiger, Veteran, Manager und Admin später mit echten Testkonten prüfen.
2. **Stages:** stabile IDs, Anzeigenamen, erlaubte Ziele und Pflichtnotiz-Flag.
   Anzeigenamen: Warten auf Logo, Logo Render, Realistisches Render,
   Zukunftsprojekt; drei Produktionsplanungs-Stages als Gewonnen anzeigen,
   ursprüngliche CRM-ID erhalten. Nicht erreicht bleibt internes Ergebnis.
3. **Rückrufe:** Nutzer, Fälligkeit mit Zeitzone, Leaddaten und bestätigte Aktionen.
   Der Dialog darf die Anrufmaske nicht unmounten. Entwurfssicherung über
   Navigation/Reload ist separat zu vereinbaren; bisher nur Dialogerhalt.
4. **CRM:** bestätigter Syncstatus, Fehler, letzter Versuch, erlaubte Prüf- und
   Wiederholungsaktionen. Vorgemerkt niemals als übertragen/gesendet behandeln.
5. **Kalender:** bestehende CRM-Aktivitäts-ID, Zeiten, Zeitzone und erlaubte
   Verschiebeaktion. Keine Termin-Neuanlage im zukünftigen Frontend.
6. **Performance:** berechnete Werte, Einheiten, Zeitraum, Datenstand, Qualität,
   Rang und Coin-Freigabe. Keine eigenen Formeln oder XP-Regeln im Frontend.
7. **Mail:** Entwurf, Empfänger, Betreff, Text, Bestätigung und Versandstatus.
   Editor und Versand sind noch nicht Teil dieses ersten Pakets.
8. **Shop:** Preise, Bestand, Refurbished-Flag, Einlöseberechtigung und bestätigte
   Ergebnisse. Keine lokale Abbuchung oder Aktivierung vor Statistikfreigabe.
9. **Import/Export:** Vorschau, Zeilenfehler, Ergebnis und Dublettenbefund;
   vorhandene Nicht-erreicht-Exporte mit freigegebenen Downloadaktionen.

## Reihenfolge nach Übergabe

Leadlisten/Import/Anrufmaske → Kundenakte/CRM/Kalender → Performance/Rangliste/
Historien → Referenzmails/Deal-Prüfung → Erfolgsereignisse/Sound/Shop.

Vor Übernahme Dateibesitz mit Person A abgleichen. Kleine PRs, gegenseitige
Prüfung, keine Force-Pushes. Lovable und Agent bearbeiten nicht gleichzeitig
dieselben Dateien. Dieses Paket ist noch kein Länder-Rollout.
