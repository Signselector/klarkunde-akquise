import { backendEnabled, backendRpc } from "@/lib/backend";
import { BackendStatus } from "@/components/backend-status";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, FolderOpen, Phone, Upload, CalendarClock } from "lucide-react";
import { FeedbackState, InfoButton, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Übersicht – Sign Selector Cold Caller" }] }),
  component: Dashboard,
});

function Dashboard() {
  const {
    data: batches,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["batches"],
    queryFn: async () => {
      if (backendEnabled) {
        const progress = (await backendRpc("get_batch_progress", {} as never)) as {
          id: string;
          name: string;
          created_at: string;
          import_state: string;
          total: number;
          completed: number;
        }[];
        return progress
          .filter((b) => b.import_state === "confirmed")
          .map((b) => ({ ...b, done: b.completed }));
      }
      const { data, error } = await supabase
        .from("lead_batches")
        .select("id,name,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return Promise.all(
        (data ?? []).map(async (b) => {
          const [t, o] = await Promise.all([
            supabase
              .from("leads")
              .select("id", { count: "exact", head: true })
              .eq("batch_id", b.id),
            supabase
              .from("leads")
              .select("id", { count: "exact", head: true })
              .eq("batch_id", b.id)
              .eq("status", "open"),
          ]);
          if (t.error) throw t.error;
          if (o.error) throw o.error;
          const total = t.count ?? 0;
          return { ...b, total, done: total - (o.count ?? 0) };
        }),
      );
    },
  });

  return (
    <div className="cc-page">
      <PageHeading
        title="Bereit für gute Gespräche."
        description="Deine Leads im Blick. Der nächste Schritt ganz klar."
        action={
          <Button asChild variant="outline">
            <Link to="/import">
              <Upload />
              Leads importieren
            </Link>
          </Button>
        }
      />
      <section className="cc-start" aria-labelledby="start-title">
        <div>
          <h2 id="start-title">Ein Gespräch kann alles verändern.</h2>
          <p>
            Starte deinen Anrufablauf oder kümmere dich um vereinbarte Rückrufe. Deine importierten
            Leadlisten findest du darunter.
          </p>
          <div className="cc-start-actions">
            <Button asChild>
              <Link to="/call">
                <Phone />
                Anrufen starten
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/callbacks">
                <CalendarClock />
                Rückrufe öffnen
              </Link>
            </Button>
          </div>
        </div>
        <Phone className="cc-start-mark" size={90} strokeWidth={1.5} aria-hidden="true" />
      </section>
      <Surface
        title="Deine Lead-Batches"
        description="Fortschritt der gemeinsam verfügbaren Importlisten"
        action={
          <InfoButton label="Batchfortschritt">
            Der vorhandene Fortschritt zählt Leads, die nicht mehr offen sind. Er ist keine
            Abschlussquote. Nicht erreichte Leads bleiben offen.
          </InfoButton>
        }
      >
        {isLoading ? (
          <FeedbackState kind="loading" title="Leadlisten werden geladen" />
        ) : isError ? (
          <FeedbackState
            kind="error"
            title="Leadlisten gerade nicht verfügbar"
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Erneut versuchen
              </Button>
            }
          >
            Bitte versuche es erneut.
          </FeedbackState>
        ) : batches?.length === 0 ? (
          <FeedbackState
            kind="empty"
            title="Dein Arbeitsplatz wartet auf Leads"
            action={
              <Button asChild>
                <Link to="/import">
                  <Upload />
                  Erste Liste importieren
                </Link>
              </Button>
            }
          >
            Importiere eine CSV- oder Excel-Datei und starte dein erstes Gespräch.
          </FeedbackState>
        ) : (
          <div className="cc-batch-grid">
            {batches?.map((b) => {
              const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
              return (
                <article key={b.id} className="cc-batch">
                  <div className="cc-batch-heading">
                    <div>
                      <h3>{b.name}</h3>
                      <small>{new Date(b.created_at).toLocaleDateString("de-DE")}</small>
                    </div>
                    <FolderOpen size={24} aria-hidden="true" />
                  </div>
                  <Progress value={pct} aria-label={`Fortschritt ${b.name}: ${pct} Prozent`} />
                  <p>
                    {b.done} von {b.total} bearbeitet · {pct} %
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </Surface>
      {backendEnabled && <BackendStatus admin={false} />}
    </div>
  );
}
