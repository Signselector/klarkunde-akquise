import { Mail, MapPin, Phone } from "@/components/coldcaller/icons";
import { parseLeadLinks } from "@/components/coldcaller/workspace-parts";
import { StatusBadge } from "@/components/coldcaller/primitives";
import type { Tone } from "@/components/coldcaller/primitives";
import { STATUS_LABEL } from "@/lib/leads";
import type { Json } from "@/integrations/supabase/types";

export type TableLead = {
  id: string;
  company: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  extra: Json;
  status: string;
  attempts: number;
  last_called_at: string | null;
};

export function leadTone(status: string): Tone {
  return status === "production"
    ? "success"
    : status === "callback"
      ? "warning"
      : status === "no_interest"
        ? "neutral"
        : "info";
}

function GlobeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

/** Name, phone and website stacked with even spacing; each stays on one line and is shortened with … if needed. */
function ContactLinks({ lead }: { lead: TableLead }) {
  const { websiteUrl } = parseLeadLinks(lead.extra as Record<string, unknown>, lead.city);
  const site = websiteUrl?.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  const row = "flex min-w-0 items-center gap-2 text-sm leading-5";
  return (
    <div className="flex min-w-[13rem] max-w-[18rem] flex-col gap-1.5">
      {lead.contact_name && <p className={`${row} truncate`}>{lead.contact_name}</p>}
      {lead.phone ? (
        <a
          className={`${row} text-primary hover:underline`}
          href={`tel:${lead.phone}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Phone size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{lead.phone}</span>
        </a>
      ) : (
        <span className={`${row} text-muted-foreground`}>Keine Nummer</span>
      )}
      {websiteUrl && (
        <a
          className={`${row} text-primary hover:underline`}
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={websiteUrl}
          aria-label={`Website von ${lead.company ?? "Kontakt"} öffnen`}
          onClick={(e) => e.stopPropagation()}
        >
          <GlobeIcon />
          <span className="truncate">{site}</span>
        </a>
      )}
    </div>
  );
}

function EmailLink({ lead }: { lead: TableLead }) {
  if (!lead.email) return <span className="text-muted-foreground">-</span>;
  return (
    <a
      className="text-primary hover:underline"
      href={`mailto:${lead.email}`}
      onClick={(e) => e.stopPropagation()}
    >
      {lead.email}
    </a>
  );
}

function Address({ lead }: { lead: TableLead }) {
  const { addressText, mapsUrl } = parseLeadLinks(lead.extra as Record<string, unknown>, lead.city);
  if (!addressText || !mapsUrl) return <span className="text-muted-foreground">–</span>;
  return (
    <a
      className="inline-flex items-start gap-1 text-primary hover:underline"
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      <MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      {addressText}
    </a>
  );
}

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });

/**
 * Lead table for the caller pages. `processed` swaps the status column for the
 * recorded result plus the last-processed time (completed leads).
 */
export function LeadsTable({
  leads,
  onOpen,
  resultLabel,
  processed = false,
}: {
  leads: TableLead[];
  onOpen: (id: string) => void;
  resultLabel?: (lead: TableLead) => string;
  processed?: boolean;
}) {
  const label = (l: TableLead) => resultLabel?.(l) ?? STATUS_LABEL[l.status] ?? l.status;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-6 py-3 font-medium">Firma</th>
              <th className="px-3 py-3 font-medium">Kontakt</th>
              <th className="px-3 py-3 font-medium">E-Mail</th>
              <th className="px-3 py-3 font-medium">Stadt</th>
              <th className="px-3 py-3 font-medium">Adresse</th>
              <th className="px-3 py-3 font-medium">{processed ? "Ergebnis" : "Status"}</th>
              {processed && <th className="px-3 py-3 font-medium">Bearbeitet</th>}
              <th className="px-6 py-3 text-right font-medium">
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.map((l) => (
              <tr key={l.id} className="align-top hover:bg-muted/40">
                <td className="px-6 py-4 font-medium">{l.company || "Ohne Firmenname"}</td>
                <td className="px-3 py-4">
                  <ContactLinks lead={l} />
                </td>
                <td className="px-3 py-4 break-all">
                  <EmailLink lead={l} />
                </td>
                <td className="px-3 py-4">{l.city || "–"}</td>
                <td className="px-3 py-4">
                  <Address lead={l} />
                </td>
                <td className="px-3 py-4">
                  <StatusBadge tone={leadTone(l.status)}>{label(l)}</StatusBadge>
                  {l.attempts > 0 && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {l.attempts} {l.attempts === 1 ? "Versuch" : "Versuche"}
                    </span>
                  )}
                </td>
                {processed && (
                  <td className="whitespace-nowrap px-3 py-4 text-muted-foreground">
                    {l.last_called_at ? dateFormat.format(new Date(l.last_called_at)) : "–"}
                  </td>
                )}
                <td className="px-6 py-4 text-right">
                  <button
                    type="button"
                    className="rounded-[10px] border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-2"
                    onClick={() => onOpen(l.id)}
                    aria-label={`Kundenakte ${l.company || "Ohne Firmenname"} öffnen`}
                  >
                    Kundenakte
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y md:hidden">
        {leads.map((l) => (
          <li key={l.id} className="space-y-2 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <strong className="min-w-0 break-words">{l.company || "Ohne Firmenname"}</strong>
              <StatusBadge tone={leadTone(l.status)}>{label(l)}</StatusBadge>
            </div>
            <ContactLinks lead={l} />
            <p className="text-sm break-all">
              <span className="text-muted-foreground">E-Mail: </span>
              <EmailLink lead={l} />
            </p>
            {(l.city || l.last_called_at) && (
              <p className="text-sm text-muted-foreground">
                {[
                  l.city,
                  processed && l.last_called_at && dateFormat.format(new Date(l.last_called_at)),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <Address lead={l} />
            <button
              type="button"
              className="rounded-[10px] border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-2"
              onClick={() => onOpen(l.id)}
              aria-label={`Kundenakte ${l.company || "Ohne Firmenname"} öffnen`}
            >
              Kundenakte
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
