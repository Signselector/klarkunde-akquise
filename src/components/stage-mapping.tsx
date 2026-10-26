import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadPipedriveStages } from "@/lib/pipedrive.functions";
import {
  reconcileCrm,
  registerPipedriveWebhook,
  validateStageMapping,
} from "@/lib/crm-admin.functions";
import type { ValidationReport } from "@/lib/stage-validation";
import { Flag } from "@/components/flag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const GROUPS: { title: string; fields: [string, string][] }[] = [
  {
    title: "Anruf-Stages",
    fields: [
      ["low_q", "Logo Render Stage"],
      ["high_q", "Realismus Render Stage"],
      ["no_interest", "Kein Interesse Stage"],
      ["on_hold", "Zukunftsprojekt Stage"],
      ["reference_mail", "Referenzmail verschickt Stage"],
    ],
  },
  {
    title: "Kanban Stages (Meine Kunden)",
    fields: [
      ["animation", "Animation in Bearbeitung"],
      ["rd_done", "3D RD fertig"],
      ["waiting_3d", "Logo ausstehend Stage"],
      ["gerald_waiting", "Gerald Waiting Stage"],
      ["nico_waiting", "Nico Waiting Stage"],
      ["offer", "Angebot erstellen"],
      ["contract", "Kaufvertrag erstellen"],
      ["production", "Deal in Produktion"],
      ["contact_saved", "Kontaktdaten hinterlegt"],
      ["future_interest", "Zukünftiges Interesse"],
      ["lost", "Verloren / Kein Interesse"],
    ],
  },
  {
    title: "Weitere Spalten für Meine Kunden",
    fields: [
      ["no_show", "No Show"],
      ["low_chance", "Geringe Chance"],
      ["maybe_interested", "Vielleicht interessiert"],
      ["very_interested", "Sehr interessiert"],
      ["contract_waiting", "Kaufvertrag waiting"],
      ["won_other_percent", "Gewonnen: Andere Prozente"],
      ["won_production_planning", "Gewonnen: Produktionsplanung"],
      ["won_zero_percent", "Gewonnen: 0% Produktion"],
    ],
  },
  {
    title: "Provision Stages",
    fields: [
      ["erebay_production", "Erebay Produktion Stage"],
      ["goodbong_production", "Goodbong Produktion Stage"],
    ],
  },
];

type Stage = { id: number; name: string; pipeline: string };

