import { CallerPerformance } from "@/components/caller/performance";
import { useCountry } from "@/lib/country";
import { backendEnabled, backendRpc } from "@/lib/backend";
import { BackendStatus } from "@/components/backend-status";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/use-admin";
import { StatusBadge } from "@/components/coldcaller/primitives";
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
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { FeedbackState, InfoButton, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Übersicht – Sign Selector Cold Caller" }] }),
  component: Dashboard,
});

type BatchRow = {
  id: string;
  name: string;
  created_at: string;
  total: number;
  done: number;
  open?: number;
  assigned_to?: string | null;
  assigned_name?: string | null;
};

const BATCH_ERRORS: Record<string, string> = {
  batch_taken: "Dieser Batch wurde gerade von jemand anderem übernommen.",
  batch_not_found: "Dieser Batch ist nicht mehr verfügbar.",
  forbidden: "Für diesen Batch fehlt dir die Berechtigung.",
};

function Dashboard() {
  const country = useCountry();
  const { user } = Route.useRouteContext();
  const admin = useIsAdmin(user.id);
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ batch: BatchRow; action: "claim" | "release" } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  async function confirmPending() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      if (pending.action === "claim")
        await backendRpc("claim_batch", { p_batch_id: pending.batch.id });
      else await backendRpc("release_batch", { p_batch_id: pending.batch.id });
      toast.success(
        pending.action === "claim"
          ? `„${pending.batch.name}“ gehört jetzt dir. Die Leads findest du unter Offene Leads.`
          : `„${pending.batch.name}“ ist wieder frei.`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const known = Object.keys(BATCH_ERRORS).find((k) => message.includes(k));
      toast.error(
        known ? BATCH_ERRORS[known] : "Das hat nicht geklappt. Bitte versuche es erneut.",
      );
    } finally {
      setBusy(false);
      setPending(null);
      void qc.invalidateQueries({ queryKey: ["batches"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["lead-batches"] });
    }
  }

  const {
    data: batches,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["batches", country],
    queryFn: async () => {
      if (backendEnabled) {
        const progress = (await backendRpc("get_batch_progress", {} as never)) as {
          id: string;
          name: string;
          created_at: string;
          import_state: string;
          total: number;
          completed: number;
          open: number;
          assigned_to: string | null;
          assigned_name: string | null;
        }[];
        const { data: own } = await supabase
          .from("lead_batches")
          .select("id")
          .eq("country", country);
        const ids = new Set((own ?? []).map((b) => b.id));
        return progress
          .filter((b) => b.import_state === "confirmed" && ids.has(b.id))
          .map((b) => ({ ...b, done: b.completed }));
      }
      const { data, error } = await supabase
        .from("lead_batches")
        .select("id,name,created_at")
        .eq("country", country)
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
      />
      <CallerPerformance userId={user.id} />
      <Surface
        title="Lead Batches"
        description="Alle verfügbaren Leadlisten in deinem Land"
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
          <FeedbackState kind="empty" title="Dein Arbeitsplatz wartet auf Leads">
            Sobald der Master-Admin einen Leadbatch hochgeladen hat, kannst du dein erstes Gespräch
            starten.
          </FeedbackState>
        ) : (
          <div className="cc-batch-grid">
            {batches?.map((b) => {
              const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
              const mine = backendEnabled && "assigned_to" in b && b.assigned_to === user.id;
              const taken = backendEnabled && "assigned_to" in b && !!b.assigned_to && !mine;
              const free = backendEnabled && "assigned_to" in b && !b.assigned_to;
              const row = b as BatchRow;
              return (
                <article key={b.id} className="cc-batch">
                  <div className="cc-batch-heading">
                    <div>
                      <h3>{b.name}</h3>
                      <small>{new Date(b.created_at).toLocaleDateString("de-DE")}</small>
                    </div>
                  </div>
                  <Progress value={pct} aria-label={`Fortschritt ${b.name}: ${pct} Prozent`} />
                  <p>
                    {b.done} von {b.total} bearbeitet · {pct} %
                  </p>
                  {backendEnabled && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      {mine && <StatusBadge tone="success">Dein Batch</StatusBadge>}
                      {taken && (
                        <StatusBadge tone="neutral">
                          Vergeben an {row.assigned_name || "einen Caller"}
                        </StatusBadge>
                      )}
                      {free && <StatusBadge tone="info">Frei</StatusBadge>}
                      <div className="flex gap-2">
                        {mine && (
                          <Button asChild size="sm" variant="outline">
                            <Link to="/leads">Offene Leads</Link>
                          </Button>
                        )}
                        {free && (
                          <Button
                            size="sm"
                            onClick={() => setPending({ batch: row, action: "claim" })}
                          >
                            Batch übernehmen
                          </Button>
                        )}
                        {admin && (mine || taken) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPending({ batch: row, action: "release" })}
                          >
                            Freigeben
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Surface>
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.action === "claim" ? "Batch übernehmen?" : "Batch freigeben?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.action === "claim"
                ? `„${pending.batch.name}“ mit ${pending.batch.open ?? pending.batch.total} offenen Leads wird dir zugewiesen. Kein anderer Caller kann ihn dann nutzen. Du findest die Leads unter Offene Leads.`
                : `„${pending?.batch.name}“ wird wieder für alle Caller im Land verfügbar. Bereits bearbeitete Leads bleiben bei ihrem Bearbeiter.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void confirmPending();
              }}
            >
              {pending?.action === "claim" ? "Übernehmen" : "Freigeben"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {backendEnabled && <BackendStatus admin={false} />}
    </div>
  );
}
