import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadPipedriveStages } from "@/lib/pipedrive.functions";
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
      ["contract", "Kaufvertrag"],
      ["production", "Deal in Produktion"],
      ["contact_saved", "Kontaktdaten hinterlegt"],
      ["future_interest", "Zukünftiges Interesse"],
      ["lost", "Verloren / Kein Interesse"],
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

  const { data } = useQuery({
    queryKey: ["stage-mapping", country],
    queryFn: async () =>
      (await supabase.from("pipedrive_stage_mapping").select("mapping").eq("country", country).maybeSingle()).data
        ?.mapping as Record<string, number> | undefined,
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
            <Button key={c} size="sm" variant={country === c ? "default" : "outline"} onClick={() => setCountry(c)}>
              {c === "DE" ? "🇩🇪 DE" : "🇦🇹 AT"}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Klicke „Stages laden“, um die Pipedrive Stages abzufragen, oder trage die Stage-IDs manuell ein. NL hat noch kein
        Pipedrive-Konto.
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
    </section>
  );
}
