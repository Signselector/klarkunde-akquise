import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCountry } from "@/lib/country";

/** Persistent reminder (top right) for due callbacks; one toast per callback, closed by its button or the X. */
const REMIND_BEFORE_MS = 5 * 60_000;

export function CallbackReminder({ userId }: { userId: string }) {
  const country = useCountry();
  const navigate = useNavigate();
  const location = useLocation();
  const notified = useRef(new Set<string>());
  const shown = useRef(new Set<string>());
  const qc = useQueryClient();
  // Live: a moved, done or deleted callback updates the reminders at once.
  useEffect(() => {
    const channel = supabase
      .channel(`callbacks-${userId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "callbacks", filter: `user_id=eq.${userId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["callback-reminders", userId] });
        void qc.invalidateQueries({ queryKey: ["callbacks"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId]);
  const query = useQuery({
    queryKey: ["callback-reminders", userId, country],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("callbacks")
        .select("id,due_at,lead:leads(id,company)")
        .eq("user_id", userId)
        .eq("country", country)
        .eq("done", false)
        // Reminded five minutes ahead; overdue callbacks stay in the list.
        .lte("due_at", new Date(Date.now() + REMIND_BEFORE_MS).toISOString())
        .order("due_at")
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    const due = query.data ?? [];
    // A reminder whose callback was deleted, done or moved later disappears.
    if (query.data) {
      const live = new Set(due.map((c) => `callback-${c.id}`));
      for (const id of shown.current) if (!live.has(id)) { toast.dismiss(id); shown.current.delete(id); }
    }
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
      shown.current.add(toastId);
      const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(callback.due_at),
      );
      toast(
        new Date(callback.due_at).getTime() > Date.now() ? "Rückruf in Kürze" : "Rückruf fällig",
        {
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
        },
      );
    }
  }, [query.data, userId, location.pathname, navigate]);
  return null;
}
