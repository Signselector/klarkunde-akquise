import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { de } from "date-fns/locale";
import { FeedbackState, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { LeadDialog } from "@/components/caller/lead-dialog";
import { backendEnabled } from "@/lib/backend";
import { useCountry } from "@/lib/country";
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
  const [day, setDay] = useState<Date | undefined>();
  const [leadId, setLeadId] = useState<string | null>(null);
  const country = useCountry();
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
    const { error } = await (backendEnabled
      ? supabase.rpc("complete_callback", {
          p_request_id: crypto.randomUUID(),
          p_callback_id: id,
          p_expected_version: data?.find((c) => c.id === id)?.version ?? -1,
        })
      : supabase.from("callbacks").update({ done: true }).eq("id", id));
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["callbacks"] });
  }

  const now = new Date();
  const sameDay = (d: Date) => d.toDateString() === now.toDateString();
  return (
    <div className="cc-page">
      <PageHeading
        title="Rückrufe"
        description="Deine vereinbarten Gespräche. Fällige Rückrufe erscheinen zusätzlich als Erinnerung."
      />
      <div className="grid items-start gap-5 lg:grid-cols-[auto_1fr]">
        <Surface title="Rückrufkalender" description="Tag auswählen, um die Liste zu filtern">
          <Calendar
            mode="single"
            selected={day}
            onSelect={setDay}
            locale={de}
            modifiers={{ callback: (data ?? []).map((c) => new Date(c.due_at)) }}
            modifiersClassNames={{
              callback: "font-bold underline decoration-primary decoration-2 underline-offset-4",
            }}
          />
          {day && (
            <Button variant="outline" onClick={() => setDay(undefined)}>
              Alle Rückrufe anzeigen
            </Button>
          )}
        </Surface>
        <Surface
          title="Geplante Rückrufe"
          description="Datum und Uhrzeit sind beim Vereinbaren verpflichtend"
        >
          {isError && (
            <FeedbackState
              kind="error"
              title="Rückrufe nicht verfügbar"
              action={<Button onClick={() => refetch()}>Erneut versuchen</Button>}
            />
          )}
          {isLoading && <p className="text-muted-foreground">Lädt …</p>}
          {data?.length === 0 && (
            <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              Keine offenen Callbacks.
            </p>
          )}
          <div className="space-y-2">
            {data
              ?.filter((c) => !day || new Date(c.due_at).toDateString() === day.toDateString())
              .map((c) => {
                const due = new Date(c.due_at);
                const overdue = due < now;
                const today = sameDay(due);
                return (
                  <div
                    key={c.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${overdue ? "border-destructive/50 bg-destructive/5" : today ? "border-primary/50 bg-primary/5" : "bg-card"}`}
                  >
                    <div>
                      <p className="font-medium">{c.lead?.company || "Ohne Firmenname"}</p>
                      <p className="text-sm text-muted-foreground">
                        {[c.lead?.contact_name, c.lead?.phone].filter(Boolean).join(" · ")}
                      </p>
                      <p className="text-sm">
                        {due.toLocaleString("de-DE")}{" "}
                        {overdue ? (
                          <Badge variant="destructive">Überfällig</Badge>
                        ) : today ? (
                          <Badge>Heute fällig</Badge>
                        ) : null}{" "}
                        {c.user_id === user.id && <Badge variant="outline">Meiner</Badge>}
                      </p>
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
                      <Button size="sm" variant="outline" onClick={() => done(c.id)}>
                        Erledigt
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>
          <p className="text-sm text-muted-foreground">
            Rückruf vereinbaren oder Ergebnis ändern: Öffne den im{" "}
            <Link to="/call" className="underline">
              Anrufablauf
            </Link>
            . Der Server reserviert den nächsten fälligen Rückruf automatisch.
          </p>
        </Surface>
      </div>
      <LeadDialog leadId={leadId} userId={user.id} admin={false} onClose={() => setLeadId(null)} />
    </div>
  );
}
