import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL, suggestNextStep } from "@/lib/leads";
import { useIsAdmin } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Building2, ChevronRight, Search, Trash2, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  FeedbackState,
  InfoButton,
  StatusBadge,
  Surface,
} from "@/components/coldcaller/primitives";
import { PageHeading, LeadContact } from "@/components/coldcaller/workspace-parts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  head: () => ({ meta: [{ title: "Leads – Cold Call Tool" }] }),
  component: LeadsPage,
});

function LeadsPage() {
  const { user } = Route.useRouteContext();
  const admin = useIsAdmin(user.id);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("open");
  const [openId, setOpenId] = useState<string | null>(null);

  const {
    data: leads,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["leads", q, status],
    queryFn: async () => {
      let query = supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (status !== "all") query = query.eq("status", status);
      const term = q.trim().replace(/[,()%]/g, " ");
      if (term)
        query = query.or(
          `company.ilike.%${term}%,contact_name.ilike.%${term}%,phone.ilike.%${term}%,city.ilike.%${term}%`,
        );
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  async function deleteAllOpen() {
    const { error } = await supabase.from("leads").delete().eq("status", "open");
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Alle offenen Leads gelöscht.");
    qc.invalidateQueries();
  }

  return (
    <div className="cc-page">
      <PageHeading
        title="Deine Lead-Zentrale."
        description="Finde den richtigen Kontakt und öffne seine Notizen und seinen Verlauf."
        action={
          <Button asChild>
            <Link to="/import">
              <Upload />
              Leads importieren
            </Link>
          </Button>
        }
      />
      <Surface
        title="Leads"
        description="Gemeinsamer Leadpool · nach Status und Kontakt durchsuchen"
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
                : `${leads?.length ?? 0} ${leads?.length === 1 ? "angezeigter Lead" : "angezeigte Leads"}`}
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
                    Das kann nicht rückgängig gemacht werden. Bearbeitete Leads bleiben erhalten.
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
            Passe deine Suche an oder importiere eine neue Kontaktliste.
          </FeedbackState>
        ) : (
          <div className="cc-lead-list">
            {leads?.map((l) => (
              <button
                key={l.id}
                onClick={() => setOpenId(l.id)}
                className="cc-lead-row"
                aria-label={`${l.company || "Ohne Firmenname"} öffnen`}
              >
                <span className="cc-company-icon">
                  <Building2 size={23} aria-hidden="true" />
                </span>
                <span>
                  <strong>{l.company || "Ohne Firmenname"}</strong>
                  <small>
                    {[l.contact_name, l.city, l.phone].filter(Boolean).join(" · ") ||
                      "Keine Kontaktdetails hinterlegt"}
                  </small>
                </span>
                <StatusBadge
                  tone={
                    l.status === "production"
                      ? "success"
                      : l.status === "callback"
                        ? "warning"
                        : l.status === "no_interest"
                          ? "neutral"
                          : "info"
                  }
                >
                  {STATUS_LABEL[l.status] ?? l.status}
                </StatusBadge>
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            ))}
          </div>
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

function LeadDialog({
  leadId,
  userId,
  admin,
  onClose,
}: {
  leadId: string | null;
  userId: string;
  admin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const note = leadId ? (drafts[leadId] ?? "") : "";
  const setNote = (value: string) => {
    if (leadId) setDrafts((current) => ({ ...current, [leadId]: value }));
  };
  const { data, isLoading, isError, refetch } = useQuery({
    enabled: !!leadId,
    queryKey: ["lead-detail", leadId],
    queryFn: async () => {
      const [l, n, s, b] = await Promise.all([
        supabase.from("leads").select("*").eq("id", leadId!).maybeSingle(),
        supabase
          .from("lead_notes")
          .select("*")
          .eq("lead_id", leadId!)
          .order("created_at", { ascending: false }),
        supabase
          .from("status_changes")
          .select("*")
          .eq("lead_id", leadId!)
          .order("created_at", { ascending: false }),
        supabase.from("lead_batches").select("id,name").order("created_at", { ascending: false }),
      ]);
      const error = [l.error, n.error, s.error, b.error].find(Boolean);
      if (error) throw error;
      return { lead: l.data, notes: n.data ?? [], history: s.data ?? [], batches: b.data ?? [] };
    },
  });
  const lead = data?.lead;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lead-detail", leadId] });
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["batches"] });
  };

  async function addNote() {
    if (!note.trim() || !leadId) return;
    const { error } = await supabase
      .from("lead_notes")
      .insert({ lead_id: leadId, user_id: userId, body: note.trim() });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNote("");
    refresh();
  }
  async function reopen() {
    if (!lead) return;
    const { error } = await supabase.from("leads").update({ status: "open" }).eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("status_changes")
      .insert({ lead_id: lead.id, user_id: userId, old_status: lead.status, new_status: "open" });
    toast.success("Lead wieder geöffnet.");
    refresh();
  }
  async function moveTo(batchId: string) {
    if (!lead) return;
    const { error } = await supabase.from("leads").update({ batch_id: batchId }).eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Lead verschoben.");
    refresh();
  }
  async function remove() {
    if (!lead) return;
    const { error } = await supabase.from("leads").delete().eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Lead gelöscht.");
    refresh();
    onClose();
  }

  return (
    <Dialog open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="cc-theme cc-detail-dialog">
        <DialogHeader>
          <DialogTitle>{lead?.company || "Lead-Details"}</DialogTitle>
          <DialogDescription>Kontaktdaten, Notizen und bisherige Bearbeitung.</DialogDescription>
        </DialogHeader>
        {isLoading && <FeedbackState kind="loading" title="Kundenakte wird geladen" />}
        {isError && (
          <FeedbackState
            kind="error"
            title="Kundenakte nicht verfügbar"
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Erneut versuchen
              </Button>
            }
          />
        )}
        {!isLoading && !isError && !lead && (
          <FeedbackState kind="empty" title="Lead nicht mehr verfügbar">
            Die Liste wurde möglicherweise inzwischen geändert.
          </FeedbackState>
        )}
        {lead && (
          <>
            <div className="space-y-1 text-sm">
              <p>{[lead.contact_name, lead.city].filter(Boolean).join(" · ")}</p>
              <LeadContact
                phone={lead.phone}
                email={lead.email}
                city={lead.city}
                extra={(lead.extra ?? {}) as Record<string, unknown>}
              />
              <p>
                <StatusBadge tone="info">{STATUS_LABEL[lead.status] ?? lead.status}</StatusBadge> ·
                Versuche: {lead.attempts}
              </p>
              <p className="rounded-lg bg-primary/10 p-2">
                <b>Vorschlag: </b>
                {suggestNextStep(lead)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {lead.status !== "open" && (
                <Button size="sm" onClick={reopen}>
                  Wieder öffnen
                </Button>
              )}
              <Select onValueChange={moveTo}>
                <SelectTrigger className="h-9 w-44">
                  <SelectValue placeholder="Verschieben nach …" />
                </SelectTrigger>
                <SelectContent>
                  {data?.batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {admin && (
                <Button size="sm" variant="destructive" onClick={remove}>
                  Löschen
                </Button>
              )}
            </div>
            <div className="cc-detail-section">
              <label htmlFor="lead-note" className="cc-field-label">
                Notizen
              </label>
              <Textarea
                id="lead-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Neue Notiz …"
              />
              <Button size="sm" onClick={addNote} disabled={!note.trim()}>
                Notiz speichern
              </Button>
              {data?.notes.map((n) => (
                <p key={n.id} className="cc-note-item">
                  <time dateTime={n.created_at}>
                    {new Date(n.created_at).toLocaleString("de-DE")}
                  </time>
                  {n.body}
                </p>
              ))}
            </div>
            <div className="cc-detail-section">
              <h3>Verlauf</h3>
              <ul className="cc-history">
                {data?.history.map((h) => (
                  <li key={h.id}>
                    {new Date(h.created_at).toLocaleString("de-DE")}:{" "}
                    {STATUS_LABEL[h.old_status ?? ""] ?? h.old_status ?? "–"} →{" "}
                    {STATUS_LABEL[h.new_status] ?? h.new_status}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
