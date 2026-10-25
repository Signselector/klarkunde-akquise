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
import { FolderOpen } from "@/components/coldcaller/icons";
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
  processed: number;
  unprocessed: number;
  assigned_to?: string | null;
  assigned_name?: string | null;
};
type Pending = {
  batch: BatchRow;
  action: "claim" | "release" | "reassign";
  userId?: string;
  userName?: string;
};

const BATCH_ERRORS: Record<string, string> = {
  batch_taken: "Dieser Batch wurde gerade von jemand anderem übernommen.",
  batch_not_found: "Dieser Batch ist nicht mehr verfügbar.",
  forbidden: "Für diesen Batch fehlt dir die Berechtigung.",
  invalid_assignee: "Diese Person darf in diesem Land keinen Batch übernehmen.",
};

function Dashboard() {
  const country = useCountry();
  const { user } = Route.useRouteContext();
  const admin = useIsAdmin(user.id);
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const people = useQuery({
    enabled: admin && backendEnabled,
    queryKey: ["batch-assignees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,display_name")
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function confirmPending() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      if (pending.action === "claim")
        await backendRpc("claim_batch", { p_batch_id: pending.batch.id });
      else if (pending.action === "release")
        await backendRpc("release_batch", { p_batch_id: pending.batch.id });
      else
        await backendRpc("reassign_batch", {
          p_batch_id: pending.batch.id,
          p_user_id: pending.userId ?? "",
        });
      toast.success(
        pending.action === "claim"
          ? `„${pending.batch.name}“ gehört jetzt dir. Die Leads findest du unter Offene Leads.`
          : pending.action === "release"
            ? `„${pending.batch.name}“ ist wieder frei.`
            : `„${pending.batch.name}“ gehört jetzt ${pending.userName ?? "der gewählten Person"}.`,
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
    refetchInterval: 30_000,
    queryFn: async () => {
      if (backendEnabled) {
        const progress = (await backendRpc("get_batch_progress", {} as never)) as {
          id: string;
          name: string;
          created_at: string;
          import_state: string;
          total: number;
          completed: number;
          processed?: number;
          unprocessed?: number;
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
          .map((b) => {
            // Older databases only know `completed`/`open`; the new function reports distinct processed leads.
            const processed = b.processed ?? b.completed;
            return {
              ...b,
              processed,
              unprocessed: b.unprocessed ?? Math.max(0, b.total - processed),
            };
          });
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
          const processed = total - (o.count ?? 0);
          return { ...b, total, processed, unprocessed: total - processed };
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
        description="Alle Leadlisten in deinem Land · aktualisiert sich automatisch"
        action={
          <InfoButton label="Batchfortschritt">
            Ein Lead zählt als bearbeitet, sobald mindestens ein Gesprächsergebnis dokumentiert ist.
            Mehrere Anrufversuche erhöhen den Fortschritt nicht mehrfach. Nach einer Freigabe bleibt
            der Fortschritt erhalten. Ein Batch gehört immer nur einer Person.
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
              const pct = b.total ? Math.round((b.processed / b.total) * 100) : 0;
              const hasOwner = "assigned_to" in b;
              const mine = backendEnabled && hasOwner && b.assigned_to === user.id;
              const taken = backendEnabled && hasOwner && !!b.assigned_to && !mine;
              const free = backendEnabled && hasOwner && !b.assigned_to;
              const row = b as BatchRow;
              return (
                <article key={b.id} className="cc-batch">
                  <div className="cc-batch-heading">
                    <div>
                      <h3>{b.name}</h3>
                      <small>Import: {new Date(b.created_at).toLocaleDateString("de-DE")}</small>
                    </div>
                    {backendEnabled && hasOwner && (
                      <StatusBadge tone={free ? "info" : mine ? "success" : "neutral"}>
                        {free ? "Frei" : "Übernommen"}
                      </StatusBadge>
                    )}
                  </div>
                  <dl className="cc-batch-numbers">
                    <div>
                      <dt>Leads</dt>
                      <dd>{b.total}</dd>
                    </div>
                    <div>
                      <dt>Bearbeitet</dt>
                      <dd>{b.processed}</dd>
                    </div>
                    <div>
                      <dt>Unbearbeitet</dt>
                      <dd>{b.unprocessed}</dd>
                    </div>
                  </dl>
                  <Progress value={pct} aria-label={`Fortschritt ${b.name}: ${pct} Prozent`} />
                  <p>
                    {b.processed} von {b.total} bearbeitet · {pct} %
                    {backendEnabled && hasOwner && (
                      <>
                        {" · Besitzer: "}
                        {free ? "–" : mine ? "du" : row.assigned_name || "unbekannt"}
                      </>
                    )}
                  </p>
                  {backendEnabled && hasOwner && (
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
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
                      {(mine || (admin && taken)) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPending({ batch: row, action: "release" })}
                        >
                          Freigeben
                        </Button>
                      )}
                      {admin && (
                        <select
                          className="rounded-md border bg-background px-2 py-1.5 text-sm"
                          aria-label={`Batch ${b.name} neu zuweisen`}
                          value=""
                          onChange={(e) => {
                            const person = people.data?.find((p) => p.id === e.target.value);
                            if (person)
                              setPending({
                                batch: row,
                                action: "reassign",
                                userId: person.id,
                                userName: person.display_name ?? "",
                              });
                          }}
                        >
                          <option value="">Zuweisen an …</option>
                          {people.data?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.display_name}
                            </option>
                          ))}
                        </select>
                      )}
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
              {pending?.action === "claim"
                ? "Batch übernehmen?"
                : pending?.action === "release"
                  ? "Batch freigeben?"
                  : "Batch neu zuweisen?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.action === "claim"
                ? `„${pending.batch.name}“ mit ${pending.batch.unprocessed} unbearbeiteten Leads wird dir zugewiesen. Kein anderer Caller kann ihn dann nutzen. Du findest die Leads unter Offene Leads.`
                : pending?.action === "release"
                  ? `„${pending?.batch.name}“ wird wieder für alle Caller im Land verfügbar. Bereits bearbeitete Leads und ihre Historie bleiben erhalten, sie erscheinen nicht wieder als unbearbeitet.`
                  : `„${pending?.batch.name}“ wird ${pending?.userName ?? "der gewählten Person"} zugewiesen. Bereits bearbeitete Leads bleiben erhalten.`}
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
              {pending?.action === "claim"
                ? "Übernehmen"
                : pending?.action === "release"
                  ? "Freigeben"
                  : "Zuweisen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {backendEnabled && <BackendStatus admin={false} />}
    </div>
  );
}
