import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type Template = { id: string; name: string; subject?: string; body: string };

const PLACEHOLDERS = "{{firma}} {{ansprechpartner}} {{stadt}} {{caller}}";

function parse(raw: string | null | undefined): Template[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function preview(text: string) {
  return text
    .replace(/{{\s*firma\s*}}/g, "Muster GmbH")
    .replace(/{{\s*ansprechpartner\s*}}/g, "Max Mustermann")
    .replace(/{{\s*stadt\s*}}/g, "Wien")
    .replace(/{{\s*caller\s*}}/g, "Dein Name");
}

export function TemplateManager({
  settingKey,
  title,
  help,
  withSubject,
  defaults,
}: {
  settingKey: string;
  title: string;
  help: string;
  withSubject?: boolean;
  defaults: Template[];
}) {
  const qc = useQueryClient();
  const { data, isSuccess } = useQuery({
    queryKey: ["templates", settingKey],
    queryFn: async () =>
      (await supabase.from("app_settings").select("value").eq("key", settingKey).maybeSingle()).data
        ?.value ?? null,
  });
  const [items, setItems] = useState<Template[]>(defaults);
  const [selected, setSelected] = useState<string | null>(defaults[0]?.id ?? null);

  useEffect(() => {
    if (!isSuccess) return;
    const stored = parse(data);
    const list = stored.length ? stored : defaults;
    setItems(list);
    setSelected((cur) => (cur && list.some((t) => t.id === cur) ? cur : (list[0]?.id ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isSuccess]);

  const current = items.find((t) => t.id === selected) ?? null;

  function patch(change: Partial<Template>) {
    setItems((list) => list.map((t) => (t.id === selected ? { ...t, ...change } : t)));
  }
  function add() {
    const t: Template = { id: crypto.randomUUID(), name: "Neue Vorlage", subject: "", body: "" };
    setItems((list) => [...list, t]);
    setSelected(t.id);
  }
  async function persist(list: Template[], message: string) {
    const { error } = await supabase.from("app_settings").upsert({
      key: settingKey,
      value: JSON.stringify(list),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(message);
    qc.invalidateQueries({ queryKey: ["templates", settingKey] });
  }
  async function remove() {
    if (!current || !confirm(`Vorlage „${current.name}“ löschen?`)) return;
    const list = items.filter((t) => t.id !== current.id);
    setItems(list);
    setSelected(list[0]?.id ?? null);
    await persist(list, "Vorlage gelöscht.");
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {help} Platzhalter: {PLACEHOLDERS}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <div className="space-y-2 rounded-lg border bg-card p-2">
          <Button size="sm" variant="outline" className="w-full" onClick={add}>
            + Neu
          </Button>
          <ul className="space-y-1">
            {items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelected(t.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                    t.id === selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {t.name || "Ohne Namen"}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {current ? (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <Input
              value={current.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Name der Vorlage"
              aria-label="Name der Vorlage"
            />
            {withSubject && (
              <Input
                value={current.subject ?? ""}
                onChange={(e) => patch({ subject: e.target.value })}
                placeholder="Betreff"
                aria-label="Betreff"
              />
            )}
            <Textarea
              rows={withSubject ? 10 : 6}
              value={current.body}
              onChange={(e) => patch({ body: e.target.value })}
              aria-label="Text"
            />
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Vorschau</p>
              {withSubject && current.subject && (
                <p className="font-medium">{preview(current.subject)}</p>
              )}
              <p className="whitespace-pre-wrap">{preview(current.body) || "—"}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => persist(items, "Vorlagen gespeichert.")}>Speichern</Button>
              <Button variant="outline" onClick={remove}>
                Löschen
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Keine Vorlage ausgewählt.</p>
        )}
      </div>
    </section>
  );
}