export function StageMapping() {
  const [country, setCountry] = useState<"DE" | "AT">("DE");
  const [values, setValues] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const load = useServerFn(loadPipedriveStages);
  const validate = useServerFn(validateStageMapping);
  const register = useServerFn(registerPipedriveWebhook);
  const reconcile = useServerFn(reconcileCrm);
  const [originField, setOriginField] = useState("");
  const [checking, setChecking] = useState(false);
  const [live, setLive] = useState<(ValidationReport & { error?: string }) | null>(null);

  const stored = useQuery({
    queryKey: ["stage-validation", country],
    queryFn: async () =>
      (
        await supabase
          .from("pipedrive_stage_validation")
          .select("ok,report,checked_at")
          .eq("country", country)
          .maybeSingle()
      ).data,
  });
  const setting = useQuery({
    queryKey: ["origin-field", country],
    queryFn: async () =>
      (
        await supabase
          .from("app_settings")
          .select("value")
          .eq("key", `pipedrive_origin_field_${country}`)
          .maybeSingle()
      ).data?.value ?? "",
  });
  useEffect(() => {
    setOriginField(setting.data ?? "");
    setLive(null);
  }, [setting.data, country]);
  const report = live ?? (stored.data?.report as unknown as ValidationReport | undefined) ?? null;

  async function saveOriginField() {
    const { error } = await supabase.from("app_settings").upsert({
      key: `pipedrive_origin_field_${country}`,
      value: originField.trim(),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Feld gespeichert. Bitte die Stages erneut prüfen.");
    qc.invalidateQueries({ queryKey: ["origin-field", country] });
  }
  async function runValidation() {
    setChecking(true);
    try {
      const r = await validate({ data: { country } });
      setLive(r);
      qc.invalidateQueries({ queryKey: ["stage-validation", country] });
      if (r.error) toast.error(r.error);
      else if (r.ok) toast.success("Die Stage-Zuordnung stimmt mit Pipedrive überein.");
      else toast.error("Die Prüfung hat Fehler gefunden. Die Synchronisierung bleibt gesperrt.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Die Prüfung ist fehlgeschlagen.");
    } finally {
      setChecking(false);
    }
  }
  async function runWebhook() {
    try {
      const r = await register({ data: { country, baseUrl: window.location.origin } });
      toast.success(`Webhook in Pipedrive registriert${r.id ? ` (ID ${r.id})` : ""}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Webhook konnte nicht registriert werden.");
    }
  }
  async function runReconcile() {
    try {
      const r = await reconcile({ data: { country } });
      toast.success(`${r.checked} Deals geprüft, ${r.changed} geändert.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Abgleich fehlgeschlagen.");
    }
  }

  const { data } = useQuery({
    queryKey: ["stage-mapping", country],
    queryFn: async () =>
      (
        await supabase
          .from("pipedrive_stage_mapping")
          .select("mapping")
          .eq("country", country)
          .maybeSingle()
      ).data?.mapping as Record<string, number> | undefined,
  });
  useEffect(() => {
    const m = data ?? {};
    setValues(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])));
    setStages([]);
  }, [data, country]);

  async function fetchStages() {
    setLoading(true);
    try {
      setStages(await load({ data: { country } }));
      toast.success("Stages geladen.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stages konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const mapping: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!v.trim()) continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        toast.error(`Ungültige Stage-ID: ${v}`);
        return;
      }
      mapping[k] = n;
    }
    const { error } = await supabase
      .from("pipedrive_stage_mapping")
      .upsert({ country, mapping, updated_at: new Date().toISOString() });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Stage Mapping für ${country} gespeichert.`);
    qc.invalidateQueries({ queryKey: ["stage-mapping", country] });
  }

  const stageName = (v: string) => stages.find((s) => String(s.id) === v);

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Pipedrive Stage Mapping</h2>
        <div className="flex gap-1">
          {(["DE", "AT"] as const).map((c) => (
            <Button
              key={c}
              size="sm"
              variant={country === c ? "default" : "outline"}
              onClick={() => setCountry(c)}
            >
              <Flag code={c} /> {c}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Klicke „Stages laden“, um die Pipedrive Stages abzufragen, oder trage die Stage-IDs manuell
        ein. NL hat noch kein Pipedrive-Konto.
      </p>
      <Button variant="outline" size="sm" onClick={fetchStages} disabled={loading}>
        {loading ? "Lädt…" : "Stages laden"}
      </Button>
      <datalist id="pd-stages">
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{`${s.name} (${s.pipeline})`}</option>
        ))}
      </datalist>
      {GROUPS.map((g) => (
        <div key={g.title} className="space-y-3 border-t pt-3">
          <h3 className="text-sm font-medium">{g.title}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.fields.map(([key, label]) => {
              const hit = stageName(values[key] ?? "");
              return (
                <label key={key} className="space-y-1 text-sm">
                  <span>{label}</span>
                  <Input
                    list="pd-stages"
                    inputMode="numeric"
                    placeholder="Stage ID"
                    value={values[key] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [key]: e.target.value }))}
                  />
                  {hit && <span className="text-xs text-muted-foreground">{hit.name}</span>}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <Button onClick={save}>Save Stage Mapping</Button>

      <div className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium">Prüfung gegen Pipedrive</h3>
        <p className="text-sm text-muted-foreground">
          Die Synchronisierung mit Pipedrive ist erst freigegeben, wenn diese Prüfung ohne Fehler
          durchläuft. Es werden keine Stages oder Felder angelegt.
        </p>
        <label className="block space-y-1 text-sm">
          <span>Feld-Schlüssel „Ursprünglicher Caller“ (benutzerdefiniertes Textfeld am Deal)</span>
          <div className="flex gap-2">
            <Input
              value={originField}
              placeholder="z. B. 3f1c…"
              onChange={(e) => setOriginField(e.target.value)}
            />
            <Button variant="outline" onClick={saveOriginField}>
              Speichern
            </Button>
          </div>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runValidation} disabled={checking}>
            {checking ? "Prüft …" : "Stages prüfen"}
          </Button>
          <Button variant="outline" onClick={runWebhook}>
            Webhook registrieren
          </Button>
          <Button variant="outline" onClick={runReconcile}>
            Jetzt abgleichen
          </Button>
        </div>
        {report ? (
          <div className="space-y-2">
            <p
              role="status"
              className={`text-sm font-medium ${report.ok ? "text-emerald-700" : "text-destructive"}`}
            >
              {report.ok
                ? "Synchronisierung freigegeben."
                : "Synchronisierung gesperrt: bitte die Fehler beheben."}{" "}
              <span className="font-normal text-muted-foreground">
                Geprüft am {new Date(report.checkedAt).toLocaleString("de-DE")}
              </span>
            </p>
            <ul className="space-y-1.5 text-sm">
              {report.items.map((i) => (
                <li
                  key={i.key}
                  className={`rounded-md border p-2 ${i.status === "error" ? "border-destructive/50 bg-destructive/5" : i.status === "warning" ? "border-amber-400/60 bg-amber-50" : ""}`}
                >
                  <strong>{i.label}</strong>
                  <span className="ml-2 text-xs uppercase text-muted-foreground">
                    {i.status === "ok" ? "OK" : i.status === "warning" ? "Hinweis" : "Fehler"}
                  </span>
                  <br />
                  {i.message}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Noch nicht geprüft. Die Synchronisierung bleibt gesperrt.
          </p>
        )}
      </div>
    </section>
  );
}
