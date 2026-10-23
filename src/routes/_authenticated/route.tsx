import { createFileRoute, redirect, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

  const link = "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent";
  const active = { className: "rounded-md px-3 py-1.5 text-sm bg-accent text-foreground font-medium" };
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
          <span className="font-display mr-2 font-bold text-primary">Cold Call</span>
          <nav className="flex flex-1 flex-wrap gap-1">
            <Link to="/dashboard" className={link} activeProps={active}>Übersicht</Link>
            <Link to="/call" className={link} activeProps={active}>Anrufen</Link>
            <Link to="/import" className={link} activeProps={active}>Import</Link>
          </nav>
          <span className="text-xs text-muted-foreground">
            {me?.name} · {me?.admin ? "Admin" : "Caller"}
          </span>
          <Button size="sm" variant="ghost" onClick={signOut}>Abmelden</Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
