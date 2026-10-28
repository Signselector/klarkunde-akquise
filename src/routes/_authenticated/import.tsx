import { isMasterEmail } from "@/lib/master";
import { FeedbackState } from "@/components/coldcaller/primitives";
import { COUNTRIES, useAllowedCountries, useCountry } from "@/lib/country";
import { useRoles } from "@/lib/use-admin";
import { Flag } from "@/components/flag";
import { backendRpc, jsonObject } from "@/lib/backend";
import { backendEnabled } from "@/lib/backend";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseCsv } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dropdown } from "@/components/ui/dropdown";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({ meta: [{ title: "Lead-Import – Sign Selector Cold Caller" }] }),
  component: ImportPage,
});

const FIELDS = [
  { key: "company", label: "Firma", hints: ["firma", "company", "unternehmen", "name"] },
  {
    key: "contact_name",
    label: "Ansprechpartner",
    hints: ["ansprech", "kontakt", "contact", "person"],
  },
  { key: "phone", label: "Telefon", hints: ["tel", "phone", "nummer", "mobil"] },
  { key: "email", label: "E-Mail", hints: ["mail"] },
  { key: "city", label: "Stadt", hints: ["stadt", "ort", "city"] },
] as const;

function ImportPage() {
  const { user } = Route.useRouteContext();
  const active = useCountry();
  const roles = useRoles(user.id);
  const globalAdmin = roles.isGlobalAdmin || isMasterEmail(user.email);
  const allowed = useAllowedCountries();
  // Admins choose the target country of every batch; a manager works in the own country (fixed when there is one).
  const options: string[] = globalAdmin ? COUNTRIES.map((c) => c.code) : (allowed.data ?? []);
  const [picked, setPicked] = useState<string | null>(null);
  const country: string | null = globalAdmin
    ? picked
    : options.length === 1
      ? options[0]!
      : (picked ?? (options.includes(active) ? active : null));
  const nav = useNavigate();
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const staged = useRef<{
    fingerprint: string;
    keys: string[];
    confirmKey: string;
    batchId?: string;
    confirmSkip?: number[];
  } | null>(null);
  const importing = useRef(false);
  const headers = rows[0] ?? [];
  const data = rows.slice(1);

  async function onFile(f: File) {
    let parsed: string[][];
    if (/\.xlsx$/i.test(f.name)) {
      try {
        const { readSheet } = await import("read-excel-file/browser");
        const sheet = await readSheet(f);
        parsed = sheet
          .map((r) =>
            r.map((c: unknown) =>
              c instanceof Date ? c.toISOString().slice(0, 10) : c == null ? "" : String(c),
            ),
          )
          .filter((r: string[]) => r.some((x) => x.trim()));
      } catch {
        toast.error("Die Excel-Datei konnte nicht gelesen werden (nur .xlsx wird unterstützt).");
        return;
      }
    } else if (/\.xls$/i.test(f.name)) {
      toast.error("Altes .xls-Format wird nicht unterstützt – bitte als .xlsx oder CSV speichern.");
      return;
    } else {
      parsed = parseCsv(await f.text());
    }
    if (parsed.length < 2) {
      toast.error("Die Datei enthält keine Datenzeilen.");
      return;
    }
    const h = (parsed[0] ?? []).map((x) => x.toLowerCase());
    const m: Record<string, number> = {};
    FIELDS.forEach((fl) => {
      const i = h.findIndex((x) => fl.hints.some((hint) => x.includes(hint)));
      if (i >= 0 && !Object.values(m).includes(i)) m[fl.key] = i;
    });
    setRows(parsed);
    setMap(m);
    setName(f.name.replace(/\.\w+$/, ""));
  }

  async function importBackend() {
    if (importing.current) return;
    if (data.length > 5000) {
      toast.error("Bitte höchstens 5.000 Zeilen pro Datei importieren.");
      return;
    }
    if (map["phone"] === undefined && map["email"] === undefined) {
      toast.error("Bitte Telefon oder E-Mail zuordnen.");
      return;
    }
    const used = new Set(Object.values(map));
    const leads = data.map((row) => {
      const extra: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (!used.has(i) && row[i]) extra[h] = row[i];
      });
      const get = (key: string) => (map[key] !== undefined ? row[map[key]]?.trim() || null : null);
      return {
        company: get("company"),
        contact_name: get("contact_name"),
        phone: get("phone"),
        email: get("email"),
        city: get("city"),
        extra,
      };
    });
    const fingerprint = JSON.stringify([name, leads]);
    if (staged.current?.fingerprint !== fingerprint)
      staged.current = { fingerprint, keys: [], confirmKey: crypto.randomUUID() };
    const state = staged.current;
    importing.current = true;
    setProgress(0);
    try {
      if (state.batchId && state.confirmSkip) {
        const result = jsonObject<{ inserted: number }>(
          await backendRpc("confirm_import", {
            p_request_id: state.confirmKey,
            p_batch_id: state.batchId,
            p_skip_rows: state.confirmSkip,
          }),
        );
        staged.current = null;
        toast.success(`${result.inserted} Leads importiert.`);
        nav({ to: "/dashboard" });
        return;
      }
      // Replaying all chunks is safe: every chunk keeps its original request key and parent.
      let batchId: string | undefined;
      for (let i = 0; i < leads.length; i += 500) {
        const index = i / 500;
        state.keys[index] ??= crypto.randomUUID();
        const result = jsonObject<{ batch_id: string }>(
          await backendRpc("preview_import", {
            p_request_id: state.keys[index],
            p_name: name,
            p_rows: leads.slice(i, i + 500),
            ...(batchId ? { p_batch_id: batchId } : {}),
          }),
        );
        batchId = result.batch_id;
        setProgress(Math.round((Math.min(i + 500, leads.length) / leads.length) * 80));
      }
      if (!batchId) return;
      state.batchId = batchId;
      const { error: countryError } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: unknown }>
      )("set_import_batch_country", {
        p_batch_id: batchId,
        p_country: country ?? "",
      });
      if (countryError) throw new Error("country_not_allowed");
      const invalid: number[] = [];
      for (let offset = 0; offset < leads.length; offset += 500) {
        const { data: checked, error } = await supabase
          .from("import_rows")
          .select("row_no,errors")
          .eq("batch_id", batchId)
          .order("row_no")
          .range(offset, offset + 499);
        if (error) throw error;
        invalid.push(
          ...(checked ?? []).filter((row) => row.errors.length > 0).map((row) => row.row_no),
        );
      }
      const duplicates = (await backendRpc("import_duplicates", {
        p_batch_id: batchId,
      })) as number[];
      const skip = [...new Set([...invalid, ...duplicates])].sort((a, b) => a - b);
      if (
        skip.length &&
        !window.confirm(
          `${invalid.length} ungültige Zeilen, ${duplicates.length} mögliche Dubletten. Zeilen ${skip.slice(0, 20).join(", ")}${skip.length > 20 ? " …" : ""} überspringen und die übrigen importieren?`,
        )
      )
        return;
      state.confirmSkip = skip;
      const result = jsonObject<{ inserted: number }>(
        await backendRpc("confirm_import", {
          p_request_id: state.confirmKey,
          p_batch_id: batchId,
          p_skip_rows: skip,
        }),
      );
      staged.current = null;
      toast.success(`${result.inserted} Leads importiert.`);
      nav({ to: "/dashboard" });
    } catch {
      toast.error("Import nicht bestätigt. Bitte Eingaben prüfen und erneut versuchen.");
    } finally {
      importing.current = false;
      setProgress(null);
    }
  }

  async function confirm() {
    if (!country) {
      toast.error("Bitte zuerst das Zielland wählen.");
      return;
    }
    if (backendEnabled) return importBackend();
    if (map["phone"] === undefined) {
      toast.error("Bitte die Spalte Telefon zuordnen.");
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { data: batch, error } = await supabase
      .from("lead_batches")
      .insert({ name, created_by: u.user!.id, country })
      .select("id")
      .single();
    if (error || !batch) {
      toast.error("Batch konnte nicht angelegt werden.");
      return;
    }
    const used = new Set(Object.values(map));
    const leads = data.map((r) => {
      const extra: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (!used.has(i) && r[i]) extra[h] = r[i];
      });
      const get = (k: string) => (map[k] !== undefined ? r[map[k]]?.trim() || null : null);
      return {
        batch_id: batch.id,
        company: get("company"),
        contact_name: get("contact_name"),
        phone: get("phone"),
        email: get("email"),
        city: get("city"),
        extra,
      };
    });
    setProgress(0);
    for (let i = 0; i < leads.length; i += 500) {
      const { error: e } = await supabase.from("leads").insert(leads.slice(i, i + 500));
      if (e) {
        setProgress(null);
        toast.error("Import abgebrochen: " + e.message);
        return;
      }
      setProgress(
        Math.round(((i + 500 > leads.length ? leads.length : i + 500) / leads.length) * 100),
      );
    }
    toast.success(`${leads.length} Leads importiert.`);
    nav({ to: "/dashboard" });
  }

  if (roles.ready && !roles.isStaff && !globalAdmin)
    return (
      <FeedbackState kind="error" title="Nur für Manager und Admins">
        Neue Leadbatches können nur Manager (für ihr Land) und Admins hochladen.
      </FeedbackState>
    );
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold">
        Leads importieren{country ? ` – ${COUNTRIES.find((c) => c.code === country)?.label}` : ""}
      </h1>
      <section className="grid gap-2 rounded-lg border bg-card p-4" aria-label="Zielland">
        <Label htmlFor="target-country">Zielland des Batches{globalAdmin ? " (Pflicht)" : ""}</Label>
        {!globalAdmin && options.length === 1 ? (
          <p id="target-country" className="flex items-center gap-2 text-sm font-medium">
            Zielland: {COUNTRIES.find((c) => c.code === options[0])?.label} <Flag code={options[0]!} size={20} />
          </p>
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">Dir ist noch kein Land zugewiesen.</p>
        ) : (
          <Dropdown
            className="w-full max-w-xs"
            ariaLabel="Zielland"
            value={country ?? ""}
            onChange={(v) => setPicked(v || null)}
            options={[
              { value: "", label: "– Land wählen –" },
              ...options.map((c) => ({ value: c, label: COUNTRIES.find((x) => x.code === c)?.label ?? c })),
            ]}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Alle Leads dieses Uploads gehören zu diesem Land. Es lässt sich danach nicht mehr ändern.
        </p>
      </section>
      <p className="text-sm text-muted-foreground">
        Zum Ausprobieren:{" "}
        <a className="underline" href="/test-leads-de.csv" download>
          Test-CSV mit 15 Fake-Leads herunterladen
        </a>
      </p>
      <div className="space-y-1">
        <Label htmlFor="f">
          CSV- oder Excel-Datei (.csv, .xlsx; erstes Tabellenblatt, erste Zeile = Spaltennamen)
        </Label>
        <Input
          id="f"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </div>
      {headers.length > 0 && (
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="space-y-1">
            <Label htmlFor="bn">Name des Lead Batches</Label>
            <Input id="bn" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <h2 className="font-semibold">Spaltenzuordnung</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((fl) => (
              <div key={fl.key} className="space-y-1">
                <Label>{fl.label}</Label>
                <Dropdown
                  className="w-full"
                  ariaLabel={fl.label}
                  value={map[fl.key] === undefined ? "" : String(map[fl.key])}
                  onChange={(v) =>
                    setMap({ ...map, [fl.key]: v === "" ? (undefined as never) : Number(v) })
                  }
                  options={[
                    { value: "", label: "– nicht zuordnen –" },
                    ...headers.map((h, i) => ({ value: String(i), label: h || `Spalte ${i + 1}` })),
                  ]}
                />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Nicht zugeordnete Spalten werden als Zusatzinfo gespeichert. Vorschau erste Zeile:{" "}
            {FIELDS.map((fl) => (map[fl.key] !== undefined ? data[0]?.[map[fl.key]!] : null))
              .filter(Boolean)
              .join(" · ")}
          </p>
          {progress !== null && <Progress value={progress} />}
          <Button onClick={confirm} disabled={progress !== null || !name || !country}>
            {data.length} Leads importieren – bestätigen
          </Button>
        </div>
      )}
    </div>
  );
}
