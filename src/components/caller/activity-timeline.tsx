import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ACTIVITY_LABEL, stageLabel } from "@/lib/crm-stage-labels";
import { FeedbackState, StatusBadge } from "@/components/coldcaller/primitives";
import { Button } from "@/components/ui/button";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Vienna",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Permanent, chronological history of a lead and its Pipedrive deal: who did what, from which stage to which.
 * Read only. Entries from Pipedrive (stage changes, wins) stand next to the ones from this tool.
 */
export function ActivityTimeline({ leadId }: { leadId: string }) {
  const q = useQuery({
    queryKey: ["lead-activity", leadId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_activity")
        .select(
          "id,seq,action_type,acting_user_id,acting_user_name,origin_caller_id,previous_stage,new_stage,occurred_at,source,deal_id,details",
        )
        .eq("lead_id", leadId)
        .order("occurred_at", { ascending: true })
        .order("seq", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (q.isLoading) return <FeedbackState kind="loading" title="Aktivitätsverlauf wird geladen" />;
  if (q.isError)
    return (
      <FeedbackState
        kind="error"
        title="Aktivitätsverlauf nicht verfügbar"
        action={<Button onClick={() => void q.refetch()}>Erneut versuchen</Button>}
      />
    );
  const rows = q.data ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">Noch keine Aktivitäten.</p>;
  const originId = rows.find((r) => r.origin_caller_id)?.origin_caller_id;
  const originName = rows.find(
    (r) => r.acting_user_id === originId && r.acting_user_name,
  )?.acting_user_name;
  const dealId = [...rows].reverse().find((r) => r.deal_id)?.deal_id;
  return (
    <div className="space-y-2">
      {(originName || dealId) && (
        <p className="text-sm text-muted-foreground">
          {originName && (
            <>
              Ursprünglicher Caller: <strong className="text-foreground">{originName}</strong>
            </>
          )}
          {originName && dealId && " · "}
          {dealId && <>Pipedrive-Deal {dealId}</>}
        </p>
      )}
      <ol className="space-y-2" aria-label="Aktivitätsverlauf">
        {rows.map((r) => {
          const from = r.previous_stage ? stageLabel(r.previous_stage) : null;
          const to = r.new_stage ? stageLabel(r.new_stage) : null;
          return (
            <li
              key={r.id}
              className="grid grid-cols-[9.5rem_1fr] gap-x-3 gap-y-0.5 rounded-lg border p-2.5 text-sm"
            >
              <time dateTime={r.occurred_at} className="text-muted-foreground tabular-nums">
                {fmt(r.occurred_at)}
              </time>
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {ACTIVITY_LABEL[r.action_type] ?? r.action_type}
                  {r.source === "pipedrive" && <StatusBadge tone="info">Pipedrive</StatusBadge>}
                </p>
                <p className="text-muted-foreground">
                  {r.acting_user_name || (r.source === "pipedrive" ? "Pipedrive" : "–")}
                  {(from || to) && (
                    <>
                      {" · "}
                      {from ?? "–"} → {to ?? "–"}
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
