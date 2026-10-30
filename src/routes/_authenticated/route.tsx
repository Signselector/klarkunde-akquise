import { isMasterEmail } from "@/lib/master";
import { LanguageSwitch } from "@/components/language-switch";
import { useLang, useT } from "@/lib/i18n";
import { getViewAs, installViewAsGuard, setViewAs } from "@/lib/view-as";
import { CallbackReminder } from "@/components/caller/callback-reminder";
import { AchievementHost } from "@/components/achievement-host";
import { AchievementNotifier } from "@/components/achievement-notifier";
import { AppointmentNotifier } from "@/components/appointment-notifier";
import { primaryRole, ROLE_LABEL } from "@/lib/use-admin";
import { Brand } from "@/components/coldcaller/brand";
import { TestModeBanner } from "@/components/TestMode";
import { CountryBadge, CountrySwitcher, useAllowedCountries, useCountry } from "@/lib/country";
import { useEffect, useState, type CSSProperties } from "react";
import {
  createFileRoute,
  redirect,
  Outlet,
  Link,
  useNavigate,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarClock,
  CalendarCheck,
  CalendarDays,
  ChartNoAxesColumn,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  Crown,
  LogOut,
  FileText,
  LayoutDashboard,
  ScrollText,
  Settings,
  Upload,
  Users,
  Mail,
  X,
} from "@/components/coldcaller/icons";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    installViewAsGuard();
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    // "Ansicht als Mitarbeiter": pages work with the viewed employee as `user`; the real user stays in `realUser`.
    const view = getViewAs();
    const user = view ? { ...data.user, id: view.id, email: view.email ?? data.user.email } : data.user;
    return { user, realUser: data.user, viewAs: view };
  },
  component: Layout,
});

