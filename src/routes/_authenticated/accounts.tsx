import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Eye, KeyRound, Power, Shield, Trash2, Wrench } from "@/components/coldcaller/icons";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { COUNTRIES } from "@/lib/country";
import { deleteAccount } from "@/lib/accounts.functions";

const MASTER = "office@signselector.com";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "Accounts – Sign Selector Cold Caller" }] }),
  component: AccountsPage,
});

function AccountsPage() {
  const { user } = Route.useRouteContext();
  const admin = useIsAdmin(user.id);
  const qc = useQueryClient();
  const nav = useNavigate();
  const del = useServerFn(deleteAccount);
  const { data: users } = useQuery({
    enabled: admin,
    queryKey: ["users"],
    queryFn: async () => {
      const [p, r, c] = await Promise.all([
        supabase.from("profiles").select("id,display_name,email,active"),
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("user_countries").select("user_id,country"),
      ]);
      const has = (id: string, role: string) => !!r.data?.some((x) => x.user_id === id && x.role === role);
      return (p.data ?? []).map((u) => ({
        ...u,
        master: u.email?.toLowerCase() === MASTER,
        admin: has(u.id, "admin"),
        fulfilment: has(u.id, "fulfilment"),
        countries: (c.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.country),
      }));
    },
  });
  const isMaster = user.email?.toLowerCase() === MASTER;
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  async function toggleCountry(id: string, code: string, on: boolean) {
    const { error } = on
      ? await supabase.from("user_countries").insert({ user_id: id, country: code })
      : await supabase.from("user_countries").delete().eq("user_id", id).eq("country", code);
    if (error) { toast.error("Länder darf nur der Master-Admin ändern."); return; }
    refresh();
    qc.invalidateQueries({ queryKey: ["my-countries"] });
  }

  async function setRole(id: string, makeAdmin: boolean) {
    if (id === user.id && !makeAdmin) { toast.error("Du kannst dir die Admin-Rolle nicht selbst entziehen."); return; }
    const { error } = await supabase.rpc("set_user_role", { p_user_id: id, p_role: makeAdmin ? "admin" : "caller" });
    if (error) { toast.error(error.message === "last_admin" ? "Der letzte Admin kann nicht entfernt werden." : "Rollenänderung fehlgeschlagen."); return; }
    toast.success("Rolle geändert."); refresh();
  }

  async function toggleFulfilment(id: string, on: boolean) {
    const { error } = await supabase.rpc("set_user_fulfilment", { p_user_id: id, p_on: on });
    if (error) { toast.error("Fulfilment konnte nicht geändert werden."); return; }
    toast.success(on ? "Fulfilment aktiviert." : "Fulfilment entfernt."); refresh();
  }

  async function resetPassword(email: string | null) {
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) toast.error("Link konnte nicht gesendet werden.");
    else toast.success(`Link zum Passwort-Zurücksetzen an ${email} gesendet.`);
  }

  async function setActive(id: string, active: boolean) {
    const { error } = await supabase.rpc("set_user_active", { p_user_id: id, p_active: active });
    if (error) { toast.error("Status konnte nicht geändert werden."); return; }
    toast.success(active ? "Account aktiviert." : "Account deaktiviert."); refresh();
  }

  async function remove(id: string, name: string | null) {
    if (!confirm(`Account „${name ?? ""}“ wirklich endgültig löschen?`)) return;
    try { await del({ data: { userId: id } }); toast.success("Account gelöscht."); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen."); }
  }

  function openCallerView() {
    localStorage.setItem("cc-caller-view", "1");
    window.dispatchEvent(new Event("cc-caller-view"));
    nav({ to: "/leads" });
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
          {users?.map((u) => {
            const self = u.id === user.id;
            return (
              <div key={u.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_1.4fr_auto_auto_auto] lg:items-center">
                <span className="font-medium">{u.display_name}</span>
                <span className="truncate text-sm text-muted-foreground">{u.email}</span>
                <span className="flex flex-col items-start gap-1">
                  <Badge variant={u.master || u.admin ? "default" : "secondary"} className="rounded-full">
                    {u.master ? "👑 Master-Admin" : u.admin ? "👑 Admin" : "Caller"}
                  </Badge>
                  {u.fulfilment && <Badge variant="outline" className="rounded-full"><Wrench size={12} />Fulfilment</Badge>}
                </span>
                <Badge variant={u.active ? "outline" : "destructive"} className="w-fit rounded-full">{u.active ? "Aktiv" : "Deaktiviert"}</Badge>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    {u.master
                      ? COUNTRIES.map((c) => <Badge key={c.code} variant="outline">{c.flag} {c.code}</Badge>)
                      : COUNTRIES.map((c) => {
                          const on = u.countries.includes(c.code);
                          return (
                            <Button key={c.code} size="sm" variant={on ? "default" : "outline"} disabled={!isMaster}
                              aria-pressed={on} onClick={() => toggleCountry(u.id, c.code, !on)}>
                              {c.flag} {c.code}
                            </Button>
                          );
                        })}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={openCallerView}><Eye size={16} />Ansicht</Button>
                    {!u.master && (
                      <Button size="sm" variant="outline" onClick={() => setRole(u.id, !u.admin)}>
                        <Shield size={16} />{u.admin ? "Zu Caller" : "Zu Admin"}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => toggleFulfilment(u.id, !u.fulfilment)}>
                      <Wrench size={16} />{u.fulfilment ? "Fulfilment entfernen" : "Fulfilment"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resetPassword(u.email)}><KeyRound size={16} />Passwort</Button>
                  </div>
                  {!u.master && !self && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant={u.active ? "secondary" : "default"} onClick={() => setActive(u.id, !u.active)}>
                        <Power size={16} />{u.active ? "Deaktivieren" : "Aktivieren"}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => remove(u.id, u.display_name)}>
                        <Trash2 size={16} />Löschen
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
