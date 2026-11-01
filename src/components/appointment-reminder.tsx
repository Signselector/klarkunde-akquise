import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCountry } from "@/lib/country";

/** Reminds the owner of an appointment shortly before it starts. */
export const APPOINTMENT_REMIND_BEFORE_MS = 10 * 60_000;

export function AppointmentReminder({ userId }: { userId: string }) {
  const country = useCountry();
  const navigate = useNavigate();
  const notified = useRef(new Set<string>());
  const query = useQuery({
    queryKey: ["appointment-reminders", userId, country],
    refetchInterval: 30_000,
    queryFn: async () => {
      const now = Date.now();
      const { data, error } = await supabase
        .from("appointments")
        .select("id,starts_at,title,outcome,lead:leads(company)")
        .eq("user_id", userId)
        .eq("country", country)
        .is("outcome", null)
        .gte("starts_at", new Date(now - 60_000).toISOString())
        .lte("starts_at", new Date(now + APPOINTMENT_REMIND_BEFORE_MS).toISOString())
        .order("starts_at")
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    for (const a of query.data ?? []) {
      const key = `${a.id}:${a.starts_at}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      const toastId = `appointment-soon-${a.id}`;
      const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.starts_at));
      toast("Termin in Kürze", {
        id: toastId,
        icon: <CalendarClock className="h-4 w-4" aria-hidden="true" />,
        description: `${a.lead?.company || a.title || "Termin"} · ${time} Uhr`,
        duration: Infinity,
        closeButton: true,
        action: {
          label: "Termin öffnen",
          onClick: () => {
            toast.dismiss(toastId);
            void navigate({ to: "/appointments", search: { termin: a.id } as never });
          },
        },
      });
    }
  }, [query.data, navigate]);
  return null;
}
