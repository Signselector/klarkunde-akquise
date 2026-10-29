import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { celebrate, STAGE_ACHIEVEMENT } from "@/lib/achievements";

/** Celebrates every deal of the user that reached Low Q / High Q in the CRM, once, then marks it as seen. */
export function AchievementNotifier({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["achievement-events", userId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("achievement_events")
        .select("id,stage_key,company,created_at")
        .eq("user_id", userId)
        .is("seen_at", null)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`achievements-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "achievement_events", filter: `user_id=eq.${userId}` },
        () => void qc.invalidateQueries({ queryKey: ["achievement-events", userId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId]);

  useEffect(() => {
    if (!data?.length) return;
    for (const e of data) {
      const kind = STAGE_ACHIEVEMENT[e.stage_key as keyof typeof STAGE_ACHIEVEMENT] ?? "Qualifizierter Lead";
      celebrate({
        title: `${kind} erreicht`,
        detail: `${e.company || "Ein Lead von dir"} wurde als Deal angelegt. Stark gemacht!`,
        tone: e.stage_key === "high_q" ? "gold" : "blue",
      });
    }
    void supabase
      .from("achievement_events")
      .update({ seen_at: new Date().toISOString() })
      .in("id", data.map((e) => e.id))
      .then(() => void qc.invalidateQueries({ queryKey: ["achievement-events", userId] }));
  }, [data, qc, userId]);

  return null;
}
