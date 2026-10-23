import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SCRIPT } from "@/lib/leads";
import { useIsAdmin } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Einstellungen – Cold Call Tool" }] }),
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
  const { data: users } = useQuery({
    enabled: admin,
    queryKey: ["users"],
    queryFn: async () => {
      const [p, r] = await Promise.all([supabase.from("profiles").select("id,display_name,email"), supabase.from("user_roles").select("user_id,role")]);
      return (p.data ?? []).map((u) => ({ ...u, admin: !!r.data?.some((x) => x.user_id === u.id && x.role === "admin") }));
    },
  });

  async function saveScript() {
    const { error } = await supabase.from("app_settings").upsert({ key: "call_script", value: script, updated_at: new Date().toISOString() });
    if (error) { toast.error(error.message); return; }
    toast.success("Leitfaden gespeichert."); qc.invalidateQueries({ queryKey: ["script"] });
  }
  async function setRole(id: string, makeAdmin: boolean) {
    if (id === user.id && !makeAdmin) { toast.error("Du kannst dir die Admin-Rolle nicht selbst entziehen."); return; }
    const del = await supabase.from("user_roles").delete().eq("user_id", id);
    if (del.error) { toast.error(del.error.message); return; }
    const ins = await supabase.from("user_roles").insert({ user_id: id, role: makeAdmin ? "admin" : "caller" });
    if (ins.error) { toast.error(ins.error.message); return; }
    toast.success("Rolle geändert."); qc.invalidateQueries({ queryKey: ["users"] });
  }

  if (!admin) return <p className="text-muted-foreground">Einstellungen sind nur für Admins.</p>;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Einstellungen</h1>
      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">Gesprächsleitfaden</h2>
        <p className="text-sm text-muted-foreground">Platzhalter: {"{{firma}} {{ansprechpartner}} {{stadt}} {{caller}}"}</p>
        <Textarea rows={12} value={script} onChange={(e) => setScript(e.target.value)} />
        <Button onClick={saveScript}>Speichern</Button>
      </section>
      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">Accounts</h2>
        <p className="text-sm text-muted-foreground">Neue Nutzer registrieren sich selbst und sind zuerst Caller.</p>
        <div className="divide-y">
          {users?.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 py-2">
              <span><span className="block font-medium">{u.display_name}</span><span className="text-sm text-muted-foreground">{u.email}</span></span>
              <span className="flex items-center gap-2">
                <Badge variant={u.admin ? "default" : "secondary"}>{u.admin ? "Admin" : "Caller"}</Badge>
                <Button size="sm" variant="outline" onClick={() => setRole(u.id, !u.admin)}>{u.admin ? "Zu Caller" : "Zu Admin"}</Button>
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <h2 className="mb-1 font-semibold text-foreground">Pipedrive</h2>
        Der Pipedrive-Sync wird über die Pipedrive-Verbindung eingerichtet, nicht über einen Token in dieser App.
      </section>
    </div>
  );
}
