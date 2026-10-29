import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAuditLocation } from "@/lib/external-api.functions";

export function AuditLocationDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    enabled: !!id,
    queryKey: ["audit-location", id],
    queryFn: () => getAuditLocation({ data: { id: id! } }),
  });
  const g = q.data?.geo;
  const place = g ? [g.city, g.region, g.country].filter(Boolean).join(", ") : null;
  const d = 0.08;
  const map =
    g?.lat != null && g?.lon != null
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${g.lon - d},${g.lat - d},${g.lon + d},${g.lat + d}&layer=mapnik&marker=${g.lat},${g.lon}`
      : null;
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Herkunft der Aktion</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Wird geladen …</p>
        ) : q.isError ? (
          <p className="text-sm text-destructive">Konnte nicht geladen werden.</p>
        ) : !q.data?.ip ? (
          <p className="text-sm text-muted-foreground">
            Für diesen Eintrag wurde keine IP-Adresse gespeichert (Einträge vor Einführung dieser Funktion oder automatische Systemaktionen).
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">IP-Adresse</dt><dd className="font-mono">{q.data.ip}</dd>
              <dt className="text-muted-foreground">Ort</dt><dd>{place || "Unbekannt"}</dd>
              {g?.isp && (<><dt className="text-muted-foreground">Anbieter</dt><dd>{g.isp}</dd></>)}
              {q.data.userAgent && (<><dt className="text-muted-foreground">Gerät</dt><dd className="break-words text-xs">{q.data.userAgent}</dd></>)}
            </dl>
            {map && <iframe title="Karte" src={map} className="h-64 w-full rounded-md border" />}
            <p className="text-xs text-muted-foreground">Der Ort wird aus der IP-Adresse geschätzt und ist ungefähr.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
