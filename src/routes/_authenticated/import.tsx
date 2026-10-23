import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseCsv } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({ meta: [{ title: "Lead-Import – Cold Call Tool" }] }),
  component: ImportPage,
});

const FIELDS = [
  { key: "company", label: "Firma", hints: ["firma", "company", "unternehmen", "name"] },
  { key: "contact_name", label: "Ansprechpartner", hints: ["ansprech", "kontakt", "contact", "person"] },
  { key: "phone", label: "Telefon", hints: ["tel", "phone", "nummer", "mobil"] },
  { key: "email", label: "E-Mail", hints: ["mail"] },
  { key: "city", label: "Stadt", hints: ["stadt", "ort", "city"] },
] as const;

function ImportPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const headers = rows[0] ?? [];
  const data = rows.slice(1);

  async function onFile(f: File) {
    const parsed = parseCsv(await f.text());
    if (parsed.length < 2) return toast.error("Die Datei enthält keine Datenzeilen.");
    const h = parsed[0].map((x) => x.toLowerCase());
    const m: Record<string, number> = {};
    FIELDS.forEach((fl) => {
      const i = h.findIndex((x) => fl.hints.some((hint) => x.includes(hint)));
      if (i >= 0 && !Object.values(m).includes(i)) m[fl.key] = i;
    });
    setRows(parsed);
    setMap(m);
    setName(f.name.replace(/\.\w+$/, ""));
  }

  async function confirm() {
    if (map.phone === undefined) return toast.error("Bitte die Spalte Telefon zuordnen.");
    const { data: u } = await supabase.auth.getUser();
    const { data: batch, error } = await supabase
      .from("lead_batches").insert({ name, created_by: u.user!.id }).select("id").single();
    if (error || !batch) return toast.error("Batch konnte nicht angelegt werden.");
    const used = new Set(Object.values(map));
    const leads = data.map((r) => {
      const extra: Record<string, string> = {};
      headers.forEach((h, i) => { if (!used.has(i) && r[i]) extra[h] = r[i]; });
      const get = (k: string) => (map[k] !== undefined ? r[map[k]]?.trim() || null : null);
      return { batch_id: batch.id, company: get("company"), contact_name: get("contact_name"), phone: get("phone"), email: get("email"), city: get("city"), extra };
    });
    setProgress(0);
    for (let i = 0; i < leads.length; i += 500) {
      const { error: e } = await supabase.from("leads").insert(leads.slice(i, i + 500));
      if (e) { setProgress(null); return toast.error("Import abgebrochen: " + e.message); }
      setProgress(Math.round(((i + 500 > leads.length ? leads.length : i + 500) / leads.length) * 100));
    }
    toast.success(`${leads.length} Leads importiert.`);
    nav({ to: "/dashboard" });
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Leads importieren</h1>
      <div className="space-y-1">
        <Label htmlFor="f">CSV-Datei (Komma oder Semikolon getrennt)</Label>
        <Input id="f" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </div>
      {headers.length > 0 && (
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <div className="space-y-1">
            <Label htmlFor="bn">Name des Lead Batches</Label>
            <Input id="bn" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <h2 className="font-semibold">Spaltenzuordnung</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((fl) => (
              <div key={fl.key} className="space-y-1">
                <Label>{fl.label}</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={map[fl.key] ?? ""}
                  onChange={(e) => setMap({ ...map, [fl.key]: e.target.value === "" ? (undefined as never) : Number(e.target.value) })}
                >
                  <option value="">– nicht zuordnen –</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Nicht zugeordnete Spalten werden als Zusatzinfo gespeichert. Vorschau erste Zeile:{" "}
            {FIELDS.map((fl) => (map[fl.key] !== undefined ? data[0]?.[map[fl.key]] : null)).filter(Boolean).join(" · ")}
          </p>
          {progress !== null && <Progress value={progress} />}
          <Button onClick={confirm} disabled={progress !== null || !name}>
            {data.length} Leads importieren – bestätigen
          </Button>
        </div>
      )}
    </div>
  );
}
