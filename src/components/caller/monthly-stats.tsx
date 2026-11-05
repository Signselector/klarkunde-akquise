import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  currentMonth,
  monthLabel,
  monthOptions,
  monthValue,
  monthWindow,
  parseMonth,
  shiftMonth,
  summarize,
  type StatusEvent,
} from "@/lib/monthly-stats";
import { FeedbackState, Surface } from "@/components/coldcaller/primitives";
import { PageHeading } from "@/components/coldcaller/workspace-parts";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";

const PAGE = 1000;

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-sm">
          <span className="w-36 shrink-0 text-muted-foreground">{i.label}</span>
          <div className="h-5 flex-1 rounded bg-muted">
            <div
              className="h-5 rounded bg-primary"
              style={{ width: `${(i.value / max) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right tabular-nums">{i.value}</span>
        </div>
      ))}
    </div>
  );
}

/** The caller's own numbers for one month, any past month selectable. */
export function MonthlyStats({ userId }: { userId: string }) {
  const [ym, setYm] = useState(() => currentMonth());
  const now = currentMonth();
  const isCurrent = monthValue(ym) === monthValue(now);
  const options = monthOptions();

  const events = useQuery({
    queryKey: ["monthly-stats", userId, monthValue(ym)],
    // A finished month never changes; the running month refreshes when the page is opened again.
    staleTime: isCurrent ? 60_000 : 30 * 60_000,
    queryFn: async () => {
      const { from, to } = monthWindow(ym);
      const rows: StatusEvent[] = [];
      for (let start = 0; start < 20 * PAGE; start += PAGE) {
        const { data, error } = await supabase
          .from("status_changes")
          .select("new_status,created_at")
          .eq("user_id", userId)
          .gte("created_at", from)
          .lt("created_at", to)
          .order("created_at")
          .range(start, start + PAGE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length < PAGE) break;
      }
      return rows;
    },
  });
  const stats = events.data ? summarize(events.data, ym) : null;
  const maxDay = Math.max(1, ...(stats?.perDay.map((d) => d.value) ?? [1]));

  return (
    <div className="cc-page">
      <PageHeading
        title="Statistik"
        description="Deine Gespräche und Ergebnisse pro Monat, alle Länder zusammen. Frühere Monate wählst du rechts oben aus."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Vorheriger Monat"
              onClick={() => setYm(shiftMonth(ym, -1))}
              disabled={monthValue(ym) === monthValue(options[options.length - 1]!)}
            >
              ‹
            </Button>
            <Dropdown
              ariaLabel="Monat wählen"
              value={monthValue(ym)}
              onChange={(v) => setYm(parseMonth(v))}
              options={options.map((o) => ({ value: monthValue(o), label: monthLabel(o) }))}
            />
            <Button
              variant="outline"
              size="sm"
              aria-label="Nächster Monat"
              onClick={() => setYm(shiftMonth(ym, 1))}
              disabled={isCurrent}
            >
              ›
            </Button>
          </div>
        }
      />
      {events.isLoading ? (
        <FeedbackState kind="loading" title="Statistik wird geladen" />
      ) : events.isError || !stats ? (
        <FeedbackState
          kind="error"
          title="Statistik nicht verfügbar"
          action={<Button onClick={() => void events.refetch()}>Erneut versuchen</Button>}
        />
      ) : (
        <>
          <Surface
            title={monthLabel(ym)}
            description={isCurrent ? "Laufender Monat, Stand jetzt" : "Abgeschlossener Monat"}
          >
            <div className="cc-surface-body">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  ["Gespräche", stats.calls],
                  ["Erreicht", stats.reached],
                  ["Erreichungsquote", stats.reachRate === null ? "–" : `${stats.reachRate} %`],
                  ["Deals in Pipedrive", stats.deals],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="text-[28px] tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-muted-foreground">
                Gespräche zählen jedes gespeicherte Gesprächsergebnis. Erreicht sind alle außer
                „Nicht erreicht“. Deals sind Logo Render, Realismus Render, Logo ausstehend,
                Zukunftsprojekt und Referenzmail.
                {stats.calls === 0 && " In diesem Monat gibt es keine Gespräche."}
              </p>
            </div>
          </Surface>
          <div className="grid gap-4 lg:grid-cols-2">
            <Surface title="Ergebnisse">
              <div className="cc-surface-body">
                <Bars items={stats.byOutcome.map(({ label, value }) => ({ label, value }))} />
              </div>
            </Surface>
            <Surface
              title="Gespräche pro Tag"
              description={`${stats.activeDays} ${stats.activeDays === 1 ? "aktiver Tag" : "aktive Tage"}`}
            >
              <div className="cc-surface-body">
                <div
                  className="group/tl flex h-44 items-end gap-1"
                  role="img"
                  aria-label="Gespräche pro Tag im Monat"
                >
                  {stats.perDay.map((d) => (
                    <div
                      key={d.day}
                      title={`${d.day}. ${monthLabel(ym).split(" ")[0]}: ${d.value} Gespräche`}
                      className="group/bar flex h-full min-w-0 flex-1 flex-col justify-end text-center transition-opacity duration-150 group-hover/tl:opacity-30 hover:!opacity-100"
                    >
                      <span className="text-[10px] font-medium tabular-nums text-foreground opacity-0 transition-opacity duration-150 group-hover/bar:opacity-100">
                        {d.value || ""}
                      </span>
                      <div
                        className={d.value ? "w-full rounded-t bg-primary" : "w-full rounded-t bg-muted"}
                        style={{ height: `${Math.max(d.value ? 6 : 2, (d.value / maxDay) * 100)}%` }}
                      />
                      <span className="mt-1 truncate text-[10px] text-muted-foreground">{d.day}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Surface>
          </div>
        </>
      )}
    </div>
  );
}
