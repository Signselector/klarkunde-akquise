import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  ChevronRight,
  CircleHelp,
  Coins,
  Headphones,
  LayoutDashboard,
  ListFilter,
  MapPin,
  Phone,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Upload,
  Users,
  Volume2,
  Zap,
} from "lucide-react";
import {
  ActionButton,
  FeedbackState,
  InfoButton,
  MetricCard,
  StatusBadge,
  Surface,
  SyncIndicator,
  type SyncState,
} from "../src/components/coldcaller/primitives";
import { CallbackDialog } from "../src/components/coldcaller/callback-dialog";
import { SuccessBanner } from "../src/components/coldcaller/success-banner";
import "../src/components/coldcaller/theme.css";
import "./preview.css";

const lead = {
  company: "Musterwerk Architektur GmbH",
  contact: "Alex Beispiel · Geschäftsführung",
  phone: "+43 000 000000",
  dueLabel: "jetzt",
  note: "Demodatensatz: Bitte zur vereinbarten Zeit zurückrufen.",
};
const nav = [
  { label: "Arbeitsplatz", icon: LayoutDashboard },
  { label: "Meine Leads", icon: Users },
  { label: "Meine Kunden", icon: ShieldCheck },
  { label: "Kalender", icon: CalendarDays },
  { label: "Performance", icon: ChartNoAxesColumn },
  { label: "Reward-Shop", icon: Trophy },
];

