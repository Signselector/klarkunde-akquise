import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getViewAs } from "@/lib/view-as";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { backendEnabled } from "@/lib/backend";
import { syncMyCalendar } from "@/lib/calendar-sync.functions";

export type ExternalActivity = {
  activity_id: number;
  user_id: string;
  subject: string | null;
  type: string | null;
  due_at: string;
  duration_min: number;
  deal_id: number | null;
  person_name: string | null;
  org_name: string | null;
};

/**
 * Keeps the calendar in step with the user's Pipedrive calendar: runs when the page opens, then every five minutes.
 * Returns the entries that exist only in Pipedrive; the user's own callbacks and appointments come from their tables.
 */
export function useCalendarSync(userId: string, country: string) {
  const qc = useQueryClient();
  const run = useServerFn(syncMyCalendar);
  const sync = useQuery({
    // A manager viewing an employee must not trigger that employee's Pipedrive sync.
    enabled: backendEnabled && !getViewAs(),
    queryKey: ["calendar-sync", userId, country],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const r = await run({ data: { country } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["callbacks"] }),
        qc.invalidateQueries({ queryKey: ["appointments"] }),
        qc.invalidateQueries({ queryKey: ["external-activities"] }),
      ]);
      return { ...r, at: new Date().toISOString() };
    },
  });
  const external = useQuery({
    enabled: backendEnabled,
    queryKey: ["external-activities", userId, country],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipedrive_activities")
        .select("activity_id,user_id,subject,type,due_at,duration_min,deal_id,person_name,org_name")
        .eq("country", country)
        .eq("done", false)
        .order("due_at")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ExternalActivity[];
    },
  });
  return { sync, external: external.data ?? [], resync: () => sync.refetch() };
}

const TEXT: Record<string, string> = {
  simulated: "Testmodus: Der Abgleich mit Pipedrive ist aus.",
  no_pipedrive_user:
    "Kein Pipedrive-Benutzer mit deiner E-Mail-Adresse gefunden. Bitte einen Admin, ihn anzulegen.",
  not_configured: "Die Pipedrive-Verbindung ist für dieses Land nicht eingerichtet.",
  error: "Der Abgleich mit Pipedrive ist fehlgeschlagen. Er wird automatisch erneut versucht.",
};

/** One line under the calendar: whether it is in step with Pipedrive. */
export function CalendarSyncStatus({ sync }: { sync: ReturnType<typeof useCalendarSync>["sync"] }) {
  if (!backendEnabled) return null;
  const d = sync.data;
  const text = sync.isFetching
    ? "Abgleich mit Pipedrive läuft …"
    : sync.isError
      ? TEXT["error"]
      : d && d.state !== "synced"
        ? TEXT[d.state]
        : d
          ? `Mit deinem Pipedrive-Kalender abgeglichen (${new Date(d.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}). Du siehst nur deine eigenen Einträge.`
          : "";
  return (
    <p role="status" className="text-xs text-muted-foreground">
      {text}{" "}
      <button type="button" className="underline" onClick={() => void sync.refetch()}>
        Jetzt abgleichen
      </button>
    </p>
  );
}
