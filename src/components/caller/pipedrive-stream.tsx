import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, CalendarDays, Mail, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/coldcaller/primitives";
import { hasLeadDeal, loadLeadStream } from "@/lib/deal-detail.functions";
import type { StreamItem, StreamKind } from "@/lib/deal-detail";
import { withViewAsRead } from "@/lib/view-as";

const when = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

type Tab = "all" | "notes" | "activity" | "email" | "file" | "stage";
const STAFF_TABS: [Tab, string][] = [
  ["all", "Alle"],
  ["notes", "Notizen"],
  ["activity", "Aktivitäten"],
  ["email", "E-Mails"],
  ["file", "Dateien"],
  ["stage", "Stage-Verlauf"],
];
const CALLER_TABS: [Tab, string][] = [
  ["all", "Alle"],
  ["notes", "Notizen"],
];
const KIND_TAB: Record<StreamKind, Tab> = {
  stage: "stage",
  status: "stage",
  created: "stage",
  activity: "activity",
  email: "email",
  file: "file",
};

type Entry = { type: "note"; id: string; at: string; author: string | null; text: string } | { type: "item"; item: StreamItem };

function Row({ entry }: { entry: Entry }) {
  const base = "rounded-md border p-3 text-sm";
  if (entry.type === "note")
    return (
      <li className={`${base} border-amber-200 bg-amber-50 text-amber-950`}>
        <p className="mb-1 text-xs opacity-70">
          {when(entry.at)}
          {entry.author ? ` · ${entry.author}` : ""}
        </p>
        <p className="whitespace-pre-wrap break-words">{entry.text}</p>
      </li>
    );
  const i = entry.item;
  const icon =
    i.kind === "email" ? <Mail size={16} /> : i.kind === "activity" ? <CalendarDays size={16} /> : i.kind === "file" ? <Paperclip size={16} /> : <ArrowRight size={16} />;
  return (
    <li className={`${base} flex gap-3 bg-card`}>
      <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium">
          {i.kind === "activity" && i.activity ? <span className="font-normal text-muted-foreground">{i.activity}: </span> : null}
          {i.text}
          {i.state && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
              {i.state}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {when(i.at)}
          {i.by ? ` · ${i.by}` : ""}
          {i.detail ? ` · ${i.kind === "email" ? `An: ${i.detail}` : i.detail}` : ""}
        </p>
      </div>
    </li>
  );
}

/**
 * Notes and history of the lead's Pipedrive deal, folded in the customer file. Only shown when the lead has a deal.
 * Managers and admins get the whole feed with filter tabs; callers get notes and stage changes (the server filters).
 */
export function PipedriveStream({ leadId }: { leadId: string }) {
  const check = useServerFn(hasLeadDeal);
  const load = useServerFn(loadLeadStream);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const linked = useQuery({
    queryKey: ["lead-deal", leadId],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => withViewAsRead(() => check({ data: { leadId } })),
  });
  const stream = useQuery({
    enabled: open && !!linked.data?.linked,
    queryKey: ["lead-stream", leadId],
    staleTime: 60_000,
    retry: false,
    queryFn: () => withViewAsRead(() => load({ data: { leadId } })),
  });
  if (!linked.data?.linked) return null;
  const d = stream.data;
  const tabs = (d?.staff ?? linked.data.staff) ? STAFF_TABS : CALLER_TABS;
  const all: Entry[] = d
    ? [
        ...d.notes.map((n) => ({ type: "note" as const, id: `n-${n.id}`, at: n.at, author: n.author, text: n.text })),
        ...d.items.map((item) => ({ type: "item" as const, item })),
      ].sort((a, b) => (b.type === "note" ? b.at : b.item.at).localeCompare(a.type === "note" ? a.at : a.item.at))
    : [];
  const shown = all.filter((e) =>
    tab === "all" ? true : tab === "notes" ? e.type === "note" : e.type === "item" && KIND_TAB[e.item.kind] === tab,
  );
  return (
    <details className="cc-detail-section cc-fold" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-semibold">Notizen &amp; Verlauf (Pipedrive)</summary>
      <div className="space-y-3 pt-3">
        {stream.isLoading && <FeedbackState kind="loading" title="Verlauf wird geladen" />}
        {stream.isError && (
          <FeedbackState
            kind="error"
            title="Verlauf nicht verfügbar"
            action={
              <Button variant="outline" onClick={() => void stream.refetch()}>
                Erneut versuchen
              </Button>
            }
          >
            {stream.error instanceof Error ? stream.error.message : "Bitte versuche es erneut."}
          </FeedbackState>
        )}
        {d && (
          <>
            {d.source === "local" && d.error && (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Pipedrive war nicht erreichbar. Angezeigt werden die im Tool gespeicherten Notizen und Stage-Wechsel.
              </p>
            )}
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Verlauf filtern">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`!min-h-0 rounded-full border px-3 py-1 text-xs font-medium ${tab === key ? "bg-foreground text-background" : "bg-card"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Einträge.</p>
            ) : (
              <ul className="space-y-2">
                {shown.map((e) => (
                  <Row key={e.type === "note" ? e.id : e.item.id} entry={e} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  );
}
