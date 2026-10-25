import { useCountry } from "@/lib/country";
import { backendEnabled, backendRpc, type LeadClaim } from "@/lib/backend";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SCRIPT, fillScript, suggestNextStep } from "@/lib/leads";
import {
  Building2,
  CalendarClock,
  Check,
  Lightbulb,
  Phone,
  PhoneMissed,
  Send,
  X,
} from "@/components/coldcaller/icons-3d";
import {
  FeedbackState,
  InfoButton,
  StatusBadge,
  Surface,
} from "@/components/coldcaller/primitives";
import { PageHeading, LeadContact } from "@/components/coldcaller/workspace-parts";
import { CallbackDialog } from "@/components/coldcaller/callback-dialog";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/call")({
  head: () => ({ meta: [{ title: "Anrufen – Sign Selector Cold Caller" }] }),
  component: CallPage,
});

type Outcome = "not_reached" | "no_interest" | "callback" | "appointment" | "production";

function CallPage() {
  const country = useCountry();
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<
    Record<string, { note: string; when: string; pending: Outcome | null }>
  >({});
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [useCallback, setUseCallback] = useState(false);
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
        .data?.value ?? null,
  });
  const reservation = useQuery({
    queryKey: ["next-lead", "claim", user.id, country],
    enabled: backendEnabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => (await backendRpc("claim_next_lead", { p_country: country } as never)) as LeadClaim | null,
  });
  const claimId = reservation.data?.claim_id;
  useEffect(() => {
    if (!claimId) return;
    const timer = setInterval(() => {
      backendRpc("renew_lead_claim", { p_claim_id: claimId }).catch(() =>
        qc.invalidateQueries({ queryKey: ["next-lead", "claim"] }),
      );
    }, 120_000);
    return () => clearInterval(timer);
  }, [claimId, qc]);
  const {
    data: dueCb,
    isLoading: callbackLoading,
    isError: callbackError,
    refetch: refetchCallback,
  } = useQuery({
    queryKey: ["next-lead", "due-callback"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("callbacks")
        .select("id,due_at,lead:leads(*)")
        .eq("done", false)
        .eq("user_id", user.id)
        .lte("due_at", new Date().toISOString())
        .order("due_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const {
    data: openLead,
    isLoading,
    isError: leadError,
    refetch: refetchLead,
  } = useQuery({
    queryKey: ["next-lead"],
    enabled: !backendEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("status", "open")
        .order("last_called_at", { ascending: true, nullsFirst: true })
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const lead = backendEnabled
    ? reservation.data?.lead
    : useCallback
      ? (dueCb?.lead ?? openLead)
      : (openLead ?? dueCb?.lead);
  const selectedCallback = dueCb?.lead?.id === lead?.id ? dueCb : null;
  const activeCallbackId = backendEnabled ? reservation.data?.callback_id : selectedCallback?.id;
  const draftKey = lead?.id ?? "";
  const { note = "", when = "", pending = null } = drafts[draftKey] ?? {};
  function updateDraft(patch: Partial<{ note: string; when: string; pending: Outcome | null }>) {
    setDrafts((current) => ({
      ...current,
      [draftKey]: { note: "", when: "", pending: null, ...current[draftKey], ...patch },
    }));
  }
  const setNote = (value: string) => updateDraft({ note: value });
  const setWhen = (value: string) => updateDraft({ when: value });
  const setPending = (value: Outcome | null) => updateDraft({ pending: value });
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
    if (selectedCallback?.lead)
      await supabase.from("callbacks").update({ done: true }).eq("id", selectedCallback.id);
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
      toast.error("Speichern fehlgeschlagen. Deine Notiz bleibt erhalten. Bitte erneut versuchen.");
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
    if (!backendEnabled) return recordLegacy(outcome);
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

  if ((backendEnabled ? reservation.isLoading : isLoading) || callbackLoading)
    return <FeedbackState kind="loading" title="Dein nächstes Gespräch wird vorbereitet" />;
  if ((backendEnabled ? reservation.isError : leadError) || callbackError)
    return (
      <FeedbackState
        kind="error"
        title="Arbeitsliste gerade nicht verfügbar"
        action={
          <Button
            variant="outline"
            onClick={() => {
              if (backendEnabled) reservation.refetch();
              else refetchLead();
              refetchCallback();
            }}
          >
            Erneut versuchen
          </Button>
        }
      >
        Deine Entwürfe bleiben erhalten. Bitte lade die Arbeitsliste erneut.
      </FeedbackState>
    );
  if (!lead)
    return (
      <div className="cc-page">
        <PageHeading title="Anrufen" description="Dein Arbeitsplatz für gute Gespräche." />
        <Surface title="Alles bearbeitet">
          <FeedbackState
            kind="empty"
            title="Keine offenen Leads oder fälligen Rückrufe"
            action={
              <Button asChild>
                <Link to="/import">Leads importieren</Link>
              </Button>
            }
          >
            Neue Kontakte erscheinen hier nach dem Import.
          </FeedbackState>
        </Surface>
      </div>
    );

  const script = fillScript(savedScript ?? DEFAULT_SCRIPT, {
    firma: lead.company,
    ansprechpartner: lead.contact_name,
    stadt: lead.city,
    caller: me?.display_name,
  });
  const extra = (lead.extra ?? {}) as Record<string, unknown>;
  const extraEntries = Object.entries(extra);

  return (
    <div className="cc-page">
      <PageHeading
        title="Dein nächstes Gespräch."
        description="Kontaktdaten, Leitfaden und Notizen. Alles direkt griffbereit."
        action={
          dueCb?.lead ? (
            <Button variant="outline" onClick={() => setCallbackOpen(true)} disabled={busy}>
              <CalendarClock />
              Fälligen Rückruf ansehen
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to="/callbacks">
                <CalendarClock />
                Rückrufe öffnen
              </Link>
            </Button>
          )
        }
      />
      <div className="cc-work-grid">
        <Surface
          title={selectedCallback ? "Vereinbarter Rückruf" : "Anruf-Arbeitsplatz"}
          action={
            <StatusBadge tone={selectedCallback ? "warning" : "info"}>
              {selectedCallback ? "Rückruf fällig" : `Versuch ${lead.attempts + 1}`}
            </StatusBadge>
          }
        >
          <div className="cc-call-body">
            <div className="cc-company">
              <span className="cc-company-icon">
                <Building2 size={27} aria-hidden="true" />
              </span>
              <div>
                <h2>{lead.company || "Ohne Firmenname"}</h2>
                <p>{lead.contact_name || "Kein Ansprechpartner hinterlegt"}</p>
              </div>
            </div>
            <LeadContact phone={lead.phone} email={lead.email} city={lead.city} extra={extra} />
            <div className="cc-suggestion">
              <Lightbulb size={20} aria-hidden="true" />
              <div>
                <strong>Nächster Schritt</strong>
                {suggestNextStep(lead, { callbackDueAt: selectedCallback?.due_at ?? null })}
              </div>
            </div>
            <div>
              <div className="cc-field-label">
                <label htmlFor="call-note">Gesprächsnotiz</label>
                <InfoButton label="Gesprächsnotiz">
                  Dein Entwurf bleibt beim Öffnen des Rückrufdialogs und beim Wechsel zwischen den
                  angezeigten Leads erhalten. Erst nach erfolgreichem Speichern wird er geleert.
                  Beim Verlassen der Seite ist er noch nicht dauerhaft gesichert.
                </InfoButton>
              </div>
              <Textarea
                id="call-note"
                className="cc-call-note"
                placeholder="Was ist für das nächste Gespräch wichtig?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
              />
              <p className="cc-field-help">Entwurf für diesen Lead · noch nicht gespeichert</p>
            </div>
            {pending && (
              <div className="cc-callback-form">
                <label htmlFor="call-time">
                  {pending === "callback" ? "Wann sollen wir zurückrufen?" : "Zeitpunkt"}
                </label>
                <Input
                  id="call-time"
                  type="datetime-local"
                  value={when}
                  disabled={busy}
                  onChange={(e) => setWhen(e.target.value)}
                />
                <div>
                  <Button disabled={busy || !when} onClick={() => record(pending)}>
                    <Check />
                    {busy
                      ? "Wird gespeichert …"
                      : pending === "appointment"
                        ? "Termin speichern"
                        : "Rückruf speichern"}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            )}
            <div className="cc-call-actions">
              <Button variant="outline" disabled={busy} onClick={() => record("not_reached")}>
                <PhoneMissed />
                Nicht erreicht
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setPending("callback")}>
                <CalendarClock />
                Rückruf planen
              </Button>
              <Button variant="destructive" disabled={busy} onClick={() => record("no_interest")}>
                <X />
                Kein Interesse
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => record("production")}>
                <Send />
                Deal in Produktion
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setPending("appointment")}>
                <CalendarClock />
                Termin buchen
              </Button>
              {useCallback && openLead && openLead.id !== lead.id && (
                <Button variant="outline" disabled={busy} onClick={() => setUseCallback(false)}>
                  Zurück zum offenen Lead
                </Button>
              )}
            </div>
            <p className="cc-field-help">
              „Nicht erreicht“ bleibt ein internes Anrufergebnis und ist keine CRM-Stage.
            </p>
            {extraEntries.length > 0 && (
              <details>
                <summary className="text-sm font-medium cursor-pointer">
                  Weitere importierte Angaben
                </summary>
                <dl className="cc-imported mt-3">
                  {extraEntries.map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </div>
        </Surface>
        <Surface
          title="Dein Gesprächsleitfaden"
          description="Orientierung für einen klaren Erstkontakt"
          action={
            <InfoButton label="Gesprächsleitfaden">
              Firma, Ansprechpartner, Ort und dein Name werden aus den vorhandenen Daten eingesetzt.
              Admins können den Leitfaden in den Einstellungen bearbeiten.
            </InfoButton>
          }
        >
          <p className="cc-script">{script}</p>
        </Surface>
      </div>
      {dueCb?.lead && (
        <CallbackDialog
          actionLabel="Rückruf im Arbeitsplatz öffnen"
          open={callbackOpen}
          onOpenChange={setCallbackOpen}
          callback={{
            company: dueCb.lead.company || "Ohne Firmenname",
            contact: dueCb.lead.contact_name || "Ansprechpartner nicht hinterlegt",
            phone: dueCb.lead.phone || "Telefon nicht hinterlegt",
            dueLabel: new Date(dueCb.due_at).toLocaleString("de-DE"),
            note: "Öffnet diesen Rückruf im Arbeitsplatz. Dein bisheriger Notizentwurf bleibt für den vorherigen Lead erhalten.",
          }}
          onCall={async () => {
            if (!busy) {
              if (backendEnabled && claimId && dueCb.lead?.id !== lead.id) {
                try {
                  await backendRpc("renew_lead_claim", { p_claim_id: claimId, p_release: true });
                  await qc.invalidateQueries({ queryKey: ["next-lead", "claim"] });
                } catch {
                  toast.error("Rückruf konnte nicht reserviert werden.");
                  return;
                }
              }
              setUseCallback(true);
              setCallbackOpen(false);
            }
          }}
        />
      )}
    </div>
  );
}
