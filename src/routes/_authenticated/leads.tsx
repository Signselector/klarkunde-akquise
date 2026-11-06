import { LeadDialog } from "@/components/caller/lead-dialog";
import { LeadQuickDialog } from "@/components/caller/lead-quick-dialog";
import { LeadsTable, type LeadIntent } from "@/components/caller/leads-table";
import { useCountry } from "@/lib/country";
import { orderOpenLeads, STATUS_LABEL } from "@/lib/leads";
import { phoneDbPatterns, searchMatches } from "@/lib/phone";
import { backendEnabled, backendRpc } from "@/lib/backend";
import { formatPer100, monthStart } from "@/lib/dashboard";
import { currentMonth } from "@/lib/monthly-stats";
import { formatEuro, leadAvgTier, salaryForAvg } from "@/lib/kpi-tiers";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, PhoneMissed, Search } from "@/components/coldcaller/icons";
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

/** The `or` filter of the lead search: text fields, the typed phone text and, for numbers, the digit patterns. */
function searchOr(term: string) {
  const phone = [`%${term}%`, ...phoneDbPatterns(term)];
  return [
    `company.ilike.%${term}%`,
    `contact_name.ilike.%${term}%`,
    ...[...new Set(phone)].map((p) => `phone.ilike.${p}`),
    `city.ilike.%${term}%`,
  ].join(",");
}

/** "14:30" for today, "05.11. 14:30" for an overdue callback of an earlier day. */
function callbackTime(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
}

