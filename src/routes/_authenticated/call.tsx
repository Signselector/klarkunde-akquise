import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SCRIPT, fillScript, suggestNextStep } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/call")({
  head: () => ({ meta: [{ title: "Anrufen – Cold Call Tool" }] }),
  component: CallPage,
});

type Outcome = "not_reached" | "no_interest" | "callback" | "appointment" | "production";

function CallPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [pending, setPending] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => (await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()).data,
  });
  const { data: lead, isLoading } = useQuery({
    queryKey: ["next-lead"],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("*").eq("status", "open")
        .order("last_called_at", { ascending: true, nullsFirst: true }).order("created_at").limit(1).maybeSingle();
      return data;
    },
  });

  async function record(outcome: Outcome) {
    if (!lead) return;
    if ((outcome === "callback" || outcome === "appointment") && !when) {
      setPending(outcome);
      return toast.message("Bitte Datum und Uhrzeit wählen.");
    }
    setBusy(true);
    const newStatus = outcome === "not_reached" ? "open" : outcome;
    const now = new Date().toISOString();
    const ops = [
      supabase.from("leads").update({ status: newStatus, attempts: lead.attempts + 1, last_called_at: now, last_called_by: user.id }).eq("id", lead.id),
      supabase.from("status_changes").insert({ lead_id: lead.id, user_id: user.id, old_status: lead.status, new_status: outcome }),
    ];
    if (note.trim()) ops.push(supabase.from("lead_notes").insert({ lead_id: lead.id, user_id: user.id, body: note.trim() }));
    if (outcome === "callback") ops.push(supabase.from("callbacks").insert({ lead_id: lead.id, user_id: user.id, due_at: new Date(when).toISOString() }));
    if (outcome === "appointment") ops.push(supabase.from("appointments").insert({ lead_id: lead.id, user_id: user.id, starts_at: new Date(when).toISOString(), notes: note || null }));
    const res = await Promise.all(ops);
    setBusy(false);
    const err = res.find((r) => r.error)?.error;
    if (err) return toast.error("Speichern fehlgeschlagen: " + err.message);
    toast.success("Gespeichert – nächster Lead.");
    setNote(""); setWhen(""); setPending(null);
    qc.invalidateQueries({ queryKey: ["next-lead"] });
    qc.invalidateQueries({ queryKey: ["batches"] });
  }

  if (isLoading) return <p className="text-muted-foreground">Lädt …</p>;
  if (!lead) return <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">Keine offenen Leads. Importiere neue Leads.</p>;

  const script = fillScript(DEFAULT_SCRIPT, {
    firma: lead.company, ansprechpartner: lead.contact_name, stadt: lead.city, caller: me?.display_name,
  });
  const extra = Object.entries((lead.extra ?? {}) as Record<string, string>);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <section className="space-y-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Nächster Lead · Versuch {lead.attempts + 1}</p>
          <h1 className="font-display text-2xl font-bold">{lead.company || "Ohne Firmenname"}</h1>
          <p className="text-muted-foreground">{[lead.contact_name, lead.city].filter(Boolean).join(" · ")}</p>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="mt-3 inline-block text-2xl font-semibold text-primary">{lead.phone}</a>
          )}
          {lead.email && <p className="text-sm">{lead.email}</p>}
          {extra.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 text-sm">
              {extra.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>))}
            </dl>
          )}
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm">
          <span className="font-semibold">Vorschlag: </span>{suggestNextStep(lead)}
        </div>
        <Textarea placeholder="Notiz zum Gespräch …" value={note} onChange={(e) => setNote(e.target.value)} />
        {pending && (
          <div className="space-y-2 rounded-xl border bg-card p-3">
            <p className="text-sm font-medium">{pending === "callback" ? "Callback am" : "Termin am"}</p>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <Button disabled={busy || !when} onClick={() => record(pending)}>Speichern</Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy} onClick={() => record("not_reached")}>Nicht erreicht</Button>
          <Button variant="destructive" disabled={busy} onClick={() => record("no_interest")}>Kein Interesse</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setPending("callback")}>Callback</Button>
          <Button disabled={busy} onClick={() => setPending("appointment")}>Termin buchen</Button>
          <Button className="col-span-2" variant="outline" disabled={busy} onClick={() => record("production")}>Deal in Produktion</Button>
        </div>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">Gesprächsleitfaden</h2>
        <p className="whitespace-pre-wrap leading-relaxed">{script}</p>
      </section>
    </div>
  );
}
