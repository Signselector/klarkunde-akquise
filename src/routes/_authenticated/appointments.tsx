import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/appointments")({
  head: () => ({ meta: [{ title: "Termine – Sign Selector Cold Caller" }] }),
  component: AppointmentsPage,
});

function AppointmentsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [mine, setMine] = useState(false);
  const [when, setWhen] = useState("");
  const [title, setTitle] = useState("");
  const { data } = useQuery({
    queryKey: ["appointments"],
    queryFn: async () =>
      (await supabase.from("appointments").select("id,starts_at,notes,user_id,lead:leads(company,contact_name,phone)").order("starts_at")).data ?? [],
  });

  async function add() {
    if (!when) return;
    const { error } = await supabase.from("appointments").insert({ user_id: user.id, starts_at: new Date(when).toISOString(), notes: title || "Eigener Termin" });
    if (error) { toast.error(error.message); return; }
    setWhen(""); setTitle("");
    qc.invalidateQueries({ queryKey: ["appointments"] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("appointments").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["appointments"] });
  }

  const list = (data ?? []).filter((a) => !mine || a.user_id === user.id);
  const upcoming = list.filter((a) => new Date(a.starts_at) >= new Date(Date.now() - 3600_000));
  const past = list.filter((a) => !upcoming.includes(a)).reverse();
  const groups = [["Anstehend", upcoming], ["Vergangen", past]] as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-semibold">Termine</h1>
        <div className="flex items-center gap-2"><Switch id="mine" checked={mine} onCheckedChange={setMine} /><Label htmlFor="mine">Nur meine Termine</Label></div>
      </div>
      <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3">
        <Input className="max-w-xs" placeholder="Eigener Termin (Titel)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input className="w-auto" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <Button onClick={add} disabled={!when}>Eintragen</Button>
      </div>
      {groups.map(([label, items]) => (
        <section key={label} className="space-y-2">
          <h2 className="font-semibold">{label} ({items.length})</h2>
          {items.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3">
              <div>
                <p className="font-medium">{a.lead?.company ?? a.notes ?? "Termin"}</p>
                <p className="text-sm text-muted-foreground">{new Date(a.starts_at).toLocaleString("de-DE")}{a.lead?.phone ? ` · ${a.lead.phone}` : ""}{a.lead && a.notes ? ` · ${a.notes}` : ""}</p>
              </div>
              {a.user_id === user.id && <Button size="sm" variant="ghost" onClick={() => remove(a.id)}>Löschen</Button>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
