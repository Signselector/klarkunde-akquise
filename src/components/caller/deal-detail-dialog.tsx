import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/coldcaller/primitives";
import { loadDealDetail } from "@/lib/deal-detail.functions";
import { withViewAsRead } from "@/lib/view-as";
import type { CustomerDeal } from "@/lib/customer-stages";

const when = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Notes and history of a deal (from Pipedrive, newest first). E-mails are not shown. */
export function DealDetailDialog({
  deal,
  country,
  onClose,
}: {
  deal: CustomerDeal | null;
  country: string;
  onClose: () => void;
}) {
  const load = useServerFn(loadDealDetail);
  const detail = useQuery({
    enabled: !!deal,
    queryKey: ["deal-detail", country, deal?.deal_id],
    staleTime: 60_000,
    retry: false,
    queryFn: () => withViewAsRead(() => load({ data: { country, dealId: deal!.deal_id } })),
  });
  const d = detail.data;
  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="cc-theme max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{deal?.company || "Ohne Firmenname"}</DialogTitle>
          <DialogDescription>
            {[deal?.contact_name, "Notizen und Verlauf des Deals"].filter(Boolean).join(" · ")}
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading && <FeedbackState kind="loading" title="Deal wird geladen" />}
        {detail.isError && (
          <FeedbackState
            kind="error"
            title="Deal nicht verfügbar"
            action={
              <Button variant="outline" onClick={() => void detail.refetch()}>
                Erneut versuchen
              </Button>
            }
          >
            {detail.error instanceof Error ? detail.error.message : "Bitte versuche es erneut."}
          </FeedbackState>
        )}
        {d && (
          <div className="space-y-6">
            {d.source === "local" && d.error && (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Pipedrive war nicht erreichbar. Angezeigt werden die im Tool gespeicherten Notizen
                und Aktivitäten.
              </p>
            )}
            <section aria-labelledby="deal-notes">
              <h3 id="deal-notes" className="mb-2 font-semibold">
                Notizen
              </h3>
              {d.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Notizen.</p>
              ) : (
                <ul className="space-y-2">
                  {d.notes.map((n) => (
                    <li key={n.id} className="rounded-md border bg-card p-3 text-sm">
                      <p className="mb-1 text-xs text-muted-foreground">
                        {when(n.at)}
                        {n.author ? ` · ${n.author}` : ""}
                      </p>
                      <p className="whitespace-pre-wrap">{n.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="deal-history">
              <h3 id="deal-history" className="mb-2 font-semibold">
                Verlauf
              </h3>
              {d.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch kein Verlauf.</p>
              ) : (
                <ul className="cc-history">
                  {d.events.map((e) => (
                    <li key={e.id}>
                      {when(e.at)}: {e.text}
                      {e.by ? ` · ${e.by}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
