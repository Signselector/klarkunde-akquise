import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { backendEnabled, backendRpc, type LeadClaim } from "@/lib/backend";
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
  const inFlight = useRef(false);
  const lastRequest = useRef<{ payload: string; id: string } | null>(null);

  const { data: me } = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () =>
      (await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()).data,
  });
  const { data: savedScript } = useQuery({
    queryKey: ["script"],
    queryFn: async () =>
      (await supabase.from("app_settings").select("value").eq("key", "call_script").maybeSingle())
        .data?.value,
  });
  const reservation = useQuery({
    queryKey: ["next-lead", "claim", user.id],
    enabled: backendEnabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => (await backendRpc("claim_next_lead", {})) as LeadClaim | null,
  });
  const claimId = reservation.data?.claim_id;
  useEffect(() => {
    if (!claimId) return;
    const timer = setInterval(() => {
      backendRpc("renew_lead_claim", { p_claim_id: claimId }).catch(() => {
        qc.invalidateQueries({ queryKey: ["next-lead", "claim"] });
      });
    }, 120_000);
    return () => clearInterval(timer);
  }, [claimId, qc]);
  const { data: dueCb } = useQuery({
    queryKey: ["next-lead", "due-callback"],
    enabled: !backendEnabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("callbacks")
        .select("id,due_at,lead:leads(*)")
        .eq("done", false)
        .eq("user_id", user.id)
        .lte("due_at", new Date().toISOString())
        .order("due_at")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  const { data: openLead, isLoading } = useQuery({
    queryKey: ["next-lead"],
    enabled: !backendEnabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("*")
        .eq("status", "open")
        .order("last_called_at", { ascending: true, nullsFirst: true })
        .order("created_at")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const lead = backendEnabled ? reservation.data?.lead : (dueCb?.lead ?? openLead);
  const activeCallbackId = backendEnabled ? reservation.data?.callback_id : dueCb?.id;
  async function recordLegacy(outcome: Outcome) {
    if (!lead) return;
    if ((outcome === "callback" || outcome === "appointment") && !when) {
      setPending(outcome);
      {
        toast.message("Bitte Datum und Uhrzeit wählen.");
        return;
      }
    }
    setBusy(true);
    const newStatus = outcome === "not_reached" ? "open" : outcome;
    if (dueCb?.lead) await supabase.from("callbacks").update({ done: true }).eq("id", dueCb.id);
    const now = new Date().toISOString();
    const ops: PromiseLike<{ error: { message: string } | null }>[] = [
      supabase
        .from("leads")
        .update({
          status: newStatus,
          attempts: lead.attempts + 1,
          last_called_at: now,
          last_called_by: user.id,
        })
        .eq("id", lead.id),
      supabase.from("status_changes").insert({
        lead_id: lead.id,
        user_id: user.id,
        old_status: lead.status,
        new_status: outcome,
      }),
    ];
    if (note.trim())
      ops.push(
        supabase
          .from("lead_notes")
          .insert({ lead_id: lead.id, user_id: user.id, body: note.trim() }),
      );
    if (outcome === "callback")
      ops.push(
        supabase
          .from("callbacks")
          .insert({ lead_id: lead.id, user_id: user.id, due_at: new Date(when).toISOString() }),
      );
    if (outcome === "appointment")
      ops.push(
        supabase.from("appointments").insert({
          lead_id: lead.id,
          user_id: user.id,
          starts_at: new Date(when).toISOString(),
          notes: note || null,
        }),
      );
    const res = await Promise.all(ops);
    setBusy(false);
    const err = res.find((r) => r.error)?.error;
    if (err) {
      toast.error("Speichern fehlgeschlagen: " + err.message);
      return;
    }
    toast.success("Gespeichert – nächster Lead.");
    setNote("");
    setWhen("");
    setPending(null);
    qc.invalidateQueries({ queryKey: ["next-lead"] });
    qc.invalidateQueries({ queryKey: ["batches"] });
    qc.invalidateQueries({ queryKey: ["callbacks"] });
  }

  async function record(outcome: Outcome) {
    if (import.meta.env["VITE_ATOMIC_BACKEND_ENABLED"] !== "true") return recordLegacy(outcome);
    if (!lead) return;
    if ((outcome === "callback" || outcome === "appointment") && !when) {
      setPending(outcome);
      {
        toast.message("Bitte Datum und Uhrzeit wählen.");
        return;
      }
    }
    if (inFlight.current) return;
    const scheduledAt = when ? new Date(when) : null;
    if (
      (outcome === "callback" || outcome === "appointment") &&
      (!scheduledAt ||
        !Number.isFinite(scheduledAt.getTime()) ||
        scheduledAt.getTime() <= Date.now())
    ) {
      toast.error("Bitte einen gültigen zukünftigen Zeitpunkt wählen.");
      return;
    }
    const args = {
      p_lead_id: lead.id,
      p_expected_attempts: lead.attempts,
      p_outcome: outcome,
      ...(note.trim() ? { p_note: note.trim() } : {}),
      ...((outcome === "callback" || outcome === "appointment") && scheduledAt
        ? { p_scheduled_at: scheduledAt.toISOString() }
        : {}),
      ...(activeCallbackId ? { p_callback_id: activeCallbackId } : {}),
    };
    const payload = JSON.stringify(args);
    if (lastRequest.current?.payload !== payload) {
      lastRequest.current = { payload, id: crypto.randomUUID() };
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("record_call_outcome", {
        ...args,
        p_request_id: lastRequest.current.id,
      });
      if (error) {
        if (
          error.message.includes("stale_lead") ||
          error.message.includes("callback_conflict") ||
          error.message.includes("claim_expired")
        ) {
          toast.error(
            "Der Lead oder Rückruf wurde inzwischen geändert. Bitte den aktuellen Stand prüfen.",
          );
          await qc.invalidateQueries({ queryKey: ["next-lead"] });
        } else {
          toast.error("Speichern fehlgeschlagen. Bitte erneut versuchen.");
        }
        return;
      }
    } catch {
      toast.error("Verbindung unterbrochen. Bitte erneut versuchen.");
      return;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    lastRequest.current = null;
    toast.success("Gespeichert – nächster Lead.");
    setNote("");
    setWhen("");
    setPending(null);
    qc.invalidateQueries({ queryKey: ["next-lead"] });
    qc.invalidateQueries({ queryKey: ["batches"] });
    qc.invalidateQueries({ queryKey: ["callbacks"] });
  }

  if (backendEnabled && reservation.isError)
    return <p>Lead konnte nicht geladen werden. Bitte erneut versuchen.</p>;
  if (backendEnabled ? reservation.isLoading : isLoading)
    return <p className="text-muted-foreground">Lädt …</p>;
  if (!lead)
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        Keine offenen Leads. Importiere neue Leads.
      </p>
    );

  const script = fillScript(savedScript ?? DEFAULT_SCRIPT, {
    firma: lead.company,
    ansprechpartner: lead.contact_name,
    stadt: lead.city,
    caller: me?.display_name,
  });
  const extra = Object.entries((lead.extra ?? {}) as Record<string, string>);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <section className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {activeCallbackId ? "Fälliger Callback" : "Nächster Lead"} · Versuch {lead.attempts + 1}
          </p>
          <h1 className="text-[22px] font-semibold">{lead.company || "Ohne Firmenname"}</h1>
          <p className="text-muted-foreground">
            {[lead.contact_name, lead.city].filter(Boolean).join(" · ")}
          </p>
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="mt-3 inline-block text-2xl font-semibold text-primary"
            >
              {lead.phone}
            </a>
          )}
          {lead.email && <p className="text-sm">{lead.email}</p>}
          {extra.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 text-sm">
              {extra.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">
          <span className="font-semibold">Vorschlag: </span>
          {suggestNextStep(lead, { callbackDueAt: dueCb?.due_at ?? null })}
        </div>
        <Textarea
          placeholder="Notiz zum Gespräch …"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {pending && (
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <p className="text-sm font-medium">
              {pending === "callback" ? "Callback am" : "Termin am"}
            </p>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <Button disabled={busy || !when} onClick={() => record(pending)}>
              Speichern
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy} onClick={() => record("not_reached")}>
            Nicht erreicht
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => record("no_interest")}>
            Kein Interesse
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setPending("callback")}>
            Callback
          </Button>
          <Button disabled={busy} onClick={() => setPending("appointment")}>
            Termin buchen
          </Button>
          <Button
            className="col-span-2"
            variant="outline"
            disabled={busy}
            onClick={() => record("production")}
          >
            Deal in Produktion
          </Button>
        </div>
      </section>
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 font-semibold">Gesprächsleitfaden</h2>
        <p className="whitespace-pre-wrap leading-relaxed">{script}</p>
      </section>
    </div>
  );
}
