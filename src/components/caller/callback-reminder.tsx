import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCountry } from "@/lib/country";

/** Persistent reminder (top right) for due callbacks; one toast per callback, closed by its button or the X. */
export function CallbackReminder({ userId }: { userId: string }) {
  const country = useCountry();
  const navigate = useNavigate();
  const location = useLocation();
  const notified = useRef(new Set<string>());
  const query = useQuery({
    queryKey: ["callback-reminders", userId, country],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("callbacks")
        .select("id,due_at,lead:leads(id,company)")
        .eq("user_id", userId)
        .eq("country", country)
        .eq("done", false)
        .lte("due_at", new Date().toISOString())
        .order("due_at")
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    const due = query.data ?? [];
    // Already on the callbacks page: nothing to point at, and earlier reminders are done with.
    if (location.pathname === "/callbacks") {
      for (const callback of due) toast.dismiss(`callback-${callback.id}`);
      return;
    }
    for (const callback of due) {
      const key = `${userId}:${callback.id}:${callback.due_at}`;
      if (!callback.lead || notified.current.has(key)) continue;
      notified.current.add(key);
      const lead = callback.lead;
      const toastId = `callback-${callback.id}`;
      const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(callback.due_at),
      );
      toast("Rückruf fällig", {
        id: toastId,
        icon: (
          <span className="cc-toast-icon">
            <PhoneCall className="h-4 w-4" aria-hidden="true" />
          </span>
        ),
        className: "cc-callback-toast",
        description: `${lead.company || "Rückruf"} · geplant für ${time} Uhr`,
        duration: Infinity,
        closeButton: true,
        action: {
          label: "Zu den Rückrufen",
          onClick: () => {
            toast.dismiss(toastId);
            void navigate({ to: "/callbacks" });
          },
        },
      });
    }
  }, [query.data, userId, location.pathname, navigate]);
  return null;
}
