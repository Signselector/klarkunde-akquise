import { isMasterEmail } from "@/lib/master";
import { CallbackReminder } from "@/components/caller/callback-reminder";
import { Brand } from "@/components/coldcaller/brand";
import { TestModeBanner } from "@/components/TestMode";
import { CountrySwitcher, useCountry } from "@/lib/country";
import { useEffect, useState, type CSSProperties } from "react";
import {
  createFileRoute,
  redirect,
  Outlet,
  Link,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarClock,
  CalendarCheck,
  CalendarDays,
  ChartNoAxesColumn,
  CircleCheck,
  ChevronRight,
  Crown,
  LogOut,
  FileText,
  LayoutDashboard,
  Settings,
  Upload,
  Users,
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
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Layout,
});

function Layout() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const nav = useNavigate();
  const location = useLocation();
  const { data: me } = useQuery({
    queryKey: ["me", user.id],
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("display_name,active").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      return {
        name: p.data?.display_name ?? user.email,
        admin: !!r.data?.some((x) => x.role === "admin"),
        active: p.data?.active !== false,
      };
    },
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }

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
    if (me && !me.active) {
      void supabase.auth.signOut().then(() => nav({ to: "/auth", replace: true }));
    }
  }, [me, nav]);

  const country = useCountry();
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
        { to: "/stats", label: "Statistiken", icon: ChartNoAxesColumn },
        { to: "/daily-stats", label: "Tagesstatistik", icon: CalendarDays },
        ...(isMaster ? [{ to: "/import", label: "Upload", icon: Upload }] : []),
        { to: "/accounts", label: "Accounts", icon: Crown },
        { to: "/settings", label: "Einstellungen", icon: Settings },
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

  return (
    <SidebarProvider
      className="cc-theme cc-app"
      style={{ "--sidebar-width": "17rem" } as CSSProperties}
    >
      <a href="#arbeitsbereich" className="cc-skip-link">
        Zum Arbeitsbereich
      </a>
      <Sidebar>
        <SidebarHeader className="cc-sidebar-header">
          <Link
            to="/dashboard"
            className="cc-brand"
            aria-label="Sign Selector Cold Caller – Dashboard"
          >
            <Brand inverse />
          </Link>
        </SidebarHeader>
        <SidebarContent className="px-3 pb-4">
          <p className="cc-nav-caption">Dein Arbeitsplatz</p>
          <SidebarMenu aria-label="Hauptnavigation">
            {items.map((i) => (
              <SidebarMenuItem key={i.to}>
                <NavigationItem
                  to={i.to}
                  label={i.label}
                  icon={i.icon}
                  active={location.pathname === i.to}
                  badge={i.to === "/callbacks" ? (openCallbacks ?? 0) : 0}
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
                <span>Admin-Bereich</span>
                <ChevronRight className="cc-admin-chevron" aria-hidden="true" />
              </button>
              <div className="cc-admin-body" data-open={adminOpen || adminActive}>
                <SidebarMenu aria-label="Admin-Bereich">
                  {adminItems.map((i) => (
                    <SidebarMenuItem key={i.to}>
                      <NavigationItem
                        to={i.to}
                        label={i.label}
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
          <div className="cc-sidebar-tools">
            {isMaster && callerView && (
              <Button size="sm" aria-pressed={callerView} onClick={toggleCallerView}>
                <Crown size={16} />
                Zur Admin-Sicht
              </Button>
            )}
            <CountrySwitcher />
          </div>
          <div className="cc-profile">
            <div className="cc-user">
              <span className="cc-avatar">
                {(me?.name ?? user.email ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong>{me?.name ?? user.email}</strong>
                <small>
                  {me ? (me.admin && !callerView ? "Admin" : "Caller") : "Profil wird geladen …"}
                </small>
              </div>
            </div>
            <LevelCard />
          </div>
          <Button variant="ghost" className="cc-signout" onClick={signOut}>
            <LogOut size={18} />
            Abmelden
          </Button>
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
        <div id="arbeitsbereich" tabIndex={-1} className="cc-workspace">
          <CallbackReminder userId={user.id} />
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
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
    <SidebarMenuButton asChild isActive={active} size="lg" className="cc-nav-link">
      <Link
        to={to}
        onClick={() => {
          if (isMobile) setOpenMobile(false);
        }}
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
        {badge > 0 && <b className="cc-nav-badge">{badge}</b>}
      </Link>
    </SidebarMenuButton>
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
