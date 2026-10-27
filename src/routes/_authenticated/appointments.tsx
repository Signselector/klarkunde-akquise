import { calendarStatus, STATUS_DOT } from "@/lib/calendar-status";
import { useServerFn } from "@tanstack/react-start";
import { pushAppointmentNow } from "@/lib/calendar-sync.functions";
import { SlotPicker } from "@/components/booking/slot-picker";
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, Phone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { backendEnabled } from "@/lib/backend";
import { useCountry } from "@/lib/country";
import { cn } from "@/lib/utils";
import { useRoles } from "@/lib/use-admin";
import { CalendarSyncStatus, useCalendarSync } from "@/lib/use-calendar-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/appointments")({
  head: () => ({
    meta: [
      { title: "Terminkalender – Sign Selector Cold Caller" },
      { name: "description", content: "Monatskalender mit allen Vertriebsterminen nach Terminart." },
      { property: "og:title", content: "Terminkalender – Sign Selector Cold Caller" },
      { property: "og:description", content: "Alle Termine der Caller im Überblick." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppointmentsPage,
});

const KINDS = {
  discovery: { label: "Erstgespräch", dot: "bg-primary" },
  presentation: { label: "Präsentation / Demo", dot: "bg-chart-1" },
  closing: { label: "Angebot / Abschluss", dot: "bg-chart-5" },
  onsite: { label: "Vor-Ort / Aufmaß", dot: "bg-chart-4" },
  followup: { label: "Follow-up", dot: "bg-chart-2" },
  internal: { label: "Intern / Coaching", dot: "bg-chart-3" },
  other: { label: "Sonstiges", dot: "bg-muted-foreground" },
} as const;
type Kind = keyof typeof KINDS;
const kindOf = (k: string | null | undefined): Kind => (k && k in KINDS ? (k as Kind) : "other");

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function AppointmentsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const country = useCountry();
  const roles = useRoles(user.id);
  const pushNow = useServerFn(pushAppointmentNow);
  const { sync, external } = useCalendarSync(user.id, country);
  const [mine] = useState(false);
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selected, setSelected] = useState<Date | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["appointments", country],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id,starts_at,notes,title,kind,user_id,booked_by,lead:leads(company,contact_name,phone)")
        .eq("country", country)
        .order("starts_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const events = useMemo(() => {
    const own = (data ?? [])
      .filter((a) => (!mine || a.user_id === user.id) && (filter === "all" || kindOf(a.kind) === filter))
      .map((a) => ({ ...a, date: new Date(a.starts_at), k: kindOf(a.kind) }));
    // Entries that exist only in the user's Pipedrive calendar.
    const fromPipedrive =
      filter === "all" || filter === "other"
        ? external.map((x) => ({
            id: `pd-${x.activity_id}`,
            starts_at: x.due_at,
            notes: [x.person_name, x.org_name].filter(Boolean).join(", ") || null,
            title: x.subject,
            kind: "other" as string | null,
            user_id: user.id,
            lead: null,
            date: new Date(x.due_at),
            k: "other" as Kind,
            external: true as const,
          }))
        : [];
    return [...own, ...fromPipedrive].sort((p, q) => p.date.getTime() - q.date.getTime());
  }, [data, external, mine, filter, user.id]);

  const team = useQuery({
    queryKey: ["appointment-team", country],
    enabled: roles.isStaff,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_countries")
        .select("user_id,profile:profiles(display_name,email,active)")
        .eq("country", country);
      if (error) throw error;
      const rows = (data ?? [])
        .filter((r) => r.profile?.active !== false)
        .map((r) => ({ id: r.user_id, name: r.profile?.display_name || r.profile?.email || "Unbekannt" }));
      if (!rows.some((r) => r.id === user.id)) rows.unshift({ id: user.id, name: "Ich" });
      return rows;
    },
  });
  const nameOf = (id: string | null | undefined) =>
    id === user.id ? "dir" : (team.data?.find((t) => t.id === id)?.name ?? "jemand anderem");

  async function assign(id: string, to: string) {
    const { error } = await supabase.rpc("assign_appointment", { p_appointment_id: id, p_user_id: to });
    if (error) { toast.error("Termin konnte nicht zugewiesen werden."); return; }
    toast.success(to === user.id ? "Du nimmst den Termin selbst wahr." : "Termin zugewiesen. Die Person wird sofort benachrichtigt.");
    refresh();
    // The appointment moves to the calendar of its new owner in Pipedrive right away.
    void pushNow({ data: { appointmentId: id } }).catch(() => undefined);
  }

  // Appointments have no "done" flag: one that already took place counts as done (grey). Pipedrive-only entries
  // are loaded only while open; one in the past is overdue (red).
  const dotOf = (e: { date: Date; external?: true }) =>
    STATUS_DOT[
      "external" in e && e.external
        ? calendarStatus(e.date, false)
        : e.date < new Date()
          ? "done"
          : "upcoming"
    ];

  const refresh = () => qc.invalidateQueries({ queryKey: ["appointments"] });

  async function remove(id: string) {
    const { error } = await (backendEnabled
      ? supabase.rpc("delete_appointment", { p_appointment_id: id })
      : supabase.from("appointments").delete().eq("id", id));
    if (error) { toast.error(error.message); return; }
    toast.success("Termin gelöscht.");
    refresh();
  }

  const y = month.getFullYear();
  const m = month.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: days }, (_, i) => new Date(y, m, i + 1)),
  ];
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const ofDay = (d: Date) => events.filter((e) => sameDay(e.date, d));
  const list = selected ? ofDay(selected) : events.filter((e) => e.date >= startToday).slice(0, 15);

  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-[22px] font-semibold">Terminkalender</h1>
          <p className="text-sm text-muted-foreground">
            {roles.isStaff
              ? `Alle Termine des Teams für ${country}. Nimm sie selbst wahr oder weise sie zu.`
              : `Deine Termine für ${country}, abgeglichen mit deinem Pipedrive-Kalender.`}
          </p>
          <CalendarSyncStatus sync={sync} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {roles.canBookAppointments ? (
            <Button className="min-h-11" onClick={() => setShowForm((s) => !s)}>
              <CalendarPlus /> Termin anlegen
            </Button>
          ) : (
            roles.ready && (
              <p className="max-w-xs text-sm text-muted-foreground">
                Termine bucht dein Manager. Als Senior Caller buchst du sie selbst.
              </p>
            )
          )}
        </div>
      </header>

      {showForm && roles.canBookAppointments && (
        <EventForm
          country={country}
          canSelfAssign={roles.role === "veteran"}
          initialDate={selected}
          onCreated={() => {
            setShowForm(false);
            refresh();
            void sync.refetch();
          }}
        />
      )}

      {isError && <p className="text-destructive">Termine konnten nicht geladen werden.</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <section className="rounded-lg border bg-card p-4 sm:p-5" aria-label="Monatsansicht">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" aria-label="Vorheriger Monat" onClick={() => setMonth(new Date(y, m - 1, 1))}>
              <ChevronLeft />
            </Button>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold capitalize">
                {new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(month)}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                  setSelected(today);
                }}
              >
                Heute
              </Button>
            </div>
            <Button variant="ghost" size="icon" aria-label="Nächster Monat" onClick={() => setMonth(new Date(y, m + 1, 1))}>
              <ChevronRight />
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase text-muted-foreground">
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
              <span key={d} className="py-1">{d}</span>
            ))}
          </div>
          <div className={cn("mt-1 grid grid-cols-7 gap-1", isLoading && "animate-pulse opacity-60")}>
            {cells.map((day, i) => {
              if (!day) return <div key={`e${i}`} />;
              const items = ofDay(day);
              const isToday = sameDay(day, today);
              const isSel = selected != null && sameDay(day, selected);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => setSelected(isSel ? null : day)}
                  className={cn(
                    "flex min-h-12 flex-col items-center gap-1 rounded-md border border-transparent p-1.5 text-sm transition-colors hover:border-primary/40 sm:min-h-16",
                    isSel && "border-primary bg-accent/40",
                    isToday && !isSel && "border-border bg-secondary",
                  )}
                >
                  <span className={cn("grid size-7 place-items-center rounded-full", isToday && "bg-primary font-bold text-primary-foreground")}>
                    {day.getDate()}
                  </span>
                  {items.length > 0 && (
                    <span className="flex items-center gap-0.5">
                      {items.slice(0, 3).map((e) => (
                        <span key={e.id} className={cn("size-1.5 rounded-full", dotOf(e))} />
                      ))}
                      {items.length > 3 && <span className="text-[9px] text-muted-foreground">+{items.length - 3}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
            <Label className="text-xs">Terminart</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as Kind | "all")}>
              <SelectTrigger className="min-h-11 w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Terminarten</SelectItem>
                {Object.entries(KINDS).map(([v, k]) => (
                  <SelectItem key={v} value={v}>{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className={cn("size-2 rounded-full", STATUS_DOT.upcoming)} /> Geplant
              </span>
              <span className="flex items-center gap-1">
                <span className={cn("size-2 rounded-full", STATUS_DOT.overdue)} /> Überfällig
              </span>
              <span className="flex items-center gap-1">
                <span className={cn("size-2 rounded-full", STATUS_DOT.done)} /> Vergangen
              </span>
            </div>
          </div>
        </section>

        <aside className="rounded-lg border bg-card p-5" aria-label="Terminliste">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              {selected
                ? new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(selected)
                : "Kommende Termine"}
            </h2>
            {selected && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Alle anzeigen</Button>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {list.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Keine Termine in diesem Zeitraum.</p>
            ) : (
              list.map((e) => {
                const heading = e.title ?? e.lead?.company ?? e.notes ?? "Termin";
                return (
                  <div key={e.id} className="flex items-start gap-3 rounded-md border p-3">
                    <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", dotOf(e))} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{heading}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {KINDS[e.k].label} ·{" "}
                        {new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(e.date)}
                      </p>
                      {e.lead && (
                        <p className="mt-1 text-xs">
                          {e.lead.company}
                          {e.lead.contact_name ? ` · ${e.lead.contact_name}` : ""}
                        </p>
                      )}
                      {e.lead?.phone && (
                        <a href={`tel:${e.lead.phone}`} className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
                          <Phone className="size-3" /> {e.lead.phone}
                        </a>
                      )}
                      {e.notes && e.notes !== heading && <p className="mt-1 text-xs text-muted-foreground">{e.notes}</p>}
                      {roles.isStaff && !("external" in e) && (
                        <div className="mt-2 space-y-1">
                          {"booked_by" in e && e.booked_by && e.booked_by !== e.user_id && (
                            <p className="text-xs text-muted-foreground">Gebucht von {nameOf(e.booked_by)}</p>
                          )}
                          <Select value={e.user_id ?? ""} onValueChange={(v) => void assign(e.id, v)}>
                            <SelectTrigger className="min-h-9 w-full text-xs" aria-label="Zuständig">
                              <SelectValue placeholder="Zuständig wählen" />
                            </SelectTrigger>
                            <SelectContent>
                              {(team.data ?? []).map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.id === user.id ? "Selbst wahrnehmen" : `Zuweisen an ${t.name}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    {e.user_id === user.id && !("external" in e) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`${heading} löschen`}>
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Termin löschen?</AlertDialogTitle>
                            <AlertDialogDescription>„{heading}" wird dauerhaft entfernt.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(e.id)}>Löschen</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function toDateInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function EventForm({ country, canSelfAssign, initialDate, onCreated }: { country: string; canSelfAssign: boolean; initialDate: Date | null; onCreated: () => void }) {
  const [selfAssign, setSelfAssign] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>("presentation");
  const [date, setDate] = useState(initialDate ? toDateInput(initialDate) : "");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function save() {
    if (!title.trim() || !date || !time) { toast.error("Bitte Titel, Datum und Uhrzeit angeben."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("save_calendar_appointment", {
      p_starts_at: new Date(`${date}T${time}:00`).toISOString(),
      p_kind: kind,
      p_title: title.trim(),
      p_notes: notes,
      p_country: country,
      p_self: canSelfAssign && selfAssign,
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("slot_full")
          ? "Dieser Zeitpunkt ist ausgebucht (maximal 2 Termine gleichzeitig). Bitte wähle eine andere Zeit."
          : "Termin konnte nicht angelegt werden.",
      );
      void qc.invalidateQueries({ queryKey: ["slots"] });
      return;
    }
    toast.success(canSelfAssign && !selfAssign ? "Termin angelegt und an den Manager übergeben." : "Termin angelegt.");
    void qc.invalidateQueries({ queryKey: ["slots"] });
    onCreated();
  }

  return (
    <section className="rounded-lg border border-primary/30 bg-card p-5" aria-label="Neuer Termin">
      <h2 className="font-semibold">Neuer Termin</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Label htmlFor="ev-title">Titel</Label>
          <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="mt-2 min-h-11" placeholder="z. B. Demo Leuchtwerbung bei Muster GmbH" />
        </div>
        <div>
          <Label>Terminart</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <SelectTrigger className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(KINDS).map(([v, k]) => (
                <SelectItem key={v} value={v}>{k.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2 lg:col-span-3">
          <Label>Datum und Uhrzeit</Label>
          <div className="mt-2">
            <SlotPicker
              kind="appointment"
              country={country}
              initialDay={initialDate}
              value={date && time ? new Date(`${date}T${time}`).toISOString() : null}
              onChange={(iso) => {
                if (!iso) { setDate(""); setTime(""); return; }
                const d = new Date(iso);
                setDate(toDateInput(d));
                setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
              }}
            />
          </div>
        </div>
        <div className="md:col-span-2 lg:col-span-3">
          <Label htmlFor="ev-notes">Notizen (optional)</Label>
          <Textarea id="ev-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} className="mt-2 resize-none" />
        </div>
      </div>
      {canSelfAssign && (
        <label className="mt-4 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={selfAssign} onChange={(e) => setSelfAssign(e.target.checked)} />
          Mir selbst zuweisen (sonst entscheidet der Manager)
        </label>
      )}
      <Button className="mt-4 min-h-11" disabled={busy} onClick={save}>
        {busy ? "Wird angelegt …" : "Termin speichern"}
      </Button>
    </section>
  );
}