function Layout() {
  const { user, realUser, viewAs } = Route.useRouteContext();
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const nav = useNavigate();
  const router = useRouter();
  const location = useLocation();
  const { data: me } = useQuery({
    queryKey: ["me", user.id],
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("display_name,active,avatar_url").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      const role = primaryRole((r.data ?? []).map((x) => x.role as string));
      return {
        name: p.data?.display_name ?? user.email,
        avatarUrl: p.data?.avatar_url ?? null,
        role,
        admin: role === "admin" || role === "manager",
        globalAdmin: role === "admin" || isMasterEmail(user.email),
        active: p.data?.active !== false,
      };
    },
  });

  async function signOut() {
    setViewAs(null);
    // Best effort: a failing log call must never block signing out.
    await Promise.allSettled([
      supabase.rpc("log_activity", { p_action: "user_logout" }),
      supabase.rpc("set_offline"),
    ]);
    try {
      sessionStorage.removeItem("cc-login-logged");
    } catch {
      /* ignore */
    }
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }

  usePresence(realUser.id);

  const isMaster = isMasterEmail(user.email);
  const [callerView, setCallerView] = useState(false);
  useEffect(() => {
    if (!isMaster) return;
    const sync = () => setCallerView(localStorage.getItem("cc-caller-view") === "1");
    sync();
    window.addEventListener("cc-caller-view", sync);
    return () => window.removeEventListener("cc-caller-view", sync);
  }, [isMaster]);
  useEffect(() => {
    if (me && !me.active && !viewAs) {
      void supabase.auth.signOut().then(() => nav({ to: "/auth", replace: true }));
    }
  }, [me, nav, viewAs]);

  const country = useCountry();
  const allowed = useAllowedCountries();
  const { data: openCallbacks } = useQuery({
    queryKey: ["callback-count", user.id, country],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("callbacks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("country", country)
        .eq("done", false);
      return count ?? 0;
    },
  });
  // Managers and admins: appointments of Callers that still wait for a decision (shown as a number at "Termine").
  const { data: pendingAppointments } = useQuery({
    queryKey: ["appointments", "pending-count", user.id, country],
    enabled: !!me?.admin && !viewAs,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("country", country)
        .eq("decision_pending", true)
        .gte("starts_at", new Date().toISOString());
      return count ?? 0;
    },
  });
  const showAdmin = !!me?.admin && !callerView;
  const items = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/leads", label: "Offene Leads", icon: Users },
    { to: "/callbacks", label: "Rückrufe", icon: CalendarClock },
    { to: "/completed", label: "Abgeschlossene Leads", icon: CircleCheck },
    { to: "/customers", label: "Meine Kunden", icon: FileText },
    { to: "/appointments", label: "Termine", icon: CalendarCheck },
    ...(!showAdmin ? [{ to: "/my-stats", label: "Statistik", icon: ChartNoAxesColumn }] : []),
  ] as const;
  // Admin pages live in their own collapsible group so the caller workspace stays calm.
  const adminItems = showAdmin
    ? ([
        { to: "/stats", label: "Statistik", icon: ChartNoAxesColumn },
        { to: "/no-interest", label: "Kein Interesse", icon: X },
        { to: "/future-projects", label: "Zukunftsprojekte", icon: CalendarDays },
        { to: "/reference-unanswered", label: "Referenzmail offen", icon: Mail },
        { to: "/import", label: "Upload", icon: Upload },
        { to: "/accounts", label: "Accounts", icon: Crown },
        { to: "/audit-log", label: "Aktivitätsprotokoll", icon: ScrollText },
        // Settings are the backend (Pipedrive, stages, backups ...): master admin only.
        ...(isMaster ? [{ to: "/settings", label: "Einstellungen", icon: Settings }] : []),
      ] as const)
    : [];
  const adminActive = adminItems.some((i) => i.to === location.pathname);
  const [adminOpen, setAdminOpen] = useState(false);

  function toggleCallerView() {
    const next = !callerView;
    setCallerView(next);
    localStorage.setItem("cc-caller-view", next ? "1" : "0");
    if (next && (location.pathname === "/accounts" || location.pathname === "/settings")) {
      nav({ to: "/leads" });
    }
  }

  async function endViewAs() {
    setViewAs(null);
    qc.clear();
    await router.invalidate();
    nav({ to: "/accounts" });
  }

  // A new account without a country sees nothing until an admin assigns one.
  if (me && !viewAs && !me.globalAdmin && allowed.isFetched && (allowed.data ?? []).length === 0) {
    return (
      <main className="cc-theme grid min-h-dvh place-items-center bg-background p-6">
        <section className="grid max-w-md justify-items-center gap-4 rounded-2xl border bg-card p-8 text-center shadow-sm" aria-labelledby="waiting-title">
          <Brand />
          <h1 id="waiting-title" className="text-xl font-semibold">
            Account wartet auf Freischaltung
          </h1>
          <p className="text-sm text-muted-foreground">
            Dir wurde noch kein Land (Deutschland, Österreich oder Niederlande) zugewiesen. Bitte wende dich an deinen
            Manager oder Administrator, um für deinen Arbeitsbereich freigeschaltet zu werden.
          </p>
          <Button onClick={signOut}>
            <LogOut size={18} /> Abmelden
          </Button>
        </section>
      </main>
    );
  }

  return (
    <SidebarProvider
      className="cc-theme cc-app"
      defaultOpen={readSidebarOpen()}
      style={{ "--sidebar-width": "17rem", "--sidebar-width-icon": "5rem" } as CSSProperties}
    >
      <a href="#arbeitsbereich" className="cc-skip-link">
        Zum Arbeitsbereich
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader className="cc-sidebar-header">
          <Link
            to="/dashboard"
            className="cc-brand"
            aria-label="Sign Selector Cold Caller – Dashboard"
          >
            <Brand inverse />
          </Link>
          <SidebarCollapseButton />
        </SidebarHeader>
        <SidebarContent className="px-3 pb-4">
          <p className="cc-nav-caption">{t("Dein Arbeitsplatz")}</p>
          <SidebarMenu aria-label={t("Hauptnavigation")}>
            {items.map((i) => (
              <SidebarMenuItem key={i.to}>
                <NavigationItem
                  to={i.to}
                  label={t(i.label)}
                  icon={i.icon}
                  active={location.pathname === i.to}
                  badge={
                    i.to === "/callbacks"
                      ? (openCallbacks ?? 0)
                      : i.to === "/appointments"
                        ? (pendingAppointments ?? 0)
                        : 0
                  }
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          {adminItems.length > 0 && (
            <div className="cc-admin-group">
              <button
                type="button"
                className="cc-admin-toggle"
                aria-expanded={adminOpen || adminActive}
                onClick={() => setAdminOpen((o) => !o)}
              >
                <Settings aria-hidden="true" />
                <span>{t("Admin-Bereich")}</span>
                <ChevronRight className="cc-admin-chevron" aria-hidden="true" />
              </button>
              <div className="cc-admin-body" data-open={adminOpen || adminActive}>
                <SidebarMenu aria-label={t("Admin-Bereich")}>
                  {adminItems.map((i) => (
                    <SidebarMenuItem key={i.to}>
                      <NavigationItem
                        to={i.to}
                        label={t(i.label)}
                        icon={i.icon}
                        active={location.pathname === i.to}
                      />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </div>
            </div>
          )}
        </SidebarContent>
        <SidebarFooter className="cc-sidebar-footer">
          <CountryBadge />
          <div className="cc-sidebar-tools">
            {isMaster && callerView && (
              <Button size="sm" aria-pressed={callerView} onClick={toggleCallerView}>
                <Crown size={16} />
                {t("Zur Admin-Sicht")}
              </Button>
            )}
            <CountrySwitcher />
          </div>
          <div className="cc-profile">
            <ProfileCard
              active={location.pathname === "/profile"}
              avatarUrl={me?.avatarUrl}
              initials={(me?.name ?? user.email ?? "?").slice(0, 2).toUpperCase()}
              name={me?.name ?? user.email ?? ""}
              subtitle={
                me
                  ? me.admin && callerView
                    ? t("Caller-Ansicht")
                    : t(ROLE_LABEL[me.role])
                  : t("Profil wird geladen …")
              }
            />
            <LevelCard />
          </div>
          <div className="cc-signout-row">
            <Button variant="ghost" className="cc-signout" onClick={signOut}>
              <LogOut size={18} />
              <span>{t("Abmelden")}</span>
            </Button>
            <LanguageSwitch />
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="cc-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger
              className="cc-menu-trigger"
              aria-label="Navigation öffnen oder schließen"
            />
          </div>
        </header>
        <TestModeBanner />
        {viewAs && (
          <div role="status" className="cc-viewas-banner">
            <span>
              <strong>Ansicht als {viewAs.name}</strong> ({ROLE_LABEL[viewAs.role as keyof typeof ROLE_LABEL] ?? viewAs.role}) – nur
              Lesen, es wird nichts gespeichert.
            </span>
            <Button size="sm" onClick={() => void endViewAs()}>
              {t("Ansicht beenden")}
            </Button>
          </div>
        )}
        {/* The key rebuilds the page on a language change, so dates and numbers are formatted again. */}
        <div id="arbeitsbereich" key={lang} tabIndex={-1} className="cc-workspace">
          {!viewAs && <CallbackReminder userId={user.id} />}
          {!viewAs && <AppointmentNotifier userId={user.id} />}
          {!viewAs && <AchievementNotifier userId={user.id} />}
          <AchievementHost />
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ProfileCard({
  active,
  avatarUrl,
  initials,
  name,
  subtitle,
}: {
  active: boolean;
  avatarUrl?: string | null | undefined;
  initials: string;
  name: string;
  subtitle: string;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const t = useT();
  return (
    <Link
      to="/profile"
      className="cc-user"
      title={t("Mein Profil & Einstellungen")}
      aria-label={t("Mein Profil und Einstellungen öffnen")}
      data-active={active}
      aria-current={active ? "page" : undefined}
      onClick={() => {
        if (isMobile) setOpenMobile(false);
      }}
    >
      <span className="cc-avatar">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </span>
      <div>
        <strong>{name}</strong>
        <small>{subtitle}</small>
      </div>
    </Link>
  );
}

/** Heartbeat while the tab is visible, plus one login entry per browser session. */
const HEARTBEAT_MS = 45_000;
function usePresence(userId: string) {
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") void supabase.rpc("heartbeat");
    };
    try {
      if (!sessionStorage.getItem("cc-login-logged")) {
        sessionStorage.setItem("cc-login-logged", "1");
        void supabase.rpc("log_activity", { p_action: "user_login" });
      }
    } catch {
      /* sessionStorage can be blocked; presence still works */
    }
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [userId]);
}

function NavigationItem({
  to,
  label,
  icon: Icon,
  active,
  badge = 0,
}: {
  to: string;
  label: string;
  icon: typeof Users;
  active: boolean;
  badge?: number;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Link
      to={to}
      title={label}
      data-sidebar="menu-button"
      data-active={active}
      aria-current={active ? "page" : undefined}
      className="cc-nav-link flex w-full items-center overflow-hidden text-left text-sm outline-none"
      onClick={() => {
        if (isMobile) setOpenMobile(false);
      }}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
      {badge > 0 && <b className="cc-nav-badge">{badge}</b>}
    </Link>
  );
}

/**
 * Placeholder for the level and coin mechanic that is still to be designed.
 * Shows the starting state only; there is no data source or rule behind it yet.
 */
const LEVEL_PLACEHOLDER = { level: 1, xp: 0, xpNext: 1000, coins: 0 };

function LevelCard() {
  const { level, xp, xpNext, coins } = LEVEL_PLACEHOLDER;
  const fmt = (n: number) => n.toLocaleString("de-DE");
  return (
    <div className="cc-level" aria-label="Level und Coins (Platzhalter)">
      <div className="cc-level-row">
        <strong>Level {level}</strong>
        <span>
          {fmt(xp)} / {fmt(xpNext)} XP
        </span>
      </div>
      <div className="cc-level-bar" aria-hidden="true">
        <i style={{ width: `${Math.round((xp / xpNext) * 100)}%` }} />
      </div>
      <div className="cc-level-coins">
        <span className="cc-coin" aria-hidden="true" />
        {fmt(coins)} Coins
      </div>
    </div>
  );
}

/** The sidebar remembers its state in the cookie the sidebar component already writes. */
function readSidebarOpen() {
  try {
    return !/(?:^|;\s*)sidebar_state=false/.test(document.cookie);
  } catch {
    return true;
  }
}

function SidebarCollapseButton() {
  const { state, toggleSidebar, isMobile } = useSidebar();
  if (isMobile) return null;
  const collapsed = state === "collapsed";
  return (
    <button
      type="button"
      className="cc-collapse"
      onClick={toggleSidebar}
      aria-label={collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"}
      title={collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"}
    >
      {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
    </button>
  );
}
