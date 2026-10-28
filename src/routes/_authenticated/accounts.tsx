import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Eye, KeyRound, Power, Shield, Trash2 } from "@/components/coldcaller/icons";
import { supabase } from "@/integrations/supabase/client";
import { primaryRole, ROLE_LABEL, useRoles, type RoleName } from "@/lib/use-admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { COUNTRIES } from "@/lib/country";
import { Flag } from "@/components/flag";
import { setViewAs } from "@/lib/view-as";
import { CountryDropdown } from "@/components/country-dropdown";
import { presenceState } from "@/lib/presence";
import { deleteAccount } from "@/lib/accounts.functions";
import { Dropdown } from "@/components/ui/dropdown";

const MASTER = "office@signselector.com";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "Accounts – Sign Selector Cold Caller" }] }),
  component: AccountsPage,
});

function AccountsPage() {
  const { user } = Route.useRouteContext();
  const me = useRoles(user.id);
  const admin = me.isStaff;
  const qc = useQueryClient();
  const nav = useNavigate();
  const del = useServerFn(deleteAccount);
  const { data: users } = useQuery({
    enabled: admin,
    queryKey: ["users"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [p, r, c, pr] = await Promise.all([
        supabase.from("profiles").select("id,display_name,email,active"),
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("user_countries").select("user_id,country"),
        supabase.from("user_presence").select("user_id,last_seen_at"),
      ]);
      const has = (id: string, role: string) =>
        !!r.data?.some((x) => x.user_id === id && x.role === role);
      return (p.data ?? []).map((u) => ({
        ...u,
        master: u.email?.toLowerCase() === MASTER,
        role: primaryRole(
          (r.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.role as string),
        ),
        lastSeen: pr.data?.find((x) => x.user_id === u.id)?.last_seen_at ?? null,
        countries: (c.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.country),
      }));
    },
  });
  const isMaster = user.email?.toLowerCase() === MASTER;
  const globalAdmin = me.isGlobalAdmin || isMaster;
  // A manager only sees accounts that share a country with them; new accounts without a country are for admins.
  const mine = users?.find((u) => u.id === user.id)?.countries ?? [];
  const visibleUsers = globalAdmin
    ? users
    : users?.filter((u) => u.id === user.id || u.countries.some((c) => mine.includes(c)));
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  async function toggleCountry(id: string, code: string, on: boolean) {
    const { error } = on
      ? await supabase.from("user_countries").insert({ user_id: id, country: code })
      : await supabase.from("user_countries").delete().eq("user_id", id).eq("country", code);
    if (error) {
      toast.error("Länder darf nur ein Admin festlegen.");
      return;
    }
    refresh();
    qc.invalidateQueries({ queryKey: ["my-countries"] });
  }

  async function setRole(id: string, role: RoleName) {
    const { error } = await supabase.rpc("set_user_role", { p_user_id: id, p_role: role });
    if (error) {
      toast.error(
        error.message.includes("last_admin")
          ? "Der letzte Admin kann nicht entfernt werden."
          : error.message.includes("forbidden")
            ? "Diese Rollenänderung ist dir nicht erlaubt."
            : "Rollenänderung fehlgeschlagen.",
      );
      return;
    }
    toast.success("Rolle geändert.");
    refresh();
    qc.invalidateQueries({ queryKey: ["roles"] });
  }

  async function resetPassword(email: string | null) {
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error("Link konnte nicht gesendet werden.");
    else toast.success(`Link zum Passwort-Zurücksetzen an ${email} gesendet.`);
  }

  async function setActive(id: string, active: boolean) {
    const { error } = await supabase.rpc("set_user_active", { p_user_id: id, p_active: active });
    if (error) {
      toast.error("Status konnte nicht geändert werden.");
      return;
    }
    toast.success(active ? "Account aktiviert." : "Account deaktiviert.");
    refresh();
  }

  async function remove(id: string, name: string | null) {
    if (!confirm(`Account „${name ?? ""}“ wirklich endgültig löschen?`)) return;
    try {
      await del({ data: { userId: id } });
      toast.success("Account gelöscht.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    }
  }

  const router = useRouter();
  /** Own account: the plain caller view. Anyone else: the app exactly as that employee sees it (read only). */
  async function openView(u: {
    id: string;
    display_name: string | null;
    email: string | null;
    role: string;
    countries: string[];
  }) {
    if (u.id === user.id) {
      localStorage.setItem("cc-caller-view", "1");
      window.dispatchEvent(new Event("cc-caller-view"));
      nav({ to: "/leads" });
      return;
    }
    const name = u.display_name || u.email || "Mitarbeiter";
    setViewAs({ id: u.id, name, email: u.email, role: u.role });
    // Best effort: the log must never block the view.
    void supabase
      .rpc("log_activity", {
        p_action: "view_as_started",
        p_country: globalAdmin ? "ALL" : (u.countries.find((c) => mine.includes(c)) ?? mine[0] ?? "ALL"),
        p_target_type: "user",
        p_target_id: u.id,
        p_target_label: name,
      })
      .then(() => undefined);
    qc.clear();
    await router.invalidate();
    nav({ to: "/dashboard" });
  }

  if (!admin)
    return <p className="text-muted-foreground">Accounts sind nur für Admins und Manager.</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold">Accounts</h1>
      <section className="space-y-2 rounded-lg border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Neue Nutzer registrieren sich selbst und sind zuerst Caller. Sie sehen erst etwas, wenn
          ihnen ein Land freigeschaltet wird. Nur Admins vergeben die Rollen Manager und Admin
          sowie die Länder. Manager legen für Accounts ihres Landes fest, wer Caller oder Senior
          Caller ist. Neue Accounts ohne Land sieht nur ein Admin.
        </p>
        <div className="divide-y">
          {visibleUsers?.map((u) => {
            const self = u.id === user.id;
            return (
              <div
                key={u.id}
                className="grid gap-3 py-4 lg:grid-cols-[1fr_1.4fr_auto_auto_auto] lg:items-center"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{u.display_name}</span>
                  <PresenceIndicator lastSeen={u.lastSeen} />
                </span>
                <span className="truncate text-sm text-muted-foreground">{u.email}</span>
                <span className="flex flex-col items-start gap-1">
                  {(u.master || !globalAdmin) && (
                  <Badge
                    variant={
                      u.master || u.role === "admin" || u.role === "manager"
                        ? "default"
                        : "secondary"
                    }
                    className="rounded-full"
                  >
                    {u.master
                      ? "👑 Master-Admin"
                      : u.role === "admin"
                        ? "👑 Admin"
                        : ROLE_LABEL[u.role]}
                  </Badge>
                  )}
                </span>
                <span className="flex flex-col items-start gap-1">
                  <Badge
                    variant={u.active ? "outline" : "destructive"}
                    className="w-fit rounded-full"
                  >
                    {u.active ? "Aktiv" : "Deaktiviert"}
                  </Badge>
                  {!u.master && u.role !== "admin" && u.countries.length === 0 && (
                    <Badge className="w-fit rounded-full border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-100">
                      Wartet auf Freischaltung (kein Land)
                    </Badge>
                  )}
                </span>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    {u.master
                      ? COUNTRIES.map((c) => (
                          <Badge key={c.code} variant="outline">
                            <Flag code={c.code} /> {c.code}
                          </Badge>
                        ))
                      : (
                        <CountryDropdown
                          selected={u.countries}
                          disabled={!globalAdmin}
                          label={u.display_name ?? "Account"}
                          onToggle={(code, on) => toggleCountry(u.id, code, on)}
                        />
                      )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {(self || globalAdmin || u.role === "recruit" || u.role === "veteran") && (
                      <Button size="sm" variant="outline" onClick={() => void openView(u)}>
                        <Eye size={16} />
                        Ansicht
                      </Button>
                    )}
                    {!u.master && globalAdmin && (
                      <Dropdown
                        className="min-h-9"
                        ariaLabel={`Rolle von ${u.display_name ?? "Account"}`}
                        value={u.role}
                        onChange={(v) => setRole(u.id, v as RoleName)}
                        options={(Object.keys(ROLE_LABEL) as RoleName[]).map((r) => ({
                          value: r,
                          label: ROLE_LABEL[r],
                        }))}
                      />
                    )}
                    {!u.master &&
                      !globalAdmin &&
                      me.isManager &&
                      (u.role === "recruit" || u.role === "veteran") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setRole(u.id, u.role === "recruit" ? "veteran" : "recruit")
                          }
                        >
                          <Shield size={16} />
                          {u.role === "recruit" ? "Zu Senior Caller" : "Zu Caller"}
                        </Button>
                      )}
                    <Button size="sm" variant="outline" onClick={() => resetPassword(u.email)}>
                      <KeyRound size={16} />
                      Passwort
                    </Button>
                  </div>
                  {!u.master && !self && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant={u.active ? "secondary" : "default"}
                        onClick={() => setActive(u.id, !u.active)}
                      >
                        <Power size={16} />
                        {u.active ? "Deaktivieren" : "Aktivieren"}
                      </Button>
                      {globalAdmin && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => remove(u.id, u.display_name)}
                        >
                          <Trash2 size={16} />
                          Löschen
                        </Button>
                      )}
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

function PresenceIndicator({ lastSeen }: { lastSeen: string | null }) {
  const { online, label } = presenceState(lastSeen);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400"}`}
      />
      <span className={online ? "font-medium text-emerald-700" : undefined}>{label}</span>
    </span>
  );
}
