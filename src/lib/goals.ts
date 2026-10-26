import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Used until an admin or manager sets the goal in Settings → Ziele. */
export const DEFAULT_MONTHLY_CALL_GOAL = 800;
export const MONTHLY_GOAL_KEY = "monthly_call_goal";

export function parseGoal(raw: string | null | undefined) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 100000 ? n : DEFAULT_MONTHLY_CALL_GOAL;
}

export function useMonthlyCallGoal() {
  const q = useQuery({
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
  return parseGoal(q.data);
}
