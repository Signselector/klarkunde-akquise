import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SCRIPT } from "@/lib/leads";
import { useIsAdmin } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Einstellungen – Sign Selector Cold Caller" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = Route.useRouteContext();
  const admin = useIsAdmin(user.id);
  const qc = useQueryClient();
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const { data: saved } = useQuery({
    queryKey: ["script"],
    queryFn: async () => (await supabase.from("app_settings").select("value").eq("key", "call_script").maybeSingle()).data?.value,
  });
  useEffect(() => { if (saved) setScript(saved); }, [saved]);
  async function saveScript() {
    const { error } = await supabase.from("app_settings").upsert({ key: "call_script", value: script, updated_at: new Date().toISOString() });
    if (error) { toast.error(error.message); return; }
    toast.success("Leitfaden gespeichert."); qc.invalidateQueries({ queryKey: ["script"] });
  }
  if (!admin) return <p className="text-muted-foreground">Einstellungen sind nur für Admins.</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold">Einstellungen</h1>
      <section className="space-y-2 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Gesprächsleitfaden</h2>
        <p className="text-sm text-muted-foreground">Platzhalter: {"{{firma}} {{ansprechpartner}} {{stadt}} {{caller}}"}</p>
        <Textarea rows={12} value={script} onChange={(e) => setScript(e.target.value)} />
        <Button onClick={saveScript}>Speichern</Button>
      </section>
      <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <h2 className="mb-1 font-semibold text-foreground">Pipedrive</h2>
        Der Pipedrive-Sync wird über die Pipedrive-Verbindung eingerichtet, nicht über einen Token in dieser App.
      </section>
    </div>
  );
}
