import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

function download(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Master-admin only: last 7 full backups, daily at 02:00 UTC, downloadable. */
export function BackupCenter() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ["backups"],
    queryFn: async () =>
      (await supabase.from("backups").select("id,created_at,kind,rows_total,size_bytes").order("created_at", { ascending: false })).data ?? [],
  });

  async function create() {
    setBusy(true);
    const { error } = await supabase.rpc("create_backup", { p_kind: "manual" });
    setBusy(false);
    if (error) { toast.error("Backup fehlgeschlagen."); return; }
    toast.success("Backup erstellt.");
    qc.invalidateQueries({ queryKey: ["backups"] });
  }

  async function get(id: string, at: string) {
    const { data: b, error } = await supabase.from("backups").select("data").eq("id", id).single();
    if (error || !b) { toast.error("Download fehlgeschlagen."); return; }
    download(b.data, `coldcaller-backup-${at.slice(0, 10)}.json`);
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Backups</h2>
          <p className="text-sm text-muted-foreground">
            Jede Nacht automatisch ein komplettes Backup (Accounts, Rollen, Länder, Leads, Termine, Angebote, Einstellungen). Die letzten 7 bleiben, ältere werden gelöscht.
          </p>
        </div>
        <Button onClick={create} disabled={busy}>{busy ? "Erstelle …" : "Backup jetzt erstellen"}</Button>
      </div>
      {data?.length === 0 && <p className="text-sm text-muted-foreground">Noch kein Backup vorhanden.</p>}
      <div className="divide-y">
        {data?.map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>
              {new Date(b.created_at).toLocaleString("de-DE")} · {b.kind === "auto" ? "automatisch" : "manuell"} · {b.rows_total} Einträge · {(b.size_bytes / 1024).toFixed(0)} KB
            </span>
            <Button size="sm" variant="outline" onClick={() => get(b.id, b.created_at)}>Herunterladen</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