export function Preview() {
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [note, setNote] = useState("");
  const [animations, setAnimations] = useState(true);
  const [success, setSuccess] = useState(false);
  const [sync, setSync] = useState<SyncState>("queued");
  const [state, setState] = useState<"empty" | "loading" | "error">("empty");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("Arbeitsplatz");
  return (
    <div className="cc-theme cc-preview">
      <aside className="preview-sidebar">
        <a className="preview-brand" href="#arbeitsplatz">
          <span>
            <Zap size={27} fill="currentColor" />
          </span>
          <strong>
            KlarKunde<small>Dein nächster Abschluss.</small>
          </strong>
        </a>
        <div className="preview-workspace">
          Akquise-Zentrale <StatusBadge>UI-Vorschau</StatusBadge>
        </div>
        <nav aria-label="Komponentenbereiche">
          {nav.map(({ label, icon: Icon }) => (
            <a
              href={
                label === "Arbeitsplatz"
                  ? "#arbeitsplatz"
                  : label === "Reward-Shop"
                    ? "#rewards"
                    : "#komponenten"
              }
              key={label}
              aria-current={section === label ? "location" : undefined}
              onClick={() => setSection(label)}
            >
              <Icon size={23} />
              {label}
              {label === "Arbeitsplatz" && <ChevronRight size={16} />}
            </a>
          ))}
        </nav>
        <div className="preview-sidebar-bottom">
          <div className="preview-coins">
            <Coins size={25} />
            <div>
              <strong>Coins folgen später</strong>
              <small>Nach Freigabe der Statistiken</small>
            </div>
          </div>
          <a href="#einstellungen">
            <Settings size={21} />
            Darstellung
          </a>
          <div className="preview-profile">
            <span>UI</span>
            <div>
              <strong>Design-Werkstatt</strong>
              <small>Keine Live-Verbindung</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="preview-body">
        <div className="preview-topbar">
          <span>
            KlarKunde <ChevronRight size={15} /> Frontend-Werkstatt
          </span>
          <span>
            <ShieldCheck size={16} /> Isolierte Vorschau
          </span>
        </div>
        <main id="arbeitsplatz">
          <div className="preview-notice">
            <Sparkles size={18} />
            <span>
              <strong>Designvorschau mit Beispieldaten.</strong> Aktionen demonstrieren die
              Oberfläche. Es werden keine Anrufe, CRM-Änderungen oder Einlösungen ausgeführt.
            </span>
          </div>
          <header className="preview-heading">
            <div>
              <h1>Bereit für gute Gespräche.</h1>
              <p>Deine Leads im Blick. Der nächste Schritt ganz klar.</p>
            </div>
            <ActionButton onClick={() => setCallbackOpen(true)}>
              <Phone size={20} />
              Rückruf ansehen
            </ActionButton>
          </header>
          <div className="cc-metrics">
            <MetricCard
              label="Meine Leads"
              value="—"
              context="Wartet auf freigegebene Daten"
              help="Anzahl und Zeitraum werden vom Backend geliefert. Diese Vorschau berechnet keine Kennzahlen."
              icon={<Users size={28} />}
            />
            <MetricCard
              label="Leadqualität"
              value="—"
              context="Bewertung aus Team-Management"
              help="Das Qualitätslevel wird serverseitig ermittelt."
              icon={<ShieldCheck size={28} />}
            />
            <MetricCard
              label="Tagesleistung"
              value="—"
              context="Deine bestätigten Ergebnisse"
              help="Nur bestätigte Ereignisse fließen in die Tagesleistung ein."
              icon={<Target size={28} />}
            />
            <MetricCard
              label="Wochenrang"
              value="—"
              context="Nach Statistikfreigabe verfügbar"
              help="Rang und Punkte kommen aus dem freigegebenen Statistikdienst."
              icon={<Trophy size={28} />}
            />
          </div>
          <div className="preview-work-grid">
            <Surface
              title="Dein nächstes Gespräch"
              description="Beispiel einer Anrufmaske"
              action={<StatusBadge tone="info">Offener Lead</StatusBadge>}
            >
              <div className="preview-lead">
                <div className="preview-company">
                  <span className="preview-monogram">MW</span>
                  <div>
                    <h2>{lead.company}</h2>
                    <p>{lead.contact}</p>
                  </div>
                </div>
                <div className="preview-contact">
                  <div>
                    <Phone size={20} />
                    <span>
                      <small>Telefon · Beispieldaten</small>
                      <strong>{lead.phone}</strong>
                    </span>
                  </div>
                  <div>
                    <MapPin size={20} />
                    <span>
                      <small>Adresse</small>
                      <strong>Musterstraße 12, Wien</strong>
                    </span>
                  </div>
                </div>
                <div className="preview-website">
                  Website <span>musterwerk.example</span>
                </div>
                <label className="preview-label" htmlFor="call-note">
                  Gesprächsnotiz{" "}
                  <InfoButton label="Notizen">
                    Der Entwurf bleibt beim Öffnen und Schließen des Rückrufdialogs erhalten. In
                    dieser Vorschau wird er nicht dauerhaft gespeichert.
                  </InfoButton>
                </label>
                <textarea
                  id="call-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Was ist für das nächste Gespräch wichtig?"
                />
                <div className="preview-draft">
                  <Check size={14} />
                  Lokaler Entwurf · bleibt beim Rückrufdialog erhalten
                </div>
                <div className="preview-outcomes">
                  <ActionButton variant="secondary" disabled>
                    Nicht erreicht
                  </ActionButton>
                  <ActionButton variant="secondary" onClick={() => setCallbackOpen(true)}>
                    <CalendarDays size={18} />
                    Rückruf ansehen
                  </ActionButton>
                </div>
                <p className="preview-footnote">
                  „Nicht erreicht“ ist ein internes Anrufergebnis, keine CRM-Stage.
                </p>
              </div>
            </Surface>
            <div className="preview-right">
              <Surface title="Jetzt im Fokus" description="Rückrufe und CRM-Status">
                <div className="preview-focus">
                  <button className="preview-callback" onClick={() => setCallbackOpen(true)}>
                    <span className="preview-callback-icon">
                      <Phone size={23} />
                    </span>
                    <span>
                      <strong>Ein Rückruf wartet</strong>
                      <small>Demodatensatz · Musterwerk</small>
                    </span>
                    <ArrowRight size={20} />
                  </button>
                  <SyncIndicator state={sync} />
                  <p className="preview-footnote">Vorgemerkt bedeutet noch nicht übertragen.</p>
                </div>
              </Surface>
              <section className="preview-mission" id="rewards">
                <Trophy size={34} />
                <h2>Fortschritt, der sich lohnt.</h2>
                <p>
                  Qualitätslevel, Wochenrang und echte Rewards. Sobald die Statistik freigegeben
                  ist.
                </p>
                <div>
                  <span>
                    <Coins size={18} />
                    Coins noch nicht aktiv
                  </span>
                  <span>
                    <Headphones size={18} />
                    Rewards in Vorbereitung
                  </span>
                </div>
              </section>
            </div>
          </div>
          <div id="komponenten" className="preview-component-grid">
            <Surface
              title="Status mit Bedeutung"
              description="CRM-Stage und Übertragung getrennt anzeigen"
            >
              <div className="preview-stack">
                <div className="preview-badges">
                  <StatusBadge>Warten auf Logo</StatusBadge>
                  <StatusBadge tone="info">Logo Render</StatusBadge>
                  <StatusBadge tone="info">Realistisches Render</StatusBadge>
                  <StatusBadge tone="warning">Zukunftsprojekt</StatusBadge>
                  <StatusBadge tone="success">Gewonnen</StatusBadge>
                </div>
                <label className="preview-label" htmlFor="sync-demo">
                  Übertragungszustand demonstrieren
                </label>
                <select
                  id="sync-demo"
                  value={sync}
                  onChange={(e) => setSync(e.target.value as SyncState)}
                >
                  <option value="queued">Vorgemerkt</option>
                  <option value="synced">Übertragen</option>
                  <option value="error">Fehler</option>
                  <option value="review">Prüfung erforderlich</option>
                </select>
                <SyncIndicator state={sync} />
              </div>
            </Surface>
            <Surface
              title="Jeder Zustand ist gestaltet"
              description="Laden, keine Treffer und Fehler"
            >
              <div className="preview-state-tabs" role="group" aria-label="Beispielzustand">
                {(["empty", "loading", "error"] as const).map((s) => (
                  <button key={s} aria-pressed={state === s} onClick={() => setState(s)}>
                    {s === "empty" ? "Leer" : s === "loading" ? "Laden" : "Fehler"}
                  </button>
                ))}
              </div>
              <FeedbackState
                kind={state}
                title={
                  state === "loading"
                    ? "Leads werden geladen"
                    : state === "error"
                      ? "Leads gerade nicht verfügbar"
                      : "Alles aufgeräumt"
                }
              >
                {state === "error"
                  ? "Bitte versuche es später erneut. Deine Eingaben bleiben erhalten."
                  : state === "loading"
                    ? "Deine Arbeitsliste wird vorbereitet."
                    : "Hier erscheinen deine zugewiesenen Leads."}
              </FeedbackState>
            </Surface>
          </div>
          <Surface
            title="Leads schnell erfassen"
            description="Tabellenmuster mit Suche und eindeutigen Statusanzeigen"
            action={<span className="preview-demo-tag">Beispieldatensatz</span>}
          >
            <div className="preview-toolbar">
              <label className="preview-search">
                <Search size={18} />
                <span className="preview-sr">Beispielleads durchsuchen</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Firma oder Kontakt suchen"
                />
              </label>
              <ActionButton variant="secondary" disabled>
                <ListFilter size={18} />
                Filter
              </ActionButton>
              <ActionButton variant="secondary" disabled>
                <Upload size={18} />
                Import
              </ActionButton>
              <ActionButton variant="secondary" disabled>
                <ArrowDownToLine size={18} />
                Exporte
              </ActionButton>
            </div>
            <div className="preview-table-wrap">
              <table>
                <caption className="preview-sr">
                  Beispielleads, keine produktiven Kundendaten
                </caption>
                <thead>
                  <tr>
                    <th>Firma / Kontakt</th>
                    <th>Markt</th>
                    <th>CRM-Stage</th>
                    <th>Verantwortlich</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {lead.company.toLowerCase().includes(query.toLowerCase()) ||
                  lead.contact.toLowerCase().includes(query.toLowerCase()) ? (
                    <tr>
                      <td>
                        <strong>{lead.company}</strong>
                        <small>{lead.contact}</small>
                      </td>
                      <td>Österreich</td>
                      <td>
                        <StatusBadge>Warten auf Logo</StatusBadge>
                      </td>
                      <td>Noch nicht zugewiesen</td>
                      <td>
                        <ActionButton variant="secondary" onClick={() => setCallbackOpen(true)}>
                          Ansehen
                          <ChevronRight size={16} />
                        </ActionButton>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={5}>
                        <FeedbackState kind="empty" title="Keine Treffer">
                          Passe deine Suche an.
                        </FeedbackState>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Surface>
          <Surface
            title="Kurzer Erfolg. Volle Kontrolle."
            description="Animation demonstrieren, ohne Coins oder Stages zu verändern"
          >
            <div className="preview-stack" id="einstellungen">
              <label className="preview-toggle">
                <span>
                  <Sparkles size={20} />
                  <strong>Erfolgsanimationen</strong>
                </span>
                <input
                  type="checkbox"
                  checked={animations}
                  onChange={(e) => setAnimations(e.target.checked)}
                />
              </label>
              <div className="preview-toggle">
                <span>
                  <Volume2 size={20} />
                  <strong>Sound</strong>
                </span>
                <span className="preview-demo-tag">Aus · später separat aktivierbar</span>
              </div>
              <p className="preview-footnote">
                Die Systemeinstellung für reduzierte Bewegung hat Vorrang. Es wird kein Ton
                abgespielt.
              </p>
              <ActionButton variant="secondary" onClick={() => setSuccess(true)}>
                <Trophy size={19} />
                Erfolgsvorschau starten
              </ActionButton>
              {success && (
                <SuccessBanner
                  title="Stark! Ein Abschluss mehr."
                  description="Gewonnen · reine Animationsvorschau, keine Punktevergabe"
                  animationsEnabled={animations}
                  onDismiss={() => setSuccess(false)}
                />
              )}
            </div>
          </Surface>
          <footer className="preview-footer">
            <CircleHelp size={17} />
            Frontend-Vorbereitung · Rollen, Werte und Aktionen werden nach Übergabe angebunden.
          </footer>
        </main>
      </div>
      <CallbackDialog
        open={callbackOpen}
        onOpenChange={setCallbackOpen}
        callback={lead}
        onCall={() => setCallbackOpen(false)}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
