import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { importDealById } from "@/lib/deal-import.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DealImport() {
  const [country, setCountry] = useState<"DE" | "AT">("AT");
  const [dealId, setDealId] = useState("");
  const [callerId, setCallerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const run = useServerFn(importDealById);

  const { data: staff = [] } = useQuery({
    queryKey: ["deal-import-staff", country],
    queryFn: async () => {
      const { data: uc } = await supabase.from("user_countries").select("user_id").eq("country", country);
      const ids = (uc ?? []).map((r) => r.user_id);
      if (!ids.length) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id,display_name,email,active")
        .in("id", ids)
        .order("display_name");
      return (data ?? []).filter((p) => p.active);
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLast(null);
    try {
      const r = await run({ data: { country, dealId: Number(dealId.trim()), callerId } });
      const msg = `${r.company} wurde übernommen${r.isCustomer ? " und erscheint unter „Meine Kunden“" : ""}.`;
      toast.success(msg);
      setLast(msg);
      setDealId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Übernahme fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4 rounded-lg border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Deal aus Pipedrive nachtragen</h2>
        <p className="text-sm text-muted-foreground">
          Für Leads aus dem alten Tool: Deal-ID eingeben und Mitarbeiter wählen. Firma, Kontakt und Stage werden aus
          Pipedrive übernommen, in Pipedrive wird nichts verändert.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>Land</Label>
          <div className="flex gap-2">
            {(["AT", "DE"] as const).map((c) => (
              <Button
                key={c}
                type="button"
                variant={country === c ? "default" : "outline"}
                onClick={() => {
                  setCountry(c);
                  setCallerId("");
                }}
              >
                {c === "AT" ? "Österreich" : "Deutschland"}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="deal-id">Pipedrive Deal-ID</Label>
          <Input
            id="deal-id"
            inputMode="numeric"
            placeholder="z. B. 23488"
            value={dealId}
            onChange={(e) => setDealId(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="deal-caller">Zuständiger Mitarbeiter</Label>
          <select
            id="deal-caller"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={callerId}
            onChange={(e) => setCallerId(e.target.value)}
          >
            <option value="">Bitte wählen …</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name || p.email}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={busy || !dealId || !callerId}>
          {busy ? "Wird übernommen …" : "Deal übernehmen"}
        </Button>
        {last && <p className="text-sm text-muted-foreground">{last}</p>}
      </form>
    </div>
  );
}
