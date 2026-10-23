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
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

  const { data: leads, isLoading } = useQuery({
    queryKey: ["leads", q, status],
    queryFn: async () => {
      let query = supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(300);
      if (status !== "all") query = query.eq("status", status);
      const term = q.trim().replace(/[,()%]/g, " ");
      if (term) query = query.or(`company.ilike.%${term}%,contact_name.ilike.%${term}%,phone.ilike.%${term}%,city.ilike.%${term}%`);
      return (await query).data ?? [];
    },
  });

  async function deleteAllOpen() {
    const { error } = await supabase.from("leads").delete().eq("status", "open");
    if (error) { toast.error(error.message); return; }
    toast.success("Alle offenen Leads gelöscht.");
    qc.invalidateQueries();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Offene Leads</h1>
        {admin && (
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive" size="sm">Alle offenen Leads löschen</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Alle offenen Leads löschen?</AlertDialogTitle>
                <AlertDialogDescription>Das kann nicht rückgängig gemacht werden. Bearbeitete Leads bleiben erhalten.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={deleteAllOpen}>Löschen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Suchen (Firma, Name, Telefon, Stadt)" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {isLoading && <p className="text-muted-foreground">Lädt …</p>}
      {leads?.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">Keine Leads gefunden.</p>}
      <div className="divide-y rounded-xl border bg-card">
        {leads?.map((l) => (
          <button key={l.id} onClick={() => setOpenId(l.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-accent/50">
            <span>
              <span className="block font-medium">{l.company || "Ohne Firmenname"}</span>
              <span className="text-sm text-muted-foreground">{[l.contact_name, l.city, l.phone].filter(Boolean).join(" · ")}</span>
            </span>
            <Badge variant="secondary">{STATUS_LABEL[l.status] ?? l.status}</Badge>
          </button>
        ))}
      </div>
      {leads && leads.length === 300 && <p className="text-xs text-muted-foreground">Es werden die neuesten 300 Leads gezeigt – Suche nutzen, um einzugrenzen.</p>}
      <LeadDialog leadId={openId} userId={user.id} admin={admin} onClose={() => setOpenId(null)} />
    </div>
  );
}

function LeadDialog({ leadId, userId, admin, onClose }: { leadId: string | null; userId: string; admin: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const { data } = useQuery({
    enabled: !!leadId,
    queryKey: ["lead-detail", leadId],
    queryFn: async () => {
      const [l, n, s, b] = await Promise.all([
        supabase.from("leads").select("*").eq("id", leadId!).maybeSingle(),
        supabase.from("lead_notes").select("*").eq("lead_id", leadId!).order("created_at", { ascending: false }),
        supabase.from("status_changes").select("*").eq("lead_id", leadId!).order("created_at", { ascending: false }),
        supabase.from("lead_batches").select("id,name").order("created_at", { ascending: false }),
      ]);
      return { lead: l.data, notes: n.data ?? [], history: s.data ?? [], batches: b.data ?? [] };
    },
  });
  const lead = data?.lead;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["lead-detail", leadId] }); qc.invalidateQueries({ queryKey: ["leads"] }); qc.invalidateQueries({ queryKey: ["batches"] }); };

  async function addNote() {
    if (!note.trim() || !leadId) return;
    const { error } = await supabase.from("lead_notes").insert({ lead_id: leadId, user_id: userId, body: note.trim() });
    if (error) { toast.error(error.message); return; }
    setNote(""); refresh();
  }
  async function reopen() {
    if (!lead) return;
    const { error } = await supabase.from("leads").update({ status: "open" }).eq("id", lead.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("status_changes").insert({ lead_id: lead.id, user_id: userId, old_status: lead.status, new_status: "open" });
    toast.success("Lead wieder geöffnet."); refresh();
  }
  async function moveTo(batchId: string) {
    if (!lead) return;
    const { error } = await supabase.from("leads").update({ batch_id: batchId }).eq("id", lead.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Lead verschoben."); refresh();
  }
  async function remove() {
    if (!lead) return;
    const { error } = await supabase.from("leads").delete().eq("id", lead.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Lead gelöscht."); refresh(); onClose();
  }

  return (
    <Dialog open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {lead && (
          <>
            <DialogHeader><DialogTitle>{lead.company || "Ohne Firmenname"}</DialogTitle></DialogHeader>
            <div className="space-y-1 text-sm">
              <p>{[lead.contact_name, lead.city].filter(Boolean).join(" · ")}</p>
              {lead.phone && <a className="font-semibold text-primary" href={`tel:${lead.phone}`}>{lead.phone}</a>}
              {lead.email && <p>{lead.email}</p>}
              <p><Badge variant="secondary">{STATUS_LABEL[lead.status] ?? lead.status}</Badge> · Versuche: {lead.attempts}</p>
              <p className="rounded-lg bg-primary/10 p-2"><b>Vorschlag: </b>{suggestNextStep(lead)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {lead.status !== "open" && <Button size="sm" onClick={reopen}>Wieder öffnen</Button>}
              <Select onValueChange={moveTo}>
                <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Verschieben nach …" /></SelectTrigger>
                <SelectContent>{data?.batches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
              {admin && <Button size="sm" variant="destructive" onClick={remove}>Löschen</Button>}
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Notizen</h3>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Neue Notiz …" />
              <Button size="sm" onClick={addNote} disabled={!note.trim()}>Notiz speichern</Button>
              {data?.notes.map((n) => (
                <p key={n.id} className="rounded-lg border p-2 text-sm"><span className="block text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString("de-DE")}</span>{n.body}</p>
              ))}
            </div>
            <div>
              <h3 className="mb-1 font-semibold">Verlauf</h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {data?.history.map((h) => (
                  <li key={h.id}>{new Date(h.created_at).toLocaleString("de-DE")}: {STATUS_LABEL[h.old_status ?? ""] ?? h.old_status ?? "–"} → {STATUS_LABEL[h.new_status] ?? h.new_status}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
