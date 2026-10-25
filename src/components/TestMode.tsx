import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function useIntegrationConfig() {
  return useQuery({
    queryKey: ["integration-config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("integration_config").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Visible on every page while test mode is on: nothing is sent to Pipedrive. */
export function TestModeBanner() {
  const { data } = useIntegrationConfig();
  if (!data || !data.test_mode) return null;
  return (
    <div className="border-b bg-accent px-4 py-1.5 text-center text-xs font-medium text-accent-foreground">
      Testmodus aktiv – Termine und Deals werden nur simuliert, nichts wird an Pipedrive gesendet.
    </div>
  );
}

export function TestModeCard() {
  const qc = useQueryClient();
  const { data } = useIntegrationConfig();
  const jobs = useQuery({
    queryKey: ["simulated-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_jobs")
        .select("id,outcome,status,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });
  if (!data) return null;
  async function toggle() {
    const next = !data!.test_mode;
    if (!next && !confirm("Testmodus ausschalten? Ab dann werden Termine und Deals live an Pipedrive übertragen."))
      return;
    const { error } = await supabase.from("integration_config").update({ test_mode: next }).eq("id", true);
    if (error) { toast.error("Konnte Testmodus nicht ändern."); return; }
    toast.success(next ? "Testmodus eingeschaltet." : "Testmodus ausgeschaltet – Sync ist live.");
    qc.invalidateQueries({ queryKey: ["integration-config"] });
  }
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">Testmodus</h2>
          <p className="text-sm text-muted-foreground">
            {data.test_mode
              ? "An: Übertragungen nach Pipedrive werden nur protokolliert (simuliert)."
              : "Aus: Termine und Deals werden live an Pipedrive übertragen."}
          </p>
        </div>
        <Button variant={data.test_mode ? "outline" : "default"} onClick={toggle}>
          {data.test_mode ? "Live schalten" : "Testmodus an"}
        </Button>
      </div>
      {jobs.data && jobs.data.length > 0 && (
        <ul className="divide-y text-sm">
          {jobs.data.map((j) => (
            <li key={j.id} className="flex justify-between py-1.5">
              <span>{j.outcome === "appointment" ? "Termin" : "Deal in Produktion"}</span>
              <span className="text-muted-foreground">
                {j.status === "simulated" ? "Simuliert" : j.status} ·{" "}
                {new Date(j.created_at).toLocaleString("de-AT")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
