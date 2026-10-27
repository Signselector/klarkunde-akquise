import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Shows a message once for every appointment someone else assigned to the user, then marks it read. */
export function AppointmentNotifier({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["appointment-notifications", userId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointment_notifications")
        .select("id,appointment:appointments(starts_at,title)")
        .eq("user_id", userId)
        .is("read_at", null)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Live: a new notification or any change of an appointment shows up at once, without waiting for the next poll.
  useEffect(() => {
    const channel = supabase
      .channel(`appointments-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointment_notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => void qc.invalidateQueries({ queryKey: ["appointment-notifications", userId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => {
        void qc.invalidateQueries({ queryKey: ["appointments"] });
        void qc.invalidateQueries({ queryKey: ["slots"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId]);

  useEffect(() => {
    if (!data?.length) return;
    for (const n of data) {
      const when = n.appointment
        ? new Intl.DateTimeFormat("de-DE", {
            weekday: "short",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(n.appointment.starts_at))
        : "";
      toast.info("Neuer Termin für dich", {
        description: [n.appointment?.title, when].filter(Boolean).join(" · "),
        duration: 10_000,
      });
    }
    void supabase
      .from("appointment_notifications")
      .update({ read_at: new Date().toISOString() })
      .in(
        "id",
        data.map((n) => n.id),
      )
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["appointment-notifications", userId] });
        void qc.invalidateQueries({ queryKey: ["appointments"] });
      });
  }, [data, qc, userId]);

  return null;
}
