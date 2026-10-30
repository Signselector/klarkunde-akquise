import { LeadDialog } from "@/components/caller/lead-dialog";
import { LeadsTable } from "@/components/caller/leads-table";
import { useCountry } from "@/lib/country";
import { STATUS_LABEL } from "@/lib/leads";
import { backendEnabled } from "@/lib/backend";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "@/components/coldcaller/icons";
import { Link } from "@tanstack/react-router";
import {
  FeedbackState,
  InfoButton,
  StatusBadge,
  Surface,
} from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
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
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [batch, setBatch] = useState("all");
  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    setBatch("all");
  }, [country]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setOpenId(id);
  }, []);

  // Batches of this country. Before the batch-assignment migration is applied the column is missing:
  // then the page keeps showing every lead of the country instead of failing.
  const assignment = useQuery({
    queryKey: ["lead-batches", country, user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_batches")
        .select("id,name,assigned_to")
        .eq("country", country)
        .order("created_at", { ascending: false });
      if (error) {
        const fallback = await supabase
          .from("lead_batches")
          .select("id,name")
          .eq("country", country)
          .order("created_at", { ascending: false });
        if (fallback.error) throw fallback.error;
        return { supported: false, batches: fallback.data ?? [] };
      }
      const rows = data ?? [];
      return {
        supported: backendEnabled,
        batches: backendEnabled ? rows.filter((r) => r.assigned_to === user.id) : rows,
      };
    },
  });
  const batches = assignment.data?.batches;
  const onlyMine = !!assignment.data?.supported;
  const {
    data: result,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["leads", q, country, batch, user.id, onlyMine],
    enabled: assignment.isFetched,
    queryFn: async () => {
      let query = supabase
        .from("leads")
        .select(
          onlyMine
            ? "*, lead_batches!inner(country,assigned_to)"
            : "*, lead_batches!inner(country)",
          {
            count: "exact",
          },
        )
        .eq("lead_batches.country", country)
        .order("created_at", { ascending: false })
        .limit(300);
      if (backendEnabled) query = query.is("archived_at", null);
      if (onlyMine) query = query.eq("lead_batches.assigned_to", user.id);
      if (batch !== "all") query = query.eq("batch_id", batch);
      // Still to work on: untouched leads, not reached and scheduled callbacks. Every other outcome is completed.
      query = query.in("status", ["open", "callback", "appointment_missed"]);
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
  // Untouched leads first, then not reached, then scheduled callbacks at the very bottom. Order within a group is kept.
  const sorted = useMemo(() => {
    const rank = (l: { status: string; attempts: number }) =>
      l.status === "callback" ? 2 : l.status === "open" && l.attempts > 0 ? 1 : 0;
    const rows = result?.rows ?? [];
    return [0, 1, 2].flatMap((r) => rows.filter((l) => rank(l) === r));
  }, [result?.rows]);
  const labelOf = (l: { status: string; attempts: number }) =>
    l.status === "open" && l.attempts > 0 ? "Nicht erreicht" : (STATUS_LABEL[l.status] ?? l.status);
  // Only statuses that occur in the loaded list are offered as filter.
  const statusOptions = useMemo(() => {
    const present = new Set(sorted.map(labelOf));
    return ["Offen", "Nicht erreicht", "Termin versäumt", "Rückruf vereinbart"].filter((s) => present.has(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);
  useEffect(() => {
    if (status !== "all" && result && !statusOptions.includes(status)) setStatus("all");
  }, [status, statusOptions, result]);
  const leads = result
    ? sorted.filter((l) => status === "all" || labelOf(l) === status)
    : undefined;

  return (
    <div className="cc-page">
      <PageHeading
        title="Offene Leads"
        description="Die Leads deiner übernommenen Batches. Öffne die Kundenakte, um nach dem Telefonat das Gesprächsergebnis einzutragen."
      />
      <Surface
        title="Offene Leads"
        description="Offene Erstkontakte · nach Status und Kontakt durchsuchen"
        action={
          <InfoButton label="Leadpool">
            Diese Liste zeigt die Leads der Batches, die du im Dashboard übernommen hast. Jeder
            Batch gehört genau einem Caller. Ein Admin kann ihn wieder freigeben.
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
            <SelectTrigger className="cc-filter-select" aria-label="Status filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
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
                  setBatch("all");
                  setStatus("all");
                }}
              >
                Filter zurücksetzen
              </Button>
            }
          >
            {backendEnabled
              ? "Passe deine Suche oder die Filter an. Noch keinen Batch? Übernimm einen im Dashboard unter Lead Batches."
              : "Passe deine Suche oder die Filter an."}
          </FeedbackState>
        ) : (
          <LeadsTable leads={leads ?? []} onOpen={setOpenId} resultLabel={labelOf} />
        )}
        {leads && leads.length === 300 && (
          <p className="cc-list-caption pt-4">
            Die neuesten 300 Treffer werden angezeigt. Grenze deine Suche weiter ein.
          </p>
        )}
      </Surface>
      <LeadDialog
        leadId={openId}
        userId={user.id}
        leadIds={(leads ?? []).map((l) => l.id)}
        onNavigate={setOpenId}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
