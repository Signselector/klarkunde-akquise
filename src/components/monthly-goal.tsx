import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_MONTHLY_CALL_GOAL, MONTHLY_GOAL_KEY, parseGoal } from "@/lib/goals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Settings → Ziele: the monthly call goal shown in every caller's dashboard. */
export function MonthlyGoalCard() {
  const qc = useQueryClient();
  const saved = useQuery({
    queryKey: ["app-setting", MONTHLY_GOAL_KEY],
    queryFn: async () =>
      (
        await supabase
          .from("app_settings")
          .select("value")
          .eq("key", MONTHLY_GOAL_KEY)
          .maybeSingle()
      ).data?.value ?? null,
  });
  const [value, setValue] = useState(String(DEFAULT_MONTHLY_CALL_GOAL));
  useEffect(() => {
    if (saved.isSuccess) setValue(String(parseGoal(saved.data)));
  }, [saved.isSuccess, saved.data]);
  async function save() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 100000) {
      toast.error("Bitte eine ganze Zahl zwischen 1 und 100000 eintragen.");
      return;
    }
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: MONTHLY_GOAL_KEY, value: String(n), updated_at: new Date().toISOString() });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Monatsziel gespeichert.");
    void qc.invalidateQueries({ queryKey: ["app-setting", MONTHLY_GOAL_KEY] });
  }
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">Monatsziel Anrufe</h2>
      <p className="text-sm text-muted-foreground">
        Anzahl dokumentierter Anrufversuche pro Caller und Monat. Der Fortschritt steht im Dashboard
        bei „Anrufe heute“.
      </p>
      <div className="flex max-w-xs gap-2">
        <Input
          inputMode="numeric"
          aria-label="Monatsziel Anrufe"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button onClick={save}>Speichern</Button>
      </div>
    </section>
  );
}
