import { Brand } from "@/components/coldcaller/brand";
import { TestModeBanner } from "@/components/TestMode";
import { CountrySwitcher } from "@/lib/country";
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
  CalendarDays,
  ChartNoAxesColumn,
  CircleCheck,
  ClipboardList,
  Crown,
  Phone,
  LogOut,
  FilePen,
  FileText,
  LayoutDashboard,
  Settings,
  Upload,
  Users,
} from "lucide-react";
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

  const isMaster = user.email?.toLowerCase() === "office@signselector.com";
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

  const items = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/call", label: "Anrufen", icon: Phone },
    { to: "/leads", label: "Leads", icon: Users },
    { to: "/callbacks", label: "Rückrufe", icon: CalendarClock },
    { to: "/completed", label: "Abgeschlossen", icon: CircleCheck },
    { to: "/customers", label: "Meine Kunden", icon: FileText },
    { to: "/appointments", label: "Termine", icon: CalendarClock },
    { to: "/offers", label: "Angebote", icon: FilePen },
    { to: "/stats", label: "Statistiken", icon: ChartNoAxesColumn },
    { to: "/daily-stats", label: "Tagesstatistik", icon: CalendarDays },
    { to: "/evaluation", label: "Auswertung", icon: ClipboardList },
    { to: "/import", label: "Upload", icon: Upload },
    ...(me?.admin && !callerView
      ? [
          { to: "/accounts", label: "Accounts", icon: Crown },
          { to: "/settings", label: "Einstellungen", icon: Settings },
        ]
      : []),
  ] as const;

  const pageTitle = items.find((item) => item.to === location.pathname)?.label ?? "Arbeitsplatz";

  function toggleCallerView() {
    const next = !callerView;
    setCallerView(next);
    localStorage.setItem("cc-caller-view", next ? "1" : "0");
    if (next && (location.pathname === "/accounts" || location.pathname === "/settings")) {
      nav({ to: "/call" });
    }
  }

  return (
    <SidebarProvider
      className="cc-theme cc-app"
      style={{ "--sidebar-width": "15.5rem" } as CSSProperties}
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
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="cc-sidebar-footer">
          <div className="cc-user">
            <span className="cc-avatar">
              {(me?.name ?? user.email ?? "?").slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{me?.name ?? user.email}</strong>
              <small>{me ? (me.admin && !callerView ? "Admin" : "Caller") : "Profil wird geladen …"}</small>
            </div>
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
            <span className="cc-breadcrumb">
              Sign Selector <span aria-hidden="true">/</span> <strong>{pageTitle}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isMaster && callerView && (
              <Button
                size="sm"
                variant={callerView ? "default" : "outline"}
                aria-pressed={callerView}
                onClick={toggleCallerView}
              >
                <Crown size={16} />
                Zur Admin-Sicht
              </Button>
            )}
            <CountrySwitcher />
          </div>
        </header>
        <TestModeBanner />
        <div id="arbeitsbereich" tabIndex={-1} className="cc-workspace">
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
}: {
  to: string;
  label: string;
  icon: typeof Users;
  active: boolean;
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
      </Link>
    </SidebarMenuButton>
  );
}
