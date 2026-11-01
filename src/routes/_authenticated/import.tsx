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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [statusText, setStatusText] = useState("");
  const importing = useRef(false);

  function update(id: string, patch: Partial<Job>) {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  async function readFile(f: File): Promise<string[][] | string> {
    if (/\.xlsx$/i.test(f.name)) {
      try {
        const { readSheet } = await import("read-excel-file/browser");
        const sheet = await readSheet(f);
        return sheet
          .map((r) =>
            r.map((c: unknown) =>
              c instanceof Date ? c.toISOString().slice(0, 10) : c == null ? "" : String(c),
            ),
          )
          .filter((r: string[]) => r.some((x) => x.trim()));
      } catch {
        return "Excel-Datei konnte nicht gelesen werden";
      }
    }
    if (/\.xls$/i.test(f.name)) return "Altes .xls-Format – bitte als .xlsx oder CSV speichern";
    return parseCsv(await f.text());
  }

  async function onFiles(files: FileList) {
    const added: Job[] = [];
    for (const f of Array.from(files)) {
      const parsed = await readFile(f);
      const id = crypto.randomUUID();
      const name = f.name.replace(/\.\w+$/, "");
      if (typeof parsed === "string" || parsed.length < 2) {
        added.push({
          id,
          file: f.name,
          name,
          rows: [],
          map: {},
          state: "error",
          message: typeof parsed === "string" ? parsed : "Keine Datenzeilen",
        });
        continue;
      }
      const h = (parsed[0] ?? []).map((x) => x.toLowerCase());
      const m: Record<string, number> = {};
      FIELDS.forEach((fl) => {
        const i = h.findIndex((x) => fl.hints.some((hint) => x.includes(hint)));
        if (i >= 0 && !Object.values(m).includes(i)) m[fl.key] = i;
      });
      added.push({ id, file: f.name, name, rows: parsed, map: m, state: "ready" });
    }
    setJobs((js) => [...js, ...added]);
  }

  function buildLeads(job: Job) {
    const headers = job.rows[0] ?? [];
    const used = new Set(Object.values(job.map));
    return job.rows.slice(1).map((row) => {
      const extra: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (!used.has(i) && row[i]) extra[h] = row[i];
      });
      const get = (key: string) =>
        job.map[key] !== undefined ? row[job.map[key]]?.trim() || null : null;
      return {
        company: get("company"),
        contact_name: get("contact_name"),
        phone: get("phone"),
        email: get("email"),
        city: get("city"),
        extra,
      };
    });
  }

  /** Imports one file as one batch; invalid rows and duplicates are skipped automatically. */
  async function importOne(job: Job, onPart: (f: number) => void) {
    const leads = buildLeads(job);
    if (!backendEnabled) {
      const { data: u } = await supabase.auth.getUser();
      const { data: batch, error } = await supabase
        .from("lead_batches")
        .insert({ name: job.name, created_by: u.user!.id, country: country! })
        .select("id")
        .single();
      if (error || !batch) throw new Error("Batch konnte nicht angelegt werden");
      for (let i = 0; i < leads.length; i += 500) {
        const { error: e } = await supabase
          .from("leads")
          .insert(leads.slice(i, i + 500).map((l) => ({ ...l, batch_id: batch.id })));
        if (e) throw new Error(e.message);
        onPart(Math.min(i + 500, leads.length) / leads.length);
      }
      return { inserted: leads.length, skipped: 0 };
    }
    let batchId: string | undefined;
    for (let i = 0; i < leads.length; i += 500) {
      const result = jsonObject<{ batch_id: string }>(
        await backendRpc("preview_import", {
          p_request_id: crypto.randomUUID(),
          p_name: job.name,
          p_rows: leads.slice(i, i + 500),
          ...(batchId ? { p_batch_id: batchId } : {}),
        }),
      );
      batchId = result.batch_id;
      onPart((Math.min(i + 500, leads.length) / leads.length) * 0.8);
    }
    if (!batchId) throw new Error("Kein Batch");
    const { error: countryError } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: unknown }>
    )("set_import_batch_country", { p_batch_id: batchId, p_country: country ?? "" });
    if (countryError) throw new Error("Land nicht erlaubt");
    const invalid: number[] = [];
    for (let offset = 0; offset < leads.length; offset += 500) {
      const { data: checked, error } = await supabase
        .from("import_rows")
        .select("row_no,errors")
        .eq("batch_id", batchId)
        .order("row_no")
        .range(offset, offset + 499);
      if (error) throw error;
      invalid.push(...(checked ?? []).filter((r) => r.errors.length > 0).map((r) => r.row_no));
    }
    const duplicates = (await backendRpc("import_duplicates", { p_batch_id: batchId })) as number[];
    const skip = [...new Set([...invalid, ...duplicates])].sort((a, b) => a - b);
    const result = jsonObject<{ inserted: number }>(
      await backendRpc("confirm_import", {
        p_request_id: crypto.randomUUID(),
        p_batch_id: batchId,
        p_skip_rows: skip,
      }),
    );
    onPart(1);
    return { inserted: result.inserted, skipped: skip.length };
  }

  function problem(job: Job): string | null {
    if (job.state === "error") return job.message ?? "Fehler";
    if (!job.name.trim()) return "Batch-Name fehlt";
    if (job.rows.length - 1 > 5000) return "Mehr als 5.000 Zeilen";
    if (backendEnabled ? job.map["phone"] === undefined && job.map["email"] === undefined : job.map["phone"] === undefined)
      return "Telefon-Spalte zuordnen";
    return null;
  }

  async function importAll() {
    if (importing.current) return;
    if (!country) {
      toast.error("Bitte zuerst das Zielland wählen.");
      return;
    }
    const todo = jobs.filter((j) => j.state === "ready" && !problem(j));
    if (!todo.length) {
      toast.error("Keine importbereiten Dateien.");
      return;
    }
    importing.current = true;
    setProgress(0);
    let ok = 0;
    let total = 0;
    for (let n = 0; n < todo.length; n++) {
      const job = todo[n]!;
      setStatusText(`Importiere Batch ${n + 1} von ${todo.length}: ${job.name} (${job.rows.length - 1} Leads)…`);
      update(job.id, { state: "running" });
      try {
        const r = await importOne(job, (f) => setProgress(Math.round(((n + f) / todo.length) * 100)));
        ok++;
        total += r.inserted;
        update(job.id, {
          state: "done",
          message: `${r.inserted} importiert${r.skipped ? `, ${r.skipped} übersprungen` : ""}`,
        });
      } catch (e) {
        update(job.id, {
          state: "failed",
          message: e instanceof Error && e.message ? e.message : "Import fehlgeschlagen",
        });
      }
    }
    importing.current = false;
    setProgress(null);
    setStatusText("");
    if (ok === todo.length) {
      toast.success(`${ok} Batches mit insgesamt ${total} Leads importiert.`);
      nav({ to: "/dashboard" });
    } else {
      toast.error(`${ok} von ${todo.length} Batches importiert – fehlgeschlagene sind markiert.`);
    }
  }

  if (roles.ready && !roles.isStaff && !globalAdmin)
    return (
      <FeedbackState kind="error" title="Nur für Manager und Admins">
        Neue Leadbatches können nur Manager (für ihr Land) und Admins hochladen.
      </FeedbackState>
    );
  const readyJobs = jobs.filter((j) => j.state === "ready" && !problem(j));
  const readyLeads = readyJobs.reduce((s, j) => s + j.rows.length - 1, 0);
  const running = progress !== null;
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold">
        Leads importieren{country ? ` – ${COUNTRIES.find((c) => c.code === country)?.label}` : ""}
      </h1>
      <section className="grid gap-2 rounded-lg border bg-card p-4" aria-label="Zielland">
        <Label htmlFor="target-country">Zielland der Batches{globalAdmin ? " (Pflicht)" : ""}</Label>
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
          CSV- oder Excel-Dateien (.csv, .xlsx; mehrere gleichzeitig möglich – jede Datei wird ein eigener Batch)
        </Label>
        <Input
          id="f"
          type="file"
          multiple
          disabled={running}
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            if (e.target.files?.length) void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {jobs.length > 0 && (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">Dateien ({jobs.length})</h2>
          <ul className="divide-y">
            {jobs.map((job) => {
              const p = problem(job);
              const headers = job.rows[0] ?? [];
              const tone =
                job.state === "done"
                  ? "text-emerald-600"
                  : job.state === "failed" || p
                    ? "text-destructive"
                    : "text-muted-foreground";
              return (
                <li key={job.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      className="max-w-xs"
                      aria-label="Batch-Name"
                      value={job.name}
                      disabled={running || job.state === "done"}
                      onChange={(e) => update(job.id, { name: e.target.value })}
                    />
                    <span className="text-sm">{Math.max(job.rows.length - 1, 0)} Leads</span>
                    <span className="text-xs text-muted-foreground">{job.file}</span>
                    <span className={`text-sm ${tone}`}>
                      {job.state === "running"
                        ? "Läuft…"
                        : job.state === "done" || job.state === "failed"
                          ? job.message
                          : (p ?? "Bereit")}
                    </span>
                    <div className="ml-auto flex gap-2">
                      {job.rows.length > 0 && job.state !== "done" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={running}
                          onClick={() => setOpenId(openId === job.id ? null : job.id)}
                        >
                          Spalten
                        </Button>
                      )}
                      {job.state === "failed" && (
                        <Button variant="outline" size="sm" disabled={running} onClick={() => update(job.id, { state: "ready", message: undefined })}>
                          Erneut
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={running}
                        onClick={() => setJobs((js) => js.filter((j) => j.id !== job.id))}
                      >
                        Entfernen
                      </Button>
                    </div>
                  </div>
                  {openId === job.id && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {FIELDS.map((fl) => (
                        <div key={fl.key} className="space-y-1">
                          <Label>{fl.label}</Label>
                          <Dropdown
                            className="w-full"
                            ariaLabel={fl.label}
                            value={job.map[fl.key] === undefined ? "" : String(job.map[fl.key])}
                            onChange={(v) => {
                              const m = { ...job.map };
                              if (v === "") delete m[fl.key];
                              else m[fl.key] = Number(v);
                              update(job.id, { map: m });
                            }}
                            options={[
                              { value: "", label: "– nicht zuordnen –" },
                              ...headers.map((h, i) => ({ value: String(i), label: h || `Spalte ${i + 1}` })),
                            ]}
                          />
                        </div>
                      ))}
                      <p className="text-sm text-muted-foreground sm:col-span-2">
                        Vorschau erste Zeile:{" "}
                        {FIELDS.map((fl) => (job.map[fl.key] !== undefined ? job.rows[1]?.[job.map[fl.key]!] : null))
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Ungültige Zeilen und mögliche Dubletten werden automatisch übersprungen.
          </p>
          {running && (
            <div className="space-y-1">
              <p className="text-sm">{statusText}</p>
              <Progress value={progress} />
            </div>
          )}
          <Button onClick={importAll} disabled={running || !country || readyJobs.length === 0}>
            Alle {readyJobs.length} Batches importieren ({readyLeads} Leads)
          </Button>
        </div>
      )}
    </div>
  );
}

type Job = {
  id: string;
  file: string;
  name: string;
  rows: string[][];
  map: Record<string, number>;
  state: "ready" | "running" | "done" | "failed" | "error";
  message?: string;
};
