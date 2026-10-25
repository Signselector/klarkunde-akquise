import { LeadDialog } from "@/components/caller/lead-dialog";
import { LeadsTable } from "@/components/caller/leads-table";
import { useCountry } from "@/lib/country";
import { backendEnabled } from "@/lib/backend";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL } from "@/lib/leads";
import { useIsAdmin } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, ChevronRight, Search, Trash2 } from "@/components/coldcaller/icons";
import { Link } from "@tanstack/react-router";
import {
  FeedbackState,
  InfoButton,
  StatusBadge,
  Surface,
} from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({ meta: [{ title: "Leads – Sign Selector Cold Caller" }] }),
  component: LeadsPage,
});

function LeadsPage() {
  const country = useCountry();
  const { user } = Route.useRouteContext();
  const admin = useIsAdmin(user.id);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("open");
  const [batch, setBatch] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    setBatch("all");
  }, [country]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setOpenId(id);
  }, []);

  const { data: batches } = useQuery({
    queryKey: ["lead-batches", country],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_batches")
        .select("id,name")
        .eq("country", country)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const {
    data: result,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["leads", q, status, country, batch],
    queryFn: async () => {
      let query = supabase
        .from("leads")
        .select("*, lead_batches!inner(country)", { count: "exact" })
        .eq("lead_batches.country", country)
        .order("created_at", { ascending: false })
        .limit(300);
      if (backendEnabled) query = query.is("archived_at", null);
      if (batch !== "all") query = query.eq("batch_id", batch);
      if (status !== "all") query = query.eq("status", status);
      if (status === "open") query = query.eq("attempts", 0);
      const term = q.trim().replace(/[,()%]/g, " ");
      if (term)
        query = query.or(
          `company.ilike.%${term}%,contact_name.ilike.%${term}%,phone.ilike.%${term}%,city.ilike.%${term}%`,
        );
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], total: count ?? data?.length ?? 0 };
    },
  });
  const leads = result?.rows;

  async function deleteAllOpen() {
    const { error } = await (backendEnabled
      ? supabase.rpc("archive_open_leads", {} as never)
      : supabase.from("leads").delete().eq("status", "open"));
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Alle offenen Leads entfernt.");
    qc.invalidateQueries();
  }

  return (
    <div className="cc-page">
      <PageHeading
        title="Offene Leads"
        description="Deine offenen Kontakte aus den verfügbaren Batches. Starte den Anrufablauf, um ein Ergebnis einzutragen."
      />
      <Button asChild>
        <Link to="/call">Anrufen & Ergebnis eintragen</Link>
      </Button>
      <Surface
        title="Offene Leads"
        description="Offene Erstkontakte · nach Status und Kontakt durchsuchen"
        action={
          <InfoButton label="Leadpool">
            Diese Liste zeigt die vorhandenen gemeinsamen Leads. Eine persönliche Zuweisung wird
            erst mit der entsprechenden Backend-Schnittstelle ergänzt.
          </InfoButton>
        }
      >
        <div className="cc-filterbar">
          <div className="cc-search">
            <Search aria-hidden="true" />
            <Input
              aria-label="Leads durchsuchen"
              placeholder="Firma, Kontakt, Telefon oder Stadt"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={batch} onValueChange={setBatch}>
            <SelectTrigger className="cc-filter-select" aria-label="Batch filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Batches</SelectItem>
              {batches?.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="cc-filter-select" aria-label="Leadstatus filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="cc-list-caption flex flex-wrap items-center justify-between gap-3">
          <span>
            {isLoading
              ? "Liste wird geladen …"
              : isError
                ? "Liste nicht verfügbar"
                : `${leads?.length ?? 0} ${leads?.length === 1 ? "Lead" : "Leads"} von ${result?.total ?? 0} geladen`}
          </span>
          {admin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive">
                  <Trash2 size={16} />
                  Offene Leads löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Alle offenen Leads löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {backendEnabled
                      ? "Offene Leads werden archiviert. Bearbeitete Leads bleiben erhalten."
                      : "Das kann nicht rückgängig gemacht werden. Bearbeitete Leads bleiben erhalten."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteAllOpen}>Löschen</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {isLoading ? (
          <FeedbackState kind="loading" title="Leads werden geladen" />
        ) : isError ? (
          <FeedbackState
            kind="error"
            title="Leads gerade nicht verfügbar"
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Erneut versuchen
              </Button>
            }
          >
            Bitte versuche es erneut.
          </FeedbackState>
        ) : leads?.length === 0 ? (
          <FeedbackState
            kind="empty"
            title="Keine passenden Leads"
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQ("");
                  setStatus("all");
                }}
              >
                Filter zurücksetzen
              </Button>
            }
          >
            Passe deine Suche oder die Filter an.
          </FeedbackState>
        ) : (
          <LeadsTable leads={leads ?? []} onOpen={setOpenId} />
        )}
        {leads && leads.length === 300 && (
          <p className="cc-list-caption pt-4">
            Die neuesten 300 Treffer werden angezeigt. Grenze deine Suche weiter ein.
          </p>
        )}
      </Surface>
      <LeadDialog leadId={openId} userId={user.id} admin={admin} onClose={() => setOpenId(null)} />
    </div>
  );
}
