import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getExternalApiKey } from "@/lib/external-api.functions";
import { API_TABLES } from "@/lib/external-api-auth";

const BASE = "https://cold-caller-tool-neu.lovable.app/api/public/v1";

export function ApiAccess() {
  const [show, setShow] = useState(false);
  const { data, error, isLoading } = useQuery({
    queryKey: ["external-api-key"],
    queryFn: () => getExternalApiKey(),
  });
  const key = data?.key ?? "";
  async function copy(text: string, msg: string) {
    await navigator.clipboard.writeText(text);
    toast.success(msg);
  }
  const example = `const res = await fetch("${BASE}/leads?limit=50", {
  headers: { "x-api-key": "DEIN_API_KEY" },
});
const { data } = await res.json();`;

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h3 className="font-medium">API-Schlüssel</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Wird geladen …</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm">
              {show ? key : "•".repeat(32)}
            </code>
            <Button variant="outline" size="icon" onClick={() => setShow((s) => !s)} aria-label="Anzeigen">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button onClick={() => copy(key, "API-Schlüssel kopiert.")}>
              <Copy className="mr-2 h-4 w-4" /> Kopieren
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Wer diesen Schlüssel hat, kann alle unten genannten Daten lesen, anlegen, ändern und löschen. Nicht weitergeben.
        </p>
      </section>

      <section className="space-y-2 rounded-lg border bg-card p-4 text-sm">
        <h3 className="font-medium">So verwendest du die API</h3>
        <p>
          Basis-Adresse: <code className="font-mono">{BASE}</code> · Header <code className="font-mono">x-api-key</code>
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><code className="font-mono">GET /ping</code> – Verbindung testen</li>
          <li><code className="font-mono">GET /&lt;tabelle&gt;?feld=wert&amp;limit=100&amp;offset=0&amp;order=created_at.desc</code> – lesen</li>
          <li><code className="font-mono">POST /&lt;tabelle&gt;</code> – Eintrag oder Liste anlegen (JSON)</li>
          <li><code className="font-mono">PATCH /&lt;tabelle&gt;?id=…</code> – ändern</li>
          <li><code className="font-mono">DELETE /&lt;tabelle&gt;?id=…</code> – löschen</li>
        </ul>
        <p>Tabellen: {API_TABLES.join(", ")}</p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{example}</pre>
          <Button size="sm" variant="outline" className="absolute right-2 top-2" onClick={() => copy(example, "Beispiel kopiert.")}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </section>
    </div>
  );
}
