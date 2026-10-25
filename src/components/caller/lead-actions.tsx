import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { parseLeadLinks } from "@/components/coldcaller/workspace-parts";
import { SuccessBanner } from "@/components/coldcaller/success-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Template = { id: string; name: string; subject?: string; body: string };
const STAGE_NAME: Record<string, string> = {
  low_q: "3D Low Q",
  high_q: "3D High Q",
  waiting_3d: "3D Waiting",
  on_hold: "On Hold",
  no_interest: "Kein Interesse",
};
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

  const links = parseLeadLinks(lead.extra as Record<string, unknown>, lead.city);
  const [contact, setContact] = useState({
    company: lead.company ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    website: links.websiteText ?? "",
    city: lead.city ?? "",
    address: links.addressRaw ?? "",
  });
  const [mail, setMail] = useState({ to: lead.email ?? "", subject: "", body: "", template: "" });

  const templates = useQuery({
    enabled: active === "reference_mail",
    queryKey: ["templates", "email_templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "email_templates")
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
    if (action.key === "contact_details" || action.key === "reference_mail") {
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

  async function submit(action: LeadAction) {
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
      if (action.key === "contact_details") details = contact;
      if (action.key === "reference_mail")
        details = {
          to: mail.to,
          subject: mail.subject,
          template: mail.template || null,
          channel: "mailto",
          delivery: "not_confirmed",
        };
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
      const result = data as unknown as Result;
      const stage = result.stage_key ? STAGE_NAME[result.stage_key] : null;
      setSuccess({
        title: `${ACTION_LABEL[action.key]} gespeichert`,
        description: stage
          ? `Für die CRM-Stage „${stage}“ vorgemerkt. Noch nicht an Pipedrive übertragen.`
          : action.key === "callback"
            ? "Du wirst zur gewählten Zeit erinnert."
            : action.key === "contact_details"
              ? "Kontaktdaten aktualisiert. Die CRM-Stage bleibt unverändert."
              : action.key === "reference_mail"
                ? "Als vorbereitet vermerkt. Die Stage bleibt unverändert."
                : "Gespeichert.",
        special: action.celebration === "special",
      });
      requestId.current = null;
      setActive(null);
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["lead-list"] });
      void qc.invalidateQueries({ queryKey: ["callbacks"] });
      onDone();
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

  function submitMail(action: LeadAction) {
    if (!mail.to.trim()) return fail("Bitte eine E-Mail-Adresse eintragen.");
    if (!mail.subject.trim() && !mail.body.trim())
      return fail("Bitte Betreff oder Text eintragen.");
    const href = `mailto:${encodeURIComponent(mail.to.trim())}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
    window.open(href, "_self");
    void submit(action);
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LEAD_ACTIONS.map((action) => (
          <button
            key={action.key}
            type="button"
            disabled={busy}
            aria-pressed={active === action.key}
            onClick={() => open(action)}
            className={`cc-action-button rounded-[10px] px-3 py-2.5 text-left text-sm font-semibold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 ${action.color} ${active === action.key ? "ring-2 ring-offset-2 ring-foreground" : ""}`}
          >
            <span className="block">{action.label}</span>
            <span className="block text-xs font-normal opacity-90">{action.hint}</span>
          </button>
        ))}
      </div>

      {current && current.key !== "contact_details" && current.key !== "reference_mail" && (
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
          {current.needs.note && (
            <label className="block text-sm">
              Gesprächsnotiz{current.needs.note === "required" ? " (Pflicht)" : " (optional)"}
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Wird gespeichert …" : "Bestätigen"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setActive(null)}>
              Abbrechen
            </Button>
          </div>
        </form>
      )}

      {current?.key === "contact_details" && (
        <form
          className="space-y-2 rounded-[10px] border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(current);
          }}
        >
          <p className="font-medium">Kontaktdaten</p>
          <p className="text-sm text-muted-foreground">
            Ändert nur die Daten, nicht die CRM-Stage.
          </p>
          {(
            [
              ["company", "Firmenname"],
              ["phone", "Telefonnummer"],
              ["email", "E-Mail"],
              ["website", "Website"],
              ["city", "Stadt"],
              ["address", "Adresse"],
            ] as const
          ).map(([key, label]) => (
            <label className="block text-sm" key={key}>
              {label}
              <Input
                type={key === "email" ? "email" : "text"}
                value={contact[key]}
                onChange={(e) => setContact({ ...contact, [key]: e.target.value })}
              />
            </label>
          ))}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Wird gespeichert …" : "Speichern"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setActive(null)}>
              Abbrechen
            </Button>
          </div>
        </form>
      )}

      {current?.key === "reference_mail" && (
        <form
          className="space-y-2 rounded-[10px] border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitMail(current);
          }}
        >
          <p className="font-medium">Referenzmail</p>
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
          <p className="text-sm text-muted-foreground">
            Die Mail öffnet sich in deinem E-Mail-Programm. Ein direkter Versand aus dem Tool und
            die Dokumentation im CRM sind noch nicht angebunden. Die Stage bleibt unverändert.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Mail öffnen und vermerken
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setActive(null)}>
              Abbrechen
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
