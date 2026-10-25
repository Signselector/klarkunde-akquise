import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { backendRpc } from "@/lib/backend";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
const STATUS: Record<string, string> = {
  pending: "Wartet",
  running: "Wird übertragen",
  succeeded: "Übertragen",
  failed: "Fehlgeschlagen",
  needs_review: "Prüfung erforderlich",
};
const ERRORS: Record<string, string> = {
  unauthorized: "Verbindung prüfen",
  missing_contact: "Ansprechpartner und Kontaktdaten ergänzen",
  configuration_error: "Pipedrive-Zuordnung prüfen",
  invalid_payload: "Pipedrive-Pflichtfelder prüfen",
  rate_limited: "Pipedrive begrenzt die Anfragen",
  ambiguous_response: "Übertragung in Pipedrive abgleichen",
  checkpoint_failed: "Übertragung in Pipedrive abgleichen",
  lease_expired: "Übertragung in Pipedrive abgleichen",
  archived_lead: "Lead wurde archiviert",
};
const QUALITY: Record<string, string> = {
  missing_phone: "Telefonnummer fehlt",
  invalid_email: "E-Mail ungültig",
  possible_duplicate: "Mögliche Dublette",
  overdue_callback: "Rückruf überfällig",
  missing_sync_contact: "Ansprechpartner für Pipedrive fehlt",
};
export function BackendStatus({ admin }: { admin: boolean }) {
  return (
    <div className="space-y-4">
      <PipedriveJobs admin={admin} />
      <DataQuality />
    </div>
  );
}

export function PipedriveJobs({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: ["integration-jobs"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_jobs")
        .select("*,lead:leads(company,contact_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  async function retry(id: string) {
    setBusy(id);
    try {
      await backendRpc("retry_integration", { p_job_id: id });
      await qc.invalidateQueries({ queryKey: ["integration-jobs"] });
    } catch {
      toast.error("Übertragung konnte nicht erneut gestartet werden.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="space-y-2 rounded-lg border p-4">
      <h2 className="font-semibold">Pipedrive-Übertragungen</h2>
      {jobs.isError && <p>Übertragungsstatus konnte nicht geladen werden.</p>}
      {jobs.data?.length === 0 && <p>Noch keine Übertragungen.</p>}
      {jobs.data?.map((j) => (
        <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
          <span>
            {j.lead?.company || j.lead?.contact_name || "Lead"} · {STATUS[j.status] ?? j.status}
            {j.error_code && (
              <span className="block text-sm text-muted-foreground">
                {ERRORS[j.error_code] ?? "Verbindung vorübergehend nicht verfügbar"}
              </span>
            )}
            {j.status === "needs_review" && (
              <span className="block text-sm">
                Vor einem neuen Versuch muss ein Admin die Übertragung in Pipedrive abgleichen.
              </span>
            )}
          </span>
          {admin && j.status === "failed" && (
            <Button size="sm" disabled={busy !== null} onClick={() => retry(j.id)}>
              Erneut versuchen
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}

export function DataQuality() {
  const quality = useQuery({
    queryKey: ["quality-issues"],
    queryFn: async () =>
      (await backendRpc("get_quality_issues", {})) as {
        lead_id: string;
        company: string;
        kind: string;
        acknowledged_reason: string | null;
      }[],
  });
  return (
    <section className="space-y-2 rounded-lg border p-4">
      <h2 className="font-semibold">Datenqualität</h2>
      {quality.isError && <p>Qualitätshinweise konnten nicht geladen werden.</p>}
      {quality.data?.length === 0 && <p>Keine offenen Qualitätshinweise.</p>}
      {quality.data?.map((q) => (
        <p key={q.lead_id + q.kind}>
          <a className="underline" href={`/leads?lead=${q.lead_id}`}>
            {q.company}: {QUALITY[q.kind] ?? q.kind}
          </a>
          {q.acknowledged_reason && ` · ${q.acknowledged_reason}`}
        </p>
      ))}
    </section>
  );
}
