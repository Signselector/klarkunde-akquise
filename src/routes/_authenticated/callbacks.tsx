import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MonthCalendar, sameDay } from "@/components/caller/month-calendar";
import { FeedbackState, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { LeadDialog } from "@/components/caller/lead-dialog";
import { backendEnabled } from "@/lib/backend";
import { useCountry } from "@/lib/country";
import { CalendarSyncStatus, useCalendarSync } from "@/lib/use-calendar-sync";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/callbacks")({
  head: () => ({ meta: [{ title: "Callbacks – Sign Selector Cold Caller" }] }),
  component: CallbacksPage,
});

function CallbacksPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [day, setDay] = useState<Date | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const country = useCountry();
  const { sync, external } = useCalendarSync(user.id, country);
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

  async function done(id: string) {
    if (finishing) return;
    setFinishing(true);
    const { error } = await (backendEnabled
      ? supabase.rpc("complete_callback", {
          p_request_id: crypto.randomUUID(),
          p_callback_id: id,
          p_expected_version: data?.find((c) => c.id === id)?.version ?? -1,
        })
      : supabase.from("callbacks").update({ done: true }).eq("id", id));
    setFinishing(false);
    setConfirmId(null);
    if (error) {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["callbacks"] });
      return;
    }
    toast.success("Rückruf als erledigt markiert.");
    qc.invalidateQueries({ queryKey: ["callbacks"] });
  }

  const now = new Date();
  const visible = (data ?? []).filter((c) => !day || sameDay(new Date(c.due_at), day));
  const isToday = (d: Date) => sameDay(d, now);
  const markersOf = (d: Date) => [
    ...(data ?? [])
      .filter((c) => sameDay(new Date(c.due_at), d))
      .map((c) => {
        const due = new Date(c.due_at);
        return {
          id: c.id,
          dot: due < now ? "bg-destructive" : isToday(due) ? "bg-primary" : "bg-chart-2",
        };
      }),
    ...external
      .filter((x) => sameDay(new Date(x.due_at), d))
      .map((x) => ({ id: `pd-${x.activity_id}`, dot: "bg-chart-4" })),
  ];
  const externalVisible = external.filter((x) =>
    day ? sameDay(new Date(x.due_at), day) : new Date(x.due_at) >= now,
  );
  return (
    <div className="cc-page">
      <PageHeading
        title="Rückrufe"
        description="Deine vereinbarten Gespräche. Fällige Rückrufe erscheinen zusätzlich als Erinnerung."
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <MonthCalendar
          ariaLabel="Rückrufkalender"
          markersOf={markersOf}
          selected={day}
          onSelect={setDay}
          loading={isLoading}
          footer={
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-destructive" /> Überfällig
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-primary" /> Heute
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-chart-2" /> Geplant
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-chart-4" /> Aus Pipedrive
              </span>
              {day && (
                <Button size="sm" variant="outline" onClick={() => setDay(null)}>
                  Alle Rückrufe anzeigen
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
                title={day ? "Keine Rückrufe an diesem Tag" : "Keine offenen Rückrufe"}
              >
                {day
                  ? "Wähle einen anderen Tag oder zeige alle Rückrufe an."
                  : "Vereinbarte Rückrufe erscheinen hier."}
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
                        <span>{due.toLocaleString("de-DE")}</span>
                        {overdue ? (
                          <Badge variant="destructive">Überfällig</Badge>
                        ) : today ? (
                          <Badge>Heute fällig</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setLeadId(c.lead?.id ?? null)}
                      >
                        Kundenakte öffnen
                      </Button>
                      {c.lead?.phone && (
                        <Button asChild size="sm">
                          <a href={`tel:${c.lead.phone}`}>Anrufen</a>
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setConfirmId(c.id)}>
                        Erledigt
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {externalVisible.length > 0 && (
              <div className="space-y-2" aria-label="Weitere Aktivitäten aus Pipedrive">
                <h3 className="text-sm font-semibold">Weitere Aktivitäten aus Pipedrive</h3>
                {externalVisible.slice(0, 20).map((x) => (
                  <div key={x.activity_id} className="rounded-lg border bg-card p-3 text-sm">
                    <p className="font-medium">{x.subject || "Aktivität"}</p>
                    <p className="text-muted-foreground">
                      {new Date(x.due_at).toLocaleString("de-DE")}
                      {[x.person_name, x.org_name].filter(Boolean).length > 0 &&
                        ` · ${[x.person_name, x.org_name].filter(Boolean).join(", ")}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
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
      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && !finishing && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rückruf ohne Ergebnis erledigen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Rückruf verschwindet aus der Liste. Das Gesprächsergebnis wird dadurch nicht
              erfasst. Trage es dafür im Anrufablauf ein.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={finishing}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={finishing}
              onClick={(e) => {
                e.preventDefault();
                if (confirmId) void done(confirmId);
              }}
            >
              Nur erledigen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LeadDialog leadId={leadId} userId={user.id} admin={false} onClose={() => setLeadId(null)} />
    </div>
  );
}
