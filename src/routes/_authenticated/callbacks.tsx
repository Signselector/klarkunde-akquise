import { useState } from "react";
import { calendarStatus, STATUS_DOT } from "@/lib/calendar-status";
import { EntryDetailCard, WeekCalendar, inWeek, sameDay, startOfWeek, type WeekEntry } from "@/components/caller/week-calendar";
import { Building2, Phone, User } from "lucide-react";
import { FeedbackState, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { LeadDialog } from "@/components/caller/lead-dialog";
import { useCountry } from "@/lib/country";
import { CalendarSyncStatus, useCalendarSync } from "@/lib/use-calendar-sync";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/callbacks")({
  head: () => ({ meta: [{ title: "Callbacks – Sign Selector Cold Caller" }] }),
  component: CallbacksPage,
});

function CallbacksPage() {
  const { user } = Route.useRouteContext();
  const [day, setDay] = useState<Date | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [leadId, setLeadId] = useState<string | null>(null);
  const country = useCountry();
  const { sync } = useCalendarSync(user.id, country);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["callbacks", user.id, country],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("callbacks")
        .select("*,lead:leads(id,company,contact_name,phone)")
        .eq("country", country)
        .eq("user_id", user.id)
        .eq("done", false)
        .order("due_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const now = new Date();
  const isToday = (d: Date) => sameDay(d, now);
  // Calendar and list show the chosen week; a chosen day narrows the list to that day.
  const weekRows = (data ?? []).filter((c) => inWeek(new Date(c.due_at), weekStart));
  const visible = weekRows.filter((c) => !day || sameDay(new Date(c.due_at), day));
  const weekEntries = weekRows.map((c) => ({
    id: c.id,
    at: new Date(c.due_at),
    title: c.lead?.company ? `Rückruf: ${c.lead.company}` : "Rückruf",
    dot: STATUS_DOT[calendarStatus(c.due_at, c.done, now)],
    kind: "call" as const,
    durationMin: 15,
    done: c.done,
  }));
  const renderDetail = (entry: WeekEntry, close: () => void) => {
    const c = weekRows.find((r) => r.id === entry.id);
    if (!c) return null;
    const note = [c.lead?.company ? `Kunde: ${c.lead.company}` : null, c.lead?.phone ? `Telefon: ${c.lead.phone}` : null].filter(Boolean).join(" ") || null;
    return (
      <EntryDetailCard
        entry={entry}
        note={note}
        rows={[
          ...(c.lead?.contact_name ? [{ icon: User, text: c.lead.contact_name }] : []),
          ...(c.lead?.phone ? [{ icon: Phone, text: <a className="text-primary hover:underline" href={`tel:${c.lead.phone}`}>{c.lead.phone}</a> }] : []),
          ...(c.lead?.company ? [{ icon: Building2, text: c.lead.company }] : []),
        ]}
        footer={
          <Button className="ml-auto" variant="outline" onClick={() => { close(); setLeadId(c.lead?.id ?? null); }}>
            Kundenakte öffnen
          </Button>
        }
      />
    );
  };
  // Overdue callbacks of earlier weeks would otherwise be out of sight.
  const earlierOverdue = (data ?? []).filter(
    (c) => new Date(c.due_at) < weekStart && new Date(c.due_at) < now,
  );
  return (
    <div className="cc-page">
      <PageHeading
        title="Rückrufe"
        description="Deine vereinbarten Gespräche. Fällige Rückrufe erscheinen zusätzlich als Erinnerung."
      />
      <div className="grid items-start gap-5">
        <WeekCalendar
          ariaLabel="Rückrufkalender"
          entries={weekEntries}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          selected={day}
          onSelect={setDay}
          loading={isLoading}
          renderDetail={renderDetail}
          kinds={["call"]}
          footer={
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className={`size-2 rounded-full ${STATUS_DOT.overdue}`} /> Überfällig
              </span>
              <span className="flex items-center gap-1">
                <span className={`size-2 rounded-full ${STATUS_DOT.upcoming}`} /> Geplant
              </span>
              {day && (
                <Button size="sm" variant="outline" onClick={() => setDay(null)}>
                  Ganze Woche anzeigen
                </Button>
              )}
              {earlierOverdue.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDay(null);
                    setWeekStart(startOfWeek(new Date(earlierOverdue[0]!.due_at)));
                  }}
                >
                  {earlierOverdue.length} überfällig in früheren Wochen
                </Button>
              )}
              <div className="w-full">
                <CalendarSyncStatus sync={sync} />
              </div>
            </div>
          }
        />
        <Surface
          title="Geplante Rückrufe"
          description="Datum und Uhrzeit sind beim Vereinbaren verpflichtend"
        >
          <div className="cc-surface-body">
            {isError && (
              <FeedbackState
                kind="error"
                title="Rückrufe nicht verfügbar"
                action={<Button onClick={() => refetch()}>Erneut versuchen</Button>}
              />
            )}
            {isLoading && <FeedbackState kind="loading" title="Rückrufe werden geladen" />}
            {data && visible.length === 0 && (
              <FeedbackState
                kind="empty"
                title={day ? "Keine Rückrufe an diesem Tag" : "Keine Rückrufe in dieser Woche"}
              >
                {day
                  ? "Wähle einen anderen Tag oder zeige die ganze Woche an."
                  : "Blättere zu einer anderen Woche. Vereinbarte Rückrufe erscheinen hier."}
              </FeedbackState>
            )}
            <div className="space-y-2">
              {visible.map((c) => {
                const due = new Date(c.due_at);
                const overdue = due < now;
                const today = isToday(due);
                return (
                  <div
                    key={c.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${overdue ? "border-destructive/50 bg-destructive/5" : today ? "border-primary/50 bg-primary/5" : "bg-card"}`}
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">{c.lead?.company || "Ohne Firmenname"}</p>
                      <p className="text-sm text-muted-foreground">
                        {[c.lead?.contact_name, c.lead?.phone].filter(Boolean).join(" · ")}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span
                          className={`size-2 shrink-0 rounded-full ${STATUS_DOT[calendarStatus(c.due_at, c.done, now)]}`}
                          aria-hidden="true"
                        />
                        <span>{due.toLocaleString("de-DE")}</span>
                        {overdue ? (
                          <Badge variant="destructive">Überfällig</Badge>
                        ) : today ? (
                          <Badge>Heute fällig</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="cc-record-btn"
                        onClick={() => setLeadId(c.lead?.id ?? null)}
                      >
                        Kundenakte öffnen
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">
              Rückruf vereinbaren oder Ergebnis ändern: Öffne den Lead unter{" "}
              <Link to="/leads" className="underline">
                Offene Leads
              </Link>
              .
            </p>
          </div>
        </Surface>
      </div>
      <LeadDialog
        leadId={leadId}
        userId={user.id}
        admin={false}
        leadIds={(data ?? []).map((c) => c.lead?.id).filter((id): id is string => !!id)}
        onNavigate={setLeadId}
        onClose={() => setLeadId(null)}
      />
    </div>
  );
}
