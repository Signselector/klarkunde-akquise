import { isMasterEmail } from "@/lib/master";
import { CallbackReminder } from "@/components/caller/callback-reminder";
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
  CalendarCheck,
  CalendarDays,
  ChartNoAxesColumn,
  CircleCheck,
  ChevronDown,
  Crown,
  LogOut,
  FileText,
  LayoutDashboard,
  Settings,
  Upload,
  Users,
} from "@/components/coldcaller/icons";
import { Button } from "@/components/ui/button";

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
  // The pill shows only the current area; hover or focus opens it, a click closes it again.
  const [navOpen, setNavOpen] = useState(false);
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
    { to: "/leads", label: "Offene Leads", icon: Users },
    { to: "/callbacks", label: "Rückrufe", icon: CalendarClock },
    { to: "/completed", label: "Abgeschlossene Leads", icon: CircleCheck },
    { to: "/customers", label: "Meine Kunden", icon: FileText },
    { to: "/appointments", label: "Termine", icon: CalendarCheck },
    ...(!(me?.admin && !callerView)
      ? [{ to: "/my-stats", label: "Statistik", icon: ChartNoAxesColumn }]
      : []),
    ...(me?.admin && !callerView
      ? [
          { to: "/stats", label: "Statistiken", icon: ChartNoAxesColumn },
          { to: "/daily-stats", label: "Tagesstatistik", icon: CalendarDays },
        ]
      : []),
    ...(isMaster && !callerView ? [{ to: "/import", label: "Upload", icon: Upload }] : []),
    ...(me?.admin && !callerView
      ? [
          { to: "/accounts", label: "Accounts", icon: Crown },
          { to: "/settings", label: "Einstellungen", icon: Settings },
        ]
      : []),
  ] as const;

  function toggleCallerView() {
    const next = !callerView;
    setCallerView(next);
    localStorage.setItem("cc-caller-view", next ? "1" : "0");
    if (next && (location.pathname === "/accounts" || location.pathname === "/settings")) {
      nav({ to: "/leads" });
    }
  }

  const initials = (me?.name ?? user.email ?? "?").slice(0, 2).toUpperCase();
  return (
    <div className="cc-theme cc-app cc-shell">
      <a href="#arbeitsbereich" className="cc-skip-link">
        Zum Arbeitsbereich
      </a>
      <header className="cc-topnav">
        <div className="cc-topnav-inner">
          <Link
            to="/dashboard"
            className="cc-brand"
            aria-label="Sign Selector Cold Caller – Dashboard"
          >
            <Brand />
          </Link>
          <nav
            className="cc-topnav-links"
            aria-label="Hauptnavigation"
            data-open={navOpen}
            onMouseEnter={() => setNavOpen(true)}
            onMouseLeave={() => setNavOpen(false)}
            onFocus={() => setNavOpen(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setNavOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setNavOpen(false);
            }}
          >
            <button
              type="button"
              className="cc-nav-trigger"
              aria-expanded={navOpen}
              aria-haspopup="true"
              onClick={() => setNavOpen((o) => !o)}
            >
              {(() => {
                const cur = items.find((i) => i.to === location.pathname) ?? items[0];
                const Icon = cur.icon;
                return (
                  <>
                    <Icon aria-hidden="true" />
                    <span>{cur.label}</span>
                  </>
                );
              })()}
              <ChevronDown className="cc-nav-chevron" aria-hidden="true" />
            </button>
            <div className="cc-nav-panel">
              {items.map((i, k) => (
                <NavigationItem
                  key={i.to}
                  to={i.to}
                  label={i.label}
                  icon={i.icon}
                  active={location.pathname === i.to}
                  index={k}
                  onNavigate={() => setNavOpen(false)}
                />
              ))}
            </div>
          </nav>
          <div className="cc-topnav-user">
            {isMaster && callerView && (
              <Button size="sm" aria-pressed={callerView} onClick={toggleCallerView}>
                <Crown size={16} />
                Zur Admin-Sicht
              </Button>
            )}
            <CountrySwitcher />
            <div className="cc-user">
              <span className="cc-avatar">{initials}</span>
              <div>
                <strong>{me?.name ?? user.email}</strong>
                <small>
                  {me ? (me.admin && !callerView ? "Admin" : "Caller") : "Profil wird geladen …"}
                </small>
              </div>
            </div>
            <Button variant="ghost" className="cc-signout" onClick={signOut} aria-label="Abmelden">
              <LogOut size={18} />
            </Button>
          </div>
        </div>
      </header>
      <TestModeBanner />
      <div id="arbeitsbereich" tabIndex={-1} className="cc-workspace">
        <CallbackReminder userId={user.id} />
        <Outlet />
      </div>
    </div>
  );
}

function NavigationItem({
  to,
  label,
  icon: Icon,
  active,
  index,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: typeof Users;
  active: boolean;
  index: number;
  onNavigate: () => void;
}) {
  return (
    <Link
      onClick={onNavigate}
      to={to}
      className="cc-nav-link"
      data-active={active}
      style={{ "--k": index } as CSSProperties}
      aria-current={active ? "page" : undefined}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
