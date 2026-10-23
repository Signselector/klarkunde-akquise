import type { CSSProperties } from "react";
import { createFileRoute, redirect, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CalendarClock, CalendarDays, ChartNoAxesColumn, CircleCheck, ClipboardList, Crown, FilePen, FileText, LayoutDashboard, Settings, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

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
  const { data: me } = useQuery({
    queryKey: ["me", user.id],
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      return { name: p.data?.display_name ?? user.email, admin: !!r.data?.some((x) => x.role === "admin") };
    },
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }

  const items = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/leads", label: "Offene Leads", icon: Users },
    { to: "/completed", label: "Abgeschlossen", icon: CircleCheck },
    { to: "/customers", label: "Meine Kunden", icon: FileText },
    { to: "/appointments", label: "Termine", icon: CalendarClock },
    { to: "/offers", label: "Angebote", icon: FilePen },
    { to: "/stats", label: "Statistiken", icon: ChartNoAxesColumn },
    { to: "/daily-stats", label: "Tagesstatistik", icon: CalendarDays },
    { to: "/evaluation", label: "Auswertung", icon: ClipboardList },
    { to: "/import", label: "Upload", icon: Upload },
    ...(me?.admin
      ? [
          { to: "/accounts", label: "Accounts", icon: Crown },
          { to: "/settings", label: "Einstellungen", icon: Settings },
        ]
      : []),
  ] as const;

  return (
    <SidebarProvider style={{ "--sidebar-width": "14.25rem" } as CSSProperties}>
      <Sidebar>
        <SidebarHeader className="border-b border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">CC</div>
            <div className="leading-tight">
              <p className="font-display font-semibold">Cold Call Tool</p>
              <p className="text-xs text-muted-foreground">Team-Akquise</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="p-2">
          <SidebarMenu>
            {items.map((i) => (
              <SidebarMenuItem key={i.to}>
                <SidebarMenuButton asChild>
                  <Link to={i.to} activeProps={{ "data-active": true } as object}>
                    <i.icon />
                    <span>{i.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3">
          <p className="truncate text-xs text-muted-foreground">{me?.name} · {me?.admin ? "Admin" : "Caller"}</p>
          <Button size="sm" variant="ghost" className="justify-start" onClick={signOut}>Abmelden</Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="md:my-2 md:mr-2 md:min-h-[calc(100svh-1rem)] md:rounded-2xl md:border">
        <header className="flex h-12 items-center gap-2 bg-sidebar px-4 md:hidden">
          <SidebarTrigger />
          <span className="font-semibold">Cold Call Tool</span>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
