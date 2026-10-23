import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/callbacks")({
  head: () => ({ meta: [{ title: "Callbacks – Cold Call Tool" }] }),
  component: CallbacksPage,
});

function CallbacksPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["callbacks"],
    queryFn: async () =>
      (await supabase.from("callbacks").select("id,due_at,user_id,lead:leads(id,company,contact_name,phone)").eq("done", false).order("due_at")).data ?? [],
  });

  async function done(id: string) {
    const { error } = await supabase.from("callbacks").update({ done: true }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["callbacks"] });
  }

  const now = new Date();
  const sameDay = (d: Date) => d.toDateString() === now.toDateString();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Callbacks</h1>
      {isLoading && <p className="text-muted-foreground">Lädt …</p>}
      {data?.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">Keine offenen Callbacks.</p>}
      <div className="space-y-2">
        {data?.map((c) => {
          const due = new Date(c.due_at);
          const overdue = due < now;
          const today = sameDay(due);
          return (
            <div key={c.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${overdue ? "border-destructive/50 bg-destructive/5" : today ? "border-primary/50 bg-primary/5" : "bg-card"}`}>
              <div>
                <p className="font-medium">{c.lead?.company || "Ohne Firmenname"}</p>
                <p className="text-sm text-muted-foreground">{[c.lead?.contact_name, c.lead?.phone].filter(Boolean).join(" · ")}</p>
                <p className="text-sm">{due.toLocaleString("de-DE")} {overdue ? <Badge variant="destructive">Überfällig</Badge> : today ? <Badge>Heute fällig</Badge> : null} {c.user_id === user.id && <Badge variant="outline">Meiner</Badge>}</p>
              </div>
              <div className="flex gap-2">
                {c.lead?.phone && <Button asChild size="sm"><a href={`tel:${c.lead.phone}`}>Anrufen</a></Button>}
                <Button size="sm" variant="outline" onClick={() => done(c.id)}>Erledigt</Button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">Neue Callbacks entstehen im <Link to="/call" className="underline">Anruf-Ablauf</Link>.</p>
    </div>
  );
}
