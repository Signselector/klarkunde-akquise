import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { syncLeadAction } from "@/lib/crm-sync.functions";
import { sendLeadEmail } from "@/lib/lead-email.functions";
import { syncMyCalendar } from "@/lib/calendar-sync.functions";
import { useCountry } from "@/lib/country";
import { emailErrorMessage, isValidEmail } from "@/lib/lead-email";
import { crmErrorMessage } from "@/lib/crm-sync";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import {
  ACTION_LABEL,
  actionErrorMessage,
  fillTemplate,
  LEAD_ACTIONS,
  type LeadAction,
  type LeadActionKey,
} from "@/lib/lead-actions";
import { Mail } from "@/components/coldcaller/icons";
import { SuccessBanner } from "@/components/coldcaller/success-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Template = { id: string; name: string; subject?: string; body: string };
const STAGE_NAME: Record<string, string> = {
  low_q: "Logo Render",
  high_q: "Realismus Render",
  waiting_3d: "Logo ausstehend",
  on_hold: "Zukunftsprojekt",
  reference_mail: "Referenzmail",
};
const isMailAction = (k: LeadActionKey | null): k is "reference_mail" => k === "reference_mail";
const TEMPLATE_KEY = { reference_mail: "email_templates" };
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

function parseTemplates(raw: string | null | undefined): Template[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const fail = (message: string): void => {
  toast.error(message);
};

function toIso(date: string, time: string) {
  const when = new Date(`${date}T${time || "09:00"}`);
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}

type Result = {
  action: LeadActionKey;
  stage_key: string | null;
  crm_sync_state: string | null;
};

/**
 * "Gesprächsergebnis": the actions a caller picks after a phone call. Everything is written by the
 * `record_lead_action` function, which checks ownership and required inputs on the server.
 */
export function LeadActions({
  lead,
  userId,
  callerName,
  onDone,
}: {
  lead: Tables<"leads">;
  userId: string;
  callerName: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const sync = useServerFn(syncLeadAction);
  const sendMail = useServerFn(sendLeadEmail);
  const syncCalendar = useServerFn(syncMyCalendar);
  const country = useCountry();
  const [active, setActive] = useState<LeadActionKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [success, setSuccess] = useState<{
    title: string;
    description: string;
    special: boolean;
  } | null>(null);
  // One request id per attempt: a retry after a lost connection can never record the action twice.
  const requestId = useRef<string | null>(null);
  const uploaded = useRef<string | null>(null);

  const [mail, setMail] = useState({ to: lead.email ?? "", subject: "", body: "", template: "" });
  // Review step and delivery state of the e-mail. The lead is only completed after a confirmed send.
  const [preview, setPreview] = useState(false);
  const [mailState, setMailState] = useState<{
    id: string | null;
    status: "idle" | "sending" | "sent" | "simulated" | "failed";
    error: string | null;
  }>({ id: null, status: "idle", error: null });
  const mailRequest = useRef<string | null>(null);

  const templateKey = isMailAction(active) ? TEMPLATE_KEY[active] : null;
  const templates = useQuery({
    enabled: templateKey !== null,
    queryKey: ["templates", templateKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", templateKey ?? "email_templates")
        .maybeSingle();
      if (error) throw error;
      return parseTemplates(data?.value);
    },
  });

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 8000);
    return () => window.clearTimeout(timer);
  }, [success]);

  const slots = useQuery({
    enabled: active === "callback" || active === "on_hold",
    queryKey: ["callback-slots", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("callbacks")
        .select("lead_id,due_at")
        .eq("user_id", userId)
        .eq("done", false);
      if (error) throw error;
      return data ?? [];
    },
  });
  const chosen = date && time ? toIso(date, time) : null;
  const minute = (iso: string) => Math.floor(new Date(iso).getTime() / 60000);
  const slotTaken =
    !!chosen &&
    !!slots.data?.some((c) => c.lead_id !== lead.id && minute(c.due_at) === minute(chosen));
  const current = LEAD_ACTIONS.find((a) => a.key === active) ?? null;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function open(action: LeadAction) {
    if (busy) return;
    requestId.current = crypto.randomUUID();
    uploaded.current = null;
    setNote("");
    setDate("");
    setTime("");
    setFile(null);
    if (isMailAction(action.key)) {
      mailRequest.current = crypto.randomUUID();
      setPreview(false);
      setMailState({ id: null, status: "idle", error: null });
      setMail({ to: lead.email ?? "", subject: "", body: "", template: "" });
      setActive(action.key);
      return;
    }
    // Actions without extra inputs are recorded straight away, no confirmation step.
    if (!action.needs.note && !action.needs.logo && !action.needs.schedule) {
      void submit(action);
      return;
    }
    setActive(action.key);
  }

  function refreshLists() {
    void qc.invalidateQueries({ queryKey: ["leads"] });
    void qc.invalidateQueries({ queryKey: ["lead-list"] });
    void qc.invalidateQueries({ queryKey: ["callbacks"] });
  }

  function pickTemplate(id: string) {
    const t = templates.data?.find((x) => x.id === id);
    if (!t) return setMail((m) => ({ ...m, template: "" }));
    const values = {
      firma: lead.company,
      ansprechpartner: lead.contact_name,
      stadt: lead.city,
      caller: callerName,
    };
    setMail((m) => ({
      ...m,
      template: t.id,
      subject: fillTemplate(t.subject ?? "", values),
      body: fillTemplate(t.body, values),
    }));
  }

  async function uploadLogo(f: File) {
    if (uploaded.current) return uploaded.current;
    const safe = f.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
    const path = `${userId}/${lead.id}/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase.storage
      .from("lead-logos")
      .upload(path, f, f.type ? { contentType: f.type } : {});
    if (error) throw new Error("logo_upload_failed");
    uploaded.current = path;
    return path;
  }

  async function submit(action: LeadAction, emailId?: string) {
    if (busy) return;
    const needs = action.needs;
    if (needs.note === "required" && !note.trim())
      return fail("Bitte eine Gesprächsnotiz eintragen.");
    if (needs.logo && !file) return fail("Bitte das Firmenlogo hochladen.");
    if (needs.schedule === "required" && !date) return fail("Bitte Datum und Uhrzeit wählen.");
    if (needs.schedule === "required" && !time) return fail("Bitte eine Uhrzeit wählen.");
    let at: string | null = null;
    if (date) {
      at = toIso(date, time);
      if (!at) return fail("Datum oder Uhrzeit sind ungültig.");
    }
    if (needs.logo && file && file.size > MAX_LOGO_BYTES)
      return fail("Das Logo darf höchstens 5 MB groß sein.");
    setBusy(true);
    try {
      const logo = needs.logo && file ? await uploadLogo(file) : undefined;
      let details: Json | undefined;
      if (isMailAction(action.key))
        details = { email_id: emailId ?? mailState.id ?? "", template: mail.template || null };
      const { data, error } = await supabase.rpc("record_lead_action", {
        p_request_id: requestId.current ?? crypto.randomUUID(),
        p_lead_id: lead.id,
        p_expected_version: lead.version,
        p_action: action.key,
        ...(note.trim() ? { p_note: note.trim() } : {}),
        ...(at ? { p_scheduled_at: at } : {}),
        ...(logo ? { p_logo_path: logo } : {}),
        ...(details ? { p_details: details } : {}),
      });
      if (error) throw new Error(error.message);
      const result = data as unknown as Result & { action_id?: string };
      const stage = result.stage_key ? STAGE_NAME[result.stage_key] : null;
      const special = action.celebration === "special";
      const plain =
        action.key === "callback"
          ? "Du wirst zur gewählten Zeit erinnert."
          : action.key === "no_interest"
            ? "Der Lead bleibt unter Offene Leads, kein CRM-Deal."
            : action.key === "not_reached"
              ? "Kontaktversuch gespeichert. Der Lead bleibt unter Offene Leads, kein CRM-Deal."
              : "Gespeichert.";
      setSuccess({
        title: `${ACTION_LABEL[action.key]} gespeichert`,
        description: stage ? `Deal in Pipedrive wird in der Stage „${stage}“ angelegt …` : plain,
        special,
      });
      requestId.current = null;
      setActive(null);
      setPreview(false);
      refreshLists();
      onDone();
      // A new callback or follow-up goes to the user's Pipedrive calendar right away; the scheduled sync repeats it if this fails.
      if (action.key === "callback" || (action.key === "on_hold" && at))
        void syncCalendar({ data: { country } }).catch(() => undefined);
      if (stage && result.action_id) {
        // The action is saved either way; a failed CRM sync stays visible and can be retried in the history.
        try {
          const synced = await sync({ data: { actionId: result.action_id } });
          if (synced.state === "synced")
            setSuccess({
              title: `${ACTION_LABEL[action.key]} gespeichert`,
              description: `Deal in Pipedrive angelegt (Stage „${stage}“).`,
              special,
            });
          else if (synced.state === "simulated")
            setSuccess({
              title: `${ACTION_LABEL[action.key]} gespeichert`,
              description: `Testmodus: Der Deal (Stage „${stage}“) wird nur simuliert und nicht an Pipedrive gesendet.`,
              special,
            });
          else if (synced.state === "error") throw new Error(synced.error ?? "unexpected_error");
        } catch (syncError) {
          const code = syncError instanceof Error ? syncError.message : "unexpected_error";
          setSuccess(null);
          toast.error(
            `Gespeichert, aber nicht an Pipedrive übertragen: ${crmErrorMessage(code) || "Fehler bei der Übertragung."} Du kannst es im Verlauf erneut versuchen.`,
            { duration: 12000 },
          );
        }
        onDone();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      toast.error(
        message === "logo_upload_failed"
          ? "Das Logo konnte nicht hochgeladen werden. Bitte erneut versuchen."
          : actionErrorMessage(message),
      );
      if (message.includes("stale_lead")) onDone();
    } finally {
      setBusy(false);
    }
  }

  function reviewMail() {
    if (!isValidEmail(mail.to.trim())) return fail("Bitte eine gültige E-Mail-Adresse eintragen.");
    if (!mail.subject.trim() || !mail.body.trim()) return fail("Bitte Betreff und Text eintragen.");
    setPreview(true);
  }

  /** Sends through the configured provider; only a confirmed send (or test mode) lets the lead move on. */
  async function sendAndComplete(action: LeadAction) {
    if (busy || mailState.status === "sending") return;
    let emailId = mailState.id;
    if (mailState.status !== "sent" && mailState.status !== "simulated") {
      setMailState({ id: mailState.id, status: "sending", error: null });
      try {
        const r = await sendMail({
          data: {
            requestId: mailRequest.current ?? crypto.randomUUID(),
            leadId: lead.id,
            kind: "reference_mail",
            to: mail.to.trim(),
            subject: mail.subject,
            body: mail.body,
            templateId: mail.template || null,
          },
        });
        emailId = r.id;
        setMailState({ id: r.id, status: r.status as never, error: r.error });
        if (r.status !== "sent" && r.status !== "simulated") {
          toast.error(emailErrorMessage(r.error) || "Die E-Mail wurde nicht gesendet.");
          return;
        }
      } catch {
        setMailState({ id: mailState.id, status: "failed", error: "send_failed" });
        toast.error(emailErrorMessage("send_failed"));
        return;
      }
    }
    if (emailId) await submit(action, emailId);
  }

  return (
    <section className="cc-detail-section space-y-3" aria-labelledby="lead-actions-title">
      <h3 id="lead-actions-title">Gesprächsergebnis</h3>
      {success && (
        <SuccessBanner
          title={success.title}
          description={success.description}
          animationsEnabled={!reducedMotion}
          onDismiss={() => setSuccess(null)}
          {...(success.special ? { emphasis: true } : {})}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {LEAD_ACTIONS.map((action) => (
          <button
            key={action.key}
            type="button"
            title={action.hint}
            disabled={busy}
            aria-pressed={active === action.key}
            onClick={() => open(action)}
            className={`cc-action-button inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-medium disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 ${action.color} ${active === action.key ? "ring-2 ring-offset-2 ring-foreground" : ""}`}
          >
            {isMailAction(action.key) && <Mail size={16} aria-hidden="true" />}
            {action.label}
          </button>
        ))}
      </div>

      {current && !isMailAction(current.key) && (
        <form
          className="space-y-3 rounded-[10px] border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(current);
          }}
        >
          <p className="font-medium">{current.label}</p>
          {current.needs.logo && (
            <label className="block text-sm">
              Firmenlogo (Bild oder PDF, max. 5 MB)
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
                onChange={(e) => {
                  uploaded.current = null;
                  setFile(e.target.files?.[0] ?? null);
                }}
              />
            </label>
          )}
          {current.needs.schedule && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                {current.key === "callback" ? "Rückrufdatum" : "Wiedervorlage (optional)"}
                <Input
                  type="date"
                  value={date}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                {current.key === "callback" ? "Uhrzeit" : "Uhrzeit (optional)"}
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
          )}
          {slotTaken && (
            <p role="alert" className="text-sm font-medium text-destructive">
              Zu dieser Zeit ist bereits ein Rückruf eingetragen. Bitte wähle eine Minute später.
            </p>
          )}
          {current.needs.note && (
            <label className="block text-sm">
              Gesprächsnotiz{current.needs.note === "required" ? " (Pflicht)" : " (optional)"}
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || slotTaken}>
              {busy ? "Wird gespeichert …" : "Bestätigen"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setActive(null)}>
              Abbrechen
            </Button>
          </div>
        </form>
      )}

      {current && isMailAction(current.key) && (
        <form
          className="space-y-2 rounded-[10px] border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!preview) reviewMail();
            else void sendAndComplete(current);
          }}
        >
          <p className="font-medium">{current.label}: E-Mail</p>
          {!preview && (
            <>
              {templates.isLoading && (
                <p className="text-sm text-muted-foreground">Vorlagen werden geladen …</p>
              )}
              {templates.isError && (
                <p className="text-sm text-destructive">Vorlagen konnten nicht geladen werden.</p>
              )}
              {templates.data && (
                <label className="block text-sm">
                  Vorlage
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={mail.template}
                    onChange={(e) => pickTemplate(e.target.value)}
                  >
                    <option value="">
                      {templates.data.length ? "Vorlage wählen …" : "Keine Vorlagen hinterlegt"}
                    </option>
                    {templates.data.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm">
                An
                <Input
                  type="email"
                  value={mail.to}
                  onChange={(e) => setMail({ ...mail, to: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                Betreff
                <Input
                  value={mail.subject}
                  onChange={(e) => setMail({ ...mail, subject: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                Text
                <Textarea
                  rows={6}
                  value={mail.body}
                  onChange={(e) => setMail({ ...mail, body: e.target.value })}
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  Vorschau prüfen
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setActive(null)}
                >
                  Abbrechen
                </Button>
              </div>
            </>
          )}
          {preview && (
            <>
              <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm" aria-label="Vorschau">
                <p>
                  <span className="text-muted-foreground">An: </span>
                  {mail.to.trim()}
                </p>
                <p>
                  <span className="text-muted-foreground">Betreff: </span>
                  {mail.subject}
                </p>
                <p className="whitespace-pre-wrap pt-2">{mail.body}</p>
              </div>
              {mailState.status === "failed" && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {emailErrorMessage(mailState.error)} Der Lead bleibt unter Offene Leads.
                </p>
              )}
              {(mailState.status === "sent" || mailState.status === "simulated") && (
                <p className="text-sm text-muted-foreground">
                  {mailState.status === "simulated"
                    ? "Testmodus: Die Mail wurde nur simuliert."
                    : "Die Mail wurde gesendet."}{" "}
                  Der Lead wird abgeschlossen …
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Danach wandert der Lead nach Abgeschlossene Leads und ein Deal wird in Pipedrive in
                der Stage „{STAGE_NAME[current.stageKey ?? ""] ?? ""}“ angelegt.
              </p>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || mailState.status === "sending"}>
                  {mailState.status === "sending"
                    ? "Wird gesendet …"
                    : mailState.status === "failed"
                      ? "Erneut senden"
                      : mailState.id
                        ? "Lead abschließen"
                        : "Jetzt senden"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || mailState.status === "sending"}
                  onClick={() => setPreview(false)}
                >
                  Zurück
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </section>
  );
}
