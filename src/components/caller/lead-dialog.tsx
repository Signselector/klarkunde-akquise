import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { backendEnabled } from "@/lib/backend";
import type { Tables } from "@/integrations/supabase/types";
import { STATUS_LABEL, suggestNextStep } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FeedbackState, StatusBadge } from "@/components/coldcaller/primitives";
import { LeadContact } from "@/components/coldcaller/workspace-parts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export function LeadDialog({
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
    const { error } = await (backendEnabled
      ? supabase.rpc("reopen_lead", {
          p_request_id: crypto.randomUUID(),
          p_lead_id: lead.id,
          p_expected_version: lead.version,
          p_reason: note.trim() || "Manuell wieder geöffnet",
        })
      : supabase.from("leads").update({ status: "open" }).eq("id", lead.id));
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!backendEnabled)
      await supabase
        .from("status_changes")
        .insert({ lead_id: lead.id, user_id: userId, old_status: lead.status, new_status: "open" });
    toast.success("Lead wieder geöffnet.");
    refresh();
  }
  async function moveTo(batchId: string) {
    if (!lead) return;
    const { error } = await (backendEnabled
      ? supabase.rpc("move_lead", {
          p_lead_id: lead.id,
          p_expected_version: lead.version,
          p_batch_id: batchId,
        })
      : supabase.from("leads").update({ batch_id: batchId }).eq("id", lead.id));
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Lead verschoben.");
    refresh();
  }
  async function remove() {
    if (!lead) return;
    const { error } = await (backendEnabled
      ? supabase.rpc("archive_leads", { p_ids: [lead.id] })
      : supabase.from("leads").delete().eq("id", lead.id));
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Lead entfernt.");
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
            {backendEnabled && (
              <LeadContactEditor key={`${lead.id}:${lead.version}`} lead={lead} onSaved={refresh} />
            )}
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

function LeadContactEditor({ lead, onSaved }: { lead: Tables<"leads">; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState({
    company: lead.company ?? "",
    contact_name: lead.contact_name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    city: lead.city ?? "",
  });
  const labels = {
    company: "Firma",
    contact_name: "Ansprechpartner",
    email: "E-Mail",
    phone: "Telefon",
    city: "Stadt",
  };
  async function save() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("update_lead_contact", {
        p_lead_id: lead.id,
        p_expected_version: lead.version,
        p_contact: contact,
      });
      if (error) {
        toast.error(
          "Kontaktdaten konnten nicht gespeichert werden. Eingaben und aktuellen Leadstand prüfen.",
        );
        return;
      }
      setEditing(false);
      onSaved();
    } catch {
      toast.error("Verbindung unterbrochen. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }
  if (!editing)
    return (
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        Kontaktdaten bearbeiten
      </Button>
    );
  return (
    <div className="space-y-2">
      {(Object.keys(contact) as (keyof typeof contact)[]).map((key) => (
        <label className="block text-sm" key={key}>
          {labels[key]}
          <Input
            value={contact[key]}
            onChange={(event) => setContact({ ...contact, [key]: event.target.value })}
          />
        </label>
      ))}
      <Button disabled={busy} onClick={save}>
        Kontaktdaten speichern
      </Button>
    </div>
  );
}
