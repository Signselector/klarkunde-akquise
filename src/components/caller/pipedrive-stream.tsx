import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Mail,
  Paperclip,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FeedbackState } from "@/components/coldcaller/primitives";
import { hasLeadDeal, loadLeadStream, updateLeadNote } from "@/lib/deal-detail.functions";
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

type NoteEntry = {
  type: "note";
  id: string;
  rawId: string;
  at: string;
  author: string | null;
  text: string;
  editable: boolean;
};
type Entry = NoteEntry | { type: "item"; item: StreamItem };

/** Yellow note card; the pencil opens inline editing when the server says the user may edit this note. */
function NoteCard({
  note,
  onSave,
  saving,
}: {
  note: NoteEntry;
  onSave: (text: string) => Promise<boolean>;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  // Open by default; a click on the header folds the note up to two lines and back.
  const [expanded, setExpanded] = useState(true);
  const long = note.text.length > 120 || note.text.includes("\n");
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="mb-1 flex items-start justify-between gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          disabled={editing}
          onClick={() => setExpanded((v) => !v)}
          className="!min-h-0 flex min-w-0 flex-1 items-center gap-1 text-left text-xs opacity-70 hover:opacity-100"
        >
          {long &&
            (expanded ? (
              <ChevronUp size={14} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} aria-hidden="true" />
            ))}
          <span>
            {when(note.at)}
            {note.author ? ` · ${note.author}` : ""}
          </span>
        </button>
        {note.editable && !editing && (
          <button
            type="button"
            aria-label="Notiz bearbeiten"
            className="!min-h-0 shrink-0 rounded p-1 opacity-70 hover:bg-amber-100 hover:opacity-100"
            onClick={() => {
              setText(note.text);
              setEditing(true);
            }}
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            disabled={saving}
            className="bg-white"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={saving || !text.trim() || text.trim() === note.text}
              onClick={async () => {
                if (await onSave(text)) setEditing(false);
              }}
            >
              {saving ? "Speichert …" : "Speichern"}
            </Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <p className={`whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-2"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}

function Dot({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute -left-[34px] top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background ${tone}`}
    >
      {children}
    </span>
  );
}

function Row({
  entry,
  onSave,
  saving,
}: {
  entry: Entry;
  onSave: (note: NoteEntry, text: string) => Promise<boolean>;
  saving: boolean;
}) {
  if (entry.type === "note")
    return (
      <li className="relative">
        <Dot tone="bg-amber-200 text-amber-900">
          <Pencil size={12} />
        </Dot>
        <NoteCard note={entry} saving={saving} onSave={(t) => onSave(entry, t)} />
      </li>
    );
  const i = entry.item;
  const icon =
    i.kind === "email" ? (
      <Mail size={12} />
    ) : i.kind === "activity" ? (
      i.done ? (
        <Check size={12} />
      ) : (
        <CalendarDays size={12} />
      )
    ) : i.kind === "file" ? (
      <Paperclip size={12} />
    ) : (
      <ArrowRight size={12} />
    );
  return (
    <li className="relative rounded-md border bg-card p-3 text-sm">
      <Dot tone="bg-muted text-muted-foreground">{icon}</Dot>
      <p className="break-words font-medium">
        {i.kind === "activity" && i.activity ? (
          <span className="font-normal text-muted-foreground">{i.activity}: </span>
        ) : null}
        {i.text}
        {i.state && (
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
            {i.state}
          </span>
        )}
        {i.kind === "activity" && i.done && (
          <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-800">
            ERLEDIGT
          </span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {when(i.at)}
        {i.by ? ` · ${i.by}` : ""}
        {i.detail ? ` · ${i.kind === "email" ? `An: ${i.detail}` : i.detail}` : ""}
      </p>
      {i.preview && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{i.preview}</p>}
    </li>
  );
}

/**
 * Notes and history of the lead's Pipedrive deal, folded in the customer file. Only shown when the lead has a deal.
 * Managers and admins get the whole feed with filter tabs; callers get notes and stage changes (the server filters).
 */
export function PipedriveStream({
  leadId,
  defaultOpen = false,
}: {
  leadId: string;
  defaultOpen?: boolean;
}) {
  const check = useServerFn(hasLeadDeal);
  const load = useServerFn(loadLeadStream);
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<Tab>("all");
  const linked = useQuery({
    queryKey: ["lead-deal", leadId],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => withViewAsRead(() => check({ data: { leadId } })),
  });
  const qc = useQueryClient();
  const save = useServerFn(updateLeadNote);
  const edit = useMutation({
    mutationFn: (v: { noteId: string; source: "pipedrive" | "local"; content: string }) =>
      save({ data: { leadId, ...v } }),
  });
  const stream = useQuery({
    enabled: open && !!linked.data?.allowed,
    queryKey: ["lead-stream", leadId],
    staleTime: 60_000,
    retry: false,
    queryFn: () => withViewAsRead(() => load({ data: { leadId } })),
  });
  // Without a Pipedrive deal the section shows the tool's own call notes ("Gesprächsnotizen"), editable later on.
  const isLinked = !!linked.data?.linked;
  if (!linked.data?.allowed) return null;
  const d = stream.data;
  // An unlinked lead without call notes shows no notes section at all.
  if (!isLinked && (!d || d.notes.length + d.items.length === 0)) return null;
  const tabs = (d?.staff ?? linked.data.staff) ? STAFF_TABS : CALLER_TABS;
  const all: Entry[] = d
    ? [
        ...d.notes.map((n) => ({
          type: "note" as const,
          id: `n-${n.id}`,
          rawId: n.id,
          at: n.at,
          author: n.author,
          text: n.text,
          editable: !!n.editable,
        })),
        ...d.items.map((item) => ({ type: "item" as const, item })),
      ].sort((a, b) =>
        (b.type === "note" ? b.at : b.item.at).localeCompare(a.type === "note" ? a.at : a.item.at),
      )
    : [];
  const count = (t: Tab) =>
    all.filter((e) =>
      t === "notes" ? e.type === "note" : e.type === "item" && KIND_TAB[e.item.kind] === t,
    ).length;
  const shown = all.filter((e) =>
    tab === "all"
      ? true
      : tab === "notes"
        ? e.type === "note"
        : e.type === "item" && KIND_TAB[e.item.kind] === tab,
  );
  const onSave = async (note: NoteEntry, text: string) => {
    try {
      const r = await edit.mutateAsync({
        noteId: note.rawId,
        source: d?.source ?? "pipedrive",
        content: text,
      });
      toast.success(
        r.pipedrive === "synced"
          ? "Notiz gespeichert und in Pipedrive aktualisiert."
          : r.pipedrive === "simulated"
            ? "Notiz gespeichert (Testmodus, nicht an Pipedrive gesendet)."
            : r.pipedrive === "error"
              ? "Notiz im Tool gespeichert, die Änderung in Pipedrive ist fehlgeschlagen."
              : "Notiz gespeichert.",
      );
      void qc.invalidateQueries({ queryKey: ["lead-stream", leadId] });
      void qc.invalidateQueries({ queryKey: ["lead-detail", leadId] });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Die Notiz konnte nicht gespeichert werden.");
      return false;
    }
  };
  const label = (key: Tab, text: string) =>
    d && (key === "notes" || key === "activity" || key === "email" || key === "file")
      ? `${text} (${count(key)})`
      : text;
  return (
    <details
      className="cc-detail-section cc-fold"
      open={defaultOpen || undefined}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer font-semibold">
        {isLinked
          ? d
            ? `Notizen & Verlauf (Pipedrive) · ${all.length}`
            : "Notizen & Verlauf (Pipedrive)"
          : d
            ? `Gesprächsnotizen · ${all.length}`
            : "Gesprächsnotizen"}
      </summary>
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
            {isLinked && d.source === "local" && d.error && (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Pipedrive war nicht erreichbar. Angezeigt werden die im Tool gespeicherten Notizen
                und Stage-Wechsel.
              </p>
            )}
            {isLinked && (
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Verlauf filtern">
                {tabs.map(([key, text]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={`!min-h-0 rounded-full border px-3 py-1 text-xs font-medium ${tab === key ? "bg-foreground text-background" : "bg-card"}`}
                  >
                    {label(key, text)}
                  </button>
                ))}
              </div>
            )}
            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {isLinked ? "Keine Einträge." : "Noch keine Gesprächsnotizen."}
              </p>
            ) : (
              <ul className="ml-3 space-y-2 border-l-2 pl-8">
                {shown.map((e) => (
                  <Row
                    key={e.type === "note" ? e.id : e.item.id}
                    entry={e}
                    onSave={onSave}
                    saving={edit.isPending}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  );
}
