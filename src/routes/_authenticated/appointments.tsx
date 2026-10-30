import { WeekCalendar, inWeek, sameDay, startOfWeek, type WeekEntry } from "@/components/caller/week-calendar";
import { appointmentDotClass } from "@/lib/calendar-status";
import { useServerFn } from "@tanstack/react-start";
import { pushAppointmentNow } from "@/lib/calendar-sync.functions";
import { notifyShowroomFn } from "@/lib/showroom-sync.functions";
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCountry } from "@/lib/country";
import { cn } from "@/lib/utils";
import { useRoles } from "@/lib/use-admin";
import { CalendarSyncStatus, useCalendarSync } from "@/lib/use-calendar-sync";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { LeadDialog } from "@/components/caller/lead-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  discovery: { label: "Erstgespräch" },
  presentation: { label: "Präsentation / Demo" },
  closing: { label: "Angebot / Abschluss" },
  onsite: { label: "Vor-Ort / Aufmaß" },
  followup: { label: "Follow-up" },
  internal: { label: "Intern / Coaching" },
  other: { label: "Sonstiges" },
} as const;
type Kind = keyof typeof KINDS;
const kindOf = (k: string | null | undefined): Kind => (k && k in KINDS ? (k as Kind) : "other");


function AppointmentsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const country = useCountry();
  const roles = useRoles(user.id);
  const pushNow = useServerFn(pushAppointmentNow);
  const showroom = useServerFn(notifyShowroomFn);
  const { sync, external } = useCalendarSync(user.id, country);
  const [mine] = useState(false);
  // "all": everything, "tool": booked through the Cold Caller tool, "pipedrive": entries that exist in Pipedrive only.
  const [filter, setFilter] = useState<"all" | "tool" | "pipedrive">("all");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selected, setSelected] = useState<Date | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["appointments", country],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id,starts_at,notes,title,kind,user_id,booked_by,lead_id,outcome,lead:leads(company,contact_name,phone)")
        .eq("country", country)
        .order("starts_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const events = useMemo(() => {
    const own = (data ?? [])
      // Callers and Senior Callers only ever see appointments assigned to them (also enforced by the database).
      .filter((a) => (!mine && roles.isStaff ? true : a.user_id === user.id) && filter !== "pipedrive")
      .map((a) => ({ ...a, date: new Date(a.starts_at), k: kindOf(a.kind) }));
    // Entries that exist only in the user's Pipedrive calendar.
    const fromPipedrive =
      filter !== "tool"
        ? external
            .filter((x) => roles.isStaff || (x as { user_id?: string }).user_id === user.id)
            .map((x) => ({
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
  }, [data, external, mine, filter, user.id, roles.isStaff]);

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
      // Managers may hand appointments only to Senior Callers (or keep them).
      const { data: rl } = await supabase.from("user_roles").select("user_id,role").in("user_id", rows.map((r) => r.id));
      const vets = new Set((rl ?? []).filter((x) => x.role === "veteran").map((x) => x.user_id));
      const list = rows.filter((r) => r.id === user.id || vets.has(r.id));
      if (!list.some((r) => r.id === user.id)) list.unshift({ id: user.id, name: "Ich" });
      return list;
    },
  });
  // New appointments of Callers wait here for a decision of a manager: take it or hand it over.
  const pending = useQuery({
    queryKey: ["appointments", "pending", country],
    enabled: roles.isStaff,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id,starts_at,title,notes,booked_by,lead_id,lead:leads(company,contact_name,phone,email,city)")
        .eq("country", country)
        .eq("decision_pending", true)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at");
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((r) => r.booked_by).filter((v): v is string => !!v))];
      const { data: people } = ids.length
        ? await supabase.from("profiles").select("id,display_name,email").in("id", ids)
        : { data: [] };
      const name = new Map((people ?? []).map((p) => [p.id, p.display_name || p.email || "Caller"]));
      return (data ?? []).map((r) => ({ ...r, bookedByName: r.booked_by ? (name.get(r.booked_by) ?? "Caller") : "Caller" }));
    },
  });

  const queue = pending.data ?? [];
  const next = queue[0] ?? null;
  const [fileLead, setFileLead] = useState<string | null>(null);
  // Set when the customer file is opened from an appointment of the list: then it offers the showroom results.
  const [fileAppt, setFileAppt] = useState<{ id: string; title: string; startsAt: string; outcome: string | null } | null>(null);
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

  const refresh = () => qc.invalidateQueries({ queryKey: ["appointments"] });

  const weekEntries: WeekEntry[] = events.map((e) => ({
    id: e.id,
    at: e.date,
    title: e.title ?? e.lead?.company ?? e.notes ?? "Termin",
    dot: appointmentDotClass(e.date, "external" in e && !!e.external),
  }));
  // Details: a chosen day in full. The overview of the week lists everything upcoming plus only the last three past
  // entries, so finished appointments do not push the coming ones out of sight.
  const dayChosen = !!selected && inWeek(selected, weekStart);
  const nowMs = Date.now();
  const inShownWeek = events.filter((e) => inWeek(e.date, weekStart));
  const list = dayChosen
    ? events.filter((e) => sameDay(e.date, selected))
    : [
        ...inShownWeek.filter((e) => e.date.getTime() < nowMs).slice(-3),
        ...inShownWeek.filter((e) => e.date.getTime() >= nowMs),
      ];

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
      </header>

      {isError && <p className="text-destructive">Termine konnten nicht geladen werden.</p>}

      {roles.isStaff && next && (
        <section className="cc-decision-card cc-decision-card--queue" aria-label="Neuer Termin" aria-live="polite" key={next.id}>
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">
              Neuer Termin · {1} von {queue.length}
            </p>
            <p className="text-xs text-muted-foreground">Bitte entscheiden: selbst wahrnehmen oder übergeben</p>
          </div>
          <div className="grid w-full gap-3 md:grid-cols-[1.2fr_1fr]">
            <div className="min-w-0">
              <p className="text-base font-semibold">{next.title ?? next.lead?.company ?? "Termin"}</p>
              <p className="text-sm">
                {new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(next.starts_at))}{" "}
                Uhr · gebucht von {next.bookedByName}
              </p>
              {next.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{next.notes}</p>}
            </div>
            <dl className="grid content-start gap-1 rounded-xl bg-white/70 p-3 text-sm">
              <dt className="text-xs font-semibold uppercase text-muted-foreground">Kundenakte</dt>
              <dd className="font-medium">{next.lead?.company ?? "–"}</dd>
              {next.lead?.contact_name && <dd>{next.lead.contact_name}</dd>}
              {next.lead?.phone && (
                <dd>
                  <a className="text-primary hover:underline" href={`tel:${next.lead.phone}`}>{next.lead.phone}</a>
                </dd>
              )}
              {next.lead?.email && <dd className="truncate">{next.lead.email}</dd>}
              {next.lead?.city && <dd>{next.lead.city}</dd>}
              {next.lead_id && (
                <dd className="pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFileAppt(null);
                      setFileLead(next.lead_id);
                    }}
                  >
                    Kundenakte öffnen
                  </Button>
                </dd>
              )}
            </dl>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2">
            <Button onClick={() => void assign(next.id, user.id)}>Selbst wahrnehmen</Button>
            <Dropdown
              className="min-h-10"
              ariaLabel="Termin übergeben"
              placeholder="An Senior Caller übergeben …"
              value=""
              options={(team.data ?? []).filter((t) => t.id !== user.id).map((t) => ({ value: t.id, label: t.name }))}
              onChange={(v) => v && void assign(next.id, v)}
            />
          </div>
        </section>
      )}

      <div className="grid gap-4">
        <WeekCalendar
          ariaLabel="Wochenansicht"
          entries={weekEntries}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          selected={selected}
          onSelect={setSelected}
          loading={isLoading}
          footer={
          <div className="flex flex-wrap items-center gap-3">
            <Label className="text-xs">Anzeigen</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as "all" | "tool" | "pipedrive")}>
              <SelectTrigger className="min-h-11 w-[320px] max-w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Termine</SelectItem>
                <SelectItem value="tool">Cold Caller Tool</SelectItem>
                <SelectItem value="pipedrive">Pipedrive</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className={cn("size-2 rounded-full", appointmentDotClass(new Date(Date.now() + 1)))} /> Cold Caller Tool
              </span>
              <span className="flex items-center gap-1">
                <span className={cn("size-2 rounded-full", appointmentDotClass(new Date(Date.now() + 1), true))} /> Pipedrive
              </span>
              <span className="flex items-center gap-1">
                <span className={cn("size-2 rounded-full", appointmentDotClass(new Date(0)))} /> Vergangen
              </span>
            </div>
          </div>
          }
        />

        <aside className="rounded-lg border bg-card p-5" aria-label="Terminliste">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              {selected && inWeek(selected, weekStart)
                ? new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(selected)
                : "Termine der Woche"}
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
                    <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", appointmentDotClass(e.date, "external" in e && !!e.external))} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {heading}
                        {"external" in e && e.external && (
                          <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800">Pipedrive</span>
                        )}
                      </p>
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
                      {"outcome" in e && e.outcome && (
                        <p className="mt-1 text-xs font-semibold text-primary">
                          Ergebnis: {{ no_show: "Termin nicht wahrgenommen", low_interest: "Wenig interessiert", medium_interest: "Mittleres Interesse", high_interest: "Sehr interessiert" }[e.outcome as string] ?? e.outcome}
                        </p>
                      )}
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
                    {"lead_id" in e && e.lead_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setFileAppt({ id: e.id, title: heading, startsAt: e.starts_at, outcome: "outcome" in e ? (e.outcome ?? null) : null });
                          setFileLead(e.lead_id);
                        }}
                      >
                        Kundenakte
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>

      <LeadDialog
        leadId={fileLead}
        userId={user.id}
        appointment={fileAppt}
        onClose={() => {
          setFileLead(null);
          setFileAppt(null);
        }}
      />
    </div>
  );
}

function toDateInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
