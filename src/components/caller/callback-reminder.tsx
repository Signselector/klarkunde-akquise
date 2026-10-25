import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCountry } from "@/lib/country";
import { LeadDialog } from "@/components/caller/lead-dialog";

/** A separate overlay keeps the mounted call form and its note drafts intact. */
export function CallbackReminder({ userId }: { userId: string }) {
  const country = useCountry();
  const [leadId, setLeadId] = useState<string | null>(null);
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
    for (const callback of query.data ?? []) {
      const key = `${userId}:${callback.id}:${callback.due_at}`;
      if (!callback.lead || notified.current.has(key)) continue;
      notified.current.add(key);
      const lead = callback.lead;
      toast("Jetzt zurückrufen", {
        description: lead.company || "Rückruf fällig",
        duration: 15000,
        action: { label: "Kundenakte öffnen", onClick: () => setLeadId(lead.id) },
      });
    }
  }, [query.data, userId]);
  return (
    <LeadDialog leadId={leadId} userId={userId} admin={false} onClose={() => setLeadId(null)} />
  );
}
