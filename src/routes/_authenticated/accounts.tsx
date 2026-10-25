import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { COUNTRIES } from "@/lib/country";

const MASTER = "office@signselector.com";

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
      const [p, r, c] = await Promise.all([
        supabase.from("profiles").select("id,display_name,email"),
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("user_countries").select("user_id,country"),
      ]);
      return (p.data ?? []).map((u) => ({
        ...u,
        master: u.email?.toLowerCase() === MASTER,
        admin: !!r.data?.some((x) => x.user_id === u.id && x.role === "admin"),
        countries: (c.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.country),
      }));
    },
  });
  const isMaster = user.email?.toLowerCase() === MASTER;

  async function toggleCountry(id: string, code: string, on: boolean) {
    const { error } = on
      ? await supabase.from("user_countries").insert({ user_id: id, country: code })
      : await supabase.from("user_countries").delete().eq("user_id", id).eq("country", code);
    if (error) { toast.error("Länder darf nur der Master-Admin ändern."); return; }
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["my-countries"] });
  }

  async function setRole(id: string, makeAdmin: boolean) {
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
        <p className="text-sm text-muted-foreground">
          Neue Nutzer registrieren sich selbst, sind zuerst Caller und sehen erst etwas, wenn der Master-Admin ihnen ein Land freischaltet.
        </p>
        <div className="divide-y">
          {users?.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="block font-medium">{u.display_name}</span><span className="text-sm text-muted-foreground">{u.email}</span></span>
              <span className="flex flex-wrap items-center gap-2">
                {u.master ? (
                  <Badge>Master-Admin · alle Länder</Badge>
                ) : (
                  <>
                    {COUNTRIES.map((c) => {
                      const on = u.countries.includes(c.code);
                      return (
                        <Button key={c.code} size="sm" variant={on ? "default" : "outline"} disabled={!isMaster}
                          aria-pressed={on} onClick={() => toggleCountry(u.id, c.code, !on)}>
                          {c.flag} {c.code}
                        </Button>
                      );
                    })}
                    <Badge variant={u.admin ? "default" : "secondary"}>{u.admin ? "Admin" : "Caller"}</Badge>
                    <Button size="sm" variant="outline" onClick={() => setRole(u.id, !u.admin)}>{u.admin ? "Zu Caller" : "Zu Admin"}</Button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
