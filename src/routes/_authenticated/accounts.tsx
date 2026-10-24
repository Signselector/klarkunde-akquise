import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "Accounts – Sign Selector Cold Caller" }] }),
  component: AccountsPage,
});

function AccountsPage() {
  const { user } = Route.useRouteContext();
  const admin = useIsAdmin(user.id);
  const qc = useQueryClient();
  const { data: users } = useQuery({
    enabled: admin,
    queryKey: ["users"],
    queryFn: async () => {
      const [p, r] = await Promise.all([supabase.from("profiles").select("id,display_name,email"), supabase.from("user_roles").select("user_id,role")]);
      return (p.data ?? []).map((u) => ({ ...u, admin: !!r.data?.some((x) => x.user_id === u.id && x.role === "admin") }));
    },
  });

  async function setRoleLegacy(id: string, makeAdmin: boolean) {
    if (id === user.id && !makeAdmin) { toast.error("Du kannst dir die Admin-Rolle nicht selbst entziehen."); return; }
    const del = await supabase.from("user_roles").delete().eq("user_id", id);
    if (del.error) { toast.error(del.error.message); return; }
    const ins = await supabase.from("user_roles").insert({ user_id: id, role: makeAdmin ? "admin" : "caller" });
    if (ins.error) { toast.error(ins.error.message); return; }
    toast.success("Rolle geändert."); qc.invalidateQueries({ queryKey: ["users"] });
  }

  async function setRole(id: string, makeAdmin: boolean) {
    if (import.meta.env["VITE_ATOMIC_BACKEND_ENABLED"] !== "true") return setRoleLegacy(id, makeAdmin);
    if (id === user.id && !makeAdmin) { toast.error("Du kannst dir die Admin-Rolle nicht selbst entziehen."); return; }
    const { error } = await supabase.rpc("set_user_role", { p_user_id: id, p_role: makeAdmin ? "admin" : "caller" });
    if (error) { toast.error(error.message === "last_admin" ? "Der letzte Admin kann nicht entfernt werden." : "Rollenänderung fehlgeschlagen."); return; }
    toast.success("Rolle geändert."); qc.invalidateQueries({ queryKey: ["users"] });
  }

  if (!admin) return <p className="text-muted-foreground">Accounts sind nur für Admins.</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold">Accounts</h1>
      <section className="space-y-2 rounded-lg border bg-card p-4">
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
    </div>
  );
}