function LeadsPage() {
  const country = useCountry();
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [batch, setBatch] = useState("all");
  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  // Set when a result button or "Daten bearbeiten" of the list was clicked: the file opens at that step.
  const [intent, setIntent] = useState<LeadIntent | null>(null);
  const [parkedOpen, setParkedOpen] = useState(false);
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
    placeholderData: (prev) => prev,
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
        // Leads of one import share the same created_at: the id keeps their order the same after an edit.
        .order("created_at", { ascending: false })
        .order("id")
        .limit(300);
      if (backendEnabled) query = query.is("archived_at", null);
      if (onlyMine) query = query.eq("lead_batches.assigned_to", user.id);
      if (batch !== "all") query = query.eq("batch_id", batch);
      // Still to work on: untouched leads and not reached. Callbacks live under "Rückrufe", every other outcome is completed.
      query = query.in("status", ["open", "appointment_missed", "reference_mail"]);
      // Not reached leads are loaded separately below, so they stay in the list (at the bottom) for 20 days.
      if (backendEnabled) query = query.or("status.neq.open,attempts.eq.0");
      const term = q.trim().replace(/[,()%]/g, " ");
      if (term)
        query = query.or(
          searchOr(term),
        );
      // Missed appointments come back to the original caller even when he no longer owns the batch.
      let missed: PromiseLike<{ data: unknown[] | null; error: unknown }> | null = null;
      if (onlyMine && backendEnabled) {
        let m = supabase
          .from("leads")
          .select("*, lead_batches!inner(country,assigned_to)")
          .eq("lead_batches.country", country)
          .eq("status", "appointment_missed")
          .eq("last_called_by", user.id)
          .is("archived_at", null)
          .order("id")
          .limit(100);
        if (batch !== "all") m = m.eq("batch_id", batch);
        if (term)
          m = m.or(
            searchOr(term),
          );
        missed = m;
      }
      // Not reached: tried at least once and still open. They are parked in their own folded section
      // ("Nicht Erreicht: Aktuell nicht anrufen") and keep counting as processed for their batch.
      let unreached: PromiseLike<{ data: unknown[] | null; error: unknown; count?: number | null }> | null = null;
      if (backendEnabled) {
        let u = supabase
          .from("leads")
          .select("*, lead_batches!inner(country,assigned_to)", { count: "exact" })
          .eq("lead_batches.country", country)
          .eq("status", "open")
          .gt("attempts", 0)
          .is("archived_at", null)
          .order("last_called_at", { ascending: false })
          .order("id")
          .limit(1000);
        if (onlyMine) u = u.eq("lead_batches.assigned_to", user.id);
        if (batch !== "all") u = u.eq("batch_id", batch);
        if (term) u = u.or(searchOr(term));
        unreached = u;
      }
      // Callbacks of today (and overdue ones) go to the top of the list with their time.
      let due: PromiseLike<{ data: unknown[] | null; error: unknown }> | null = null;
      if (backendEnabled) {
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        due = supabase
          .from("callbacks")
          .select("id,due_at,lead:leads(id,company,contact_name,phone,email,city,extra,status,attempts,last_called_at,archived_at,batch_id)")
          .eq("user_id", user.id)
          .eq("country", country)
          .eq("done", false)
          .lte("due_at", endOfToday.toISOString())
          .order("due_at")
          .limit(200);
      }
      // All requests run at the same time instead of one after another.
      const [main, extra, tried, callbacks] = await Promise.all([query, missed, unreached, due]);
      if (main.error) throw main.error;
      if (extra?.error) throw extra.error;
      if (tried?.error) throw tried.error;
      if (callbacks?.error) throw callbacks.error;
      let rows = main.data ?? [];
      if (extra?.data) {
        const have = new Set(rows.map((r) => r.id));
        rows = [...rows, ...(extra.data as typeof rows).filter((r) => !have.has(r.id))];
      }
      const parked = (tried?.data ?? []) as typeof rows;
      // Callbacks due today: one entry per lead (the earliest), only leads that are still open for work.
      const seen = new Set<string>();
      const callbackRows: ((typeof rows)[number] & { callback_at: string })[] = [];
      for (const c of (callbacks?.data ?? []) as { due_at: string; lead: Record<string, unknown> | null }[]) {
        const l = c.lead;
        if (!l || l["archived_at"] || seen.has(l["id"] as string)) continue;
        if (!searchMatches(term, [l["company"], l["contact_name"], l["email"], l["city"]] as (string | null)[], l["phone"] as string | null)) continue;
        seen.add(l["id"] as string);
        callbackRows.push({ ...(l as unknown as (typeof rows)[number]), callback_at: c.due_at });
      }
      return { rows, parked, callbackRows, parkedTotal: Math.max(tried?.count ?? 0, parked.length), total: Math.max(main.count ?? 0, rows.length) };
    },
  });
  const sorted = useMemo(
    () => [...(result?.callbackRows ?? []), ...orderOpenLeads(result?.rows ?? [])],
    [result?.rows, result?.callbackRows],
  );
  const parked = result?.parked ?? [];
  // Current month lead average + salary, shown above the list.
  const avg = useQuery({
    queryKey: ["monthly-quality-current", user.id],
    enabled: backendEnabled,
    refetchInterval: 60_000,
    queryFn: async () =>
      (await backendRpc("get_monthly_quality", {
        p_month: monthStart(currentMonth()),
      })) as unknown as { per_100: number | null },
  });
  const per100 = avg.data?.per_100 ?? 0;
  const labelOf = (l: { status: string; attempts: number; callback_at?: string | null }) =>
    l.callback_at
      ? `Rückruf · ${callbackTime(l.callback_at)}`
      : l.status === "open" && l.attempts > 0
        ? "Nicht erreicht"
        : (STATUS_LABEL[l.status] ?? l.status);
  // The filter only knows the plain kinds ("Rückruf", not each time).
  const kindOf = (l: { status: string; attempts: number; callback_at?: string | null }) =>
    l.callback_at ? "Rückruf" : labelOf(l);
  // Only statuses that occur in the loaded list are offered as filter.
  const statusOptions = useMemo(() => {
    const present = new Set(sorted.map(kindOf));
    return ["Rückruf", "Offen", "Termin versäumt", "Referenzmail"].filter((s) => present.has(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);
  useEffect(() => {
    if (status !== "all" && result && !statusOptions.includes(status)) setStatus("all");
  }, [status, statusOptions, result]);
  const leads = result
    ? sorted.filter((l) => status === "all" || kindOf(l) === status)
    : undefined;

  return (
    <div className="cc-page">
      <PageHeading
        title="Offene Leads"
        description="Die Leads deiner übernommenen Batches. Öffne die Kundenakte, um nach dem Telefonat das Gesprächsergebnis einzutragen."
        action={
          <div className="cc-salary-box">
            <span>
              Aktueller Schnitt
              <b className={`cc-tier cc-tier--${leadAvgTier(per100)}`}>{formatPer100(per100)}</b>
            </span>
            <i aria-hidden="true" />
            <span>
              Gehalt
              <b className={leadAvgTier(per100) === "gold" ? "cc-tier cc-tier--gold" : ""}>
                {formatEuro(salaryForAvg(per100))}
              </b>
            </span>
          </div>
        }
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
          <LeadsTable
            leads={leads ?? []}
            onOpen={(id, it) => {
              setIntent(it ?? null);
              setOpenId(id);
            }}
            resultLabel={labelOf}
          />
        )}
        {leads && leads.length === 300 && (
          <p className="cc-list-caption pt-4">
            Die neuesten 300 Treffer werden angezeigt. Grenze deine Suche weiter ein.
          </p>
        )}
      </Surface>
      {parked.length > 0 && (
        <section className="cc-parked" aria-label="Nicht erreicht">
          <button
            type="button"
            className="cc-parked-toggle"
            aria-expanded={parkedOpen}
            onClick={() => setParkedOpen((o) => !o)}
          >
            <PhoneMissed aria-hidden="true" />
            <span>{`Nicht Erreicht: Aktuell nicht anrufen (${result?.parkedTotal ?? parked.length})`}</span>
            <ChevronDown aria-hidden="true" className={parkedOpen ? "rotate-180" : ""} />
          </button>
          {parkedOpen && (
            <div className="pt-2">
              <LeadsTable
                leads={parked}
                onOpen={(id, it) => {
                  setIntent(it ?? null);
                  setOpenId(id);
                }}
                resultLabel={() => "Nicht erreicht"}
              />
              {parked.length >= 1000 && (
                <p className="cc-list-caption pt-3">Die ersten 1000 werden angezeigt. Grenze die Suche ein.</p>
              )}
            </div>
          )}
        </section>
      )}
      <LeadDialog
        leadId={intent ? null : openId}
        userId={user.id}
        leadIds={[...(leads ?? []), ...(parkedOpen ? parked : [])].map((l) => l.id)}
        onNavigate={setOpenId}
        onClose={() => setOpenId(null)}
      />
      <LeadQuickDialog
        leadId={intent ? openId : null}
        intent={intent}
        userId={user.id}
        onClose={() => {
          setIntent(null);
          setOpenId(null);
        }}
      />
    </div>
  );
}
