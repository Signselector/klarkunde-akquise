import { Mail, MapPin, Pencil, Phone } from "@/components/coldcaller/icons";
import { ACTION_ICON } from "@/components/caller/action-icons";
import { LEAD_ACTIONS, OUTCOME_TONES, type LeadActionKey } from "@/lib/lead-actions";
import { parseLeadLinks } from "@/components/coldcaller/workspace-parts";
import { StatusBadge } from "@/components/coldcaller/primitives";
import type { Tone } from "@/components/coldcaller/primitives";
import { STATUS_LABEL } from "@/lib/leads";
import type { Json } from "@/integrations/supabase/types";

/** What the caller wants to do when the customer file opens: record a result, or correct the customer data. */
export type LeadIntent = { action?: LeadActionKey; edit?: boolean };

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
  const row = "flex min-w-0 items-center gap-2 text-sm leading-5";
  return (
    <div className="flex min-w-[11rem] max-w-[18rem] flex-col gap-1.5">
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
      {lead.email && (
        <a
          className={`${row} text-primary hover:underline`}
          href={`mailto:${lead.email}`}
          title={lead.email}
          onClick={(e) => e.stopPropagation()}
        >
          <Mail size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{lead.email}</span>
        </a>
      )}
    </div>
  );
}

/** Website of the company as a link that opens in a new tab; a quiet placeholder when there is none. */
function WebsiteLink({ lead }: { lead: TableLead }) {
  const { websiteUrl } = parseLeadLinks(lead.extra as Record<string, unknown>, lead.city);
  const site = websiteUrl?.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  const row = "inline-flex max-w-[14rem] min-w-0 items-center gap-1.5 text-sm leading-5";
  if (!websiteUrl)
    return (
      <span className={`${row} text-muted-foreground`}>
        <span className="opacity-50">
          <GlobeIcon />
        </span>
        Keine Website
      </span>
    );
  return (
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
  );
}

function Address({ lead }: { lead: TableLead }) {
  const { addressText, mapsUrl } = parseLeadLinks(lead.extra as Record<string, unknown>, lead.city);
  if (!addressText || !mapsUrl) return <span className="text-muted-foreground">–</span>;
  return (
    <a
      className="inline-flex items-center gap-1 text-primary hover:underline"
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

/** The result buttons and "Daten bearbeiten" below a lead; a click opens the customer file at that step. */
function QuickActions({ lead, onOpen }: { lead: TableLead; onOpen: (id: string, intent?: LeadIntent) => void }) {
  const go = (e: React.MouseEvent, intent: LeadIntent) => {
    e.stopPropagation();
    onOpen(lead.id, intent);
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Ergebnis für ${lead.company || "Ohne Firmenname"}`}>
      {LEAD_ACTIONS.map((a, position) => {
        const Icon = ACTION_ICON[a.key];
        return (
          <button
            key={a.key}
            type="button"
            className={`cc-outcome-btn cc-outcome-btn--compact cc-outcome-btn--${OUTCOME_TONES[position] ?? "slate"}`}
            onClick={(e) => go(e, { action: a.key })}
          >
            {Icon ? <Icon size={16} aria-hidden="true" /> : null}
            <span>{a.label}</span>
          </button>
        );
      })}
      <button type="button" className="cc-outcome-btn cc-outcome-btn--compact" onClick={(e) => go(e, { edit: true })}>
        <Pencil size={16} aria-hidden="true" />
        <span>Daten bearbeiten</span>
      </button>
    </div>
  );
}

/**
 * Lead table for the caller pages. `processed` swaps the status column for the
 * recorded result plus the last-processed time (completed leads).
 */
export function LeadsTable({
  leads,
  onOpen,
  resultLabel,
  processed = false,
  quickActions = false,
}: {
  leads: TableLead[];
  onOpen: (id: string, intent?: LeadIntent) => void;
  resultLabel?: (lead: TableLead) => string;
  processed?: boolean;
  /** Result buttons and "Daten bearbeiten" below every lead (Offene Leads). */
  quickActions?: boolean;
}) {
  const label = (l: TableLead) => resultLabel?.(l) ?? STATUS_LABEL[l.status] ?? l.status;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-max whitespace-nowrap text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Firma</th>
              <th className="px-2 py-3 font-medium">Kontakt</th>
              <th className="px-2 py-3 font-medium">Website</th>
              <th className="px-2 py-3 font-medium">Stadt</th>
              <th className="px-2 py-3 font-medium">Adresse</th>
              <th className="px-2 py-3 text-center font-medium">
                {processed ? "Ergebnis" : "Status"}
              </th>
              {processed && <th className="px-2 py-3 font-medium">Bearbeitet</th>}
            </tr>
          </thead>
          <>
            {leads.map((l) => (
              <tbody key={l.id} className="cc-lead-group select-none border-t first:border-t-0">
              <tr
                className="cc-row-link align-top"
                onClick={() => onOpen(l.id)}
              >
                <td className="px-4 py-4 font-medium">{l.company || "Ohne Firmenname"}</td>
                <td className="px-2 py-4">
                  <ContactLinks lead={l} />
                </td>
                <td className="px-2 py-4">
                  <WebsiteLink lead={l} />
                </td>
                <td className="px-2 py-4">{l.city || "–"}</td>
                <td className="px-2 py-4">
                  <Address lead={l} />
                </td>
                <td className="min-w-[10rem] px-4 py-4">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <StatusBadge tone={leadTone(l.status)}>{label(l)}</StatusBadge>
                    {l.attempts > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {l.attempts} {l.attempts === 1 ? "Versuch" : "Versuche"}
                      </span>
                    )}
                    {!quickActions && (
                      <button
                        type="button"
                        className="cc-record-btn"
                        onClick={() => onOpen(l.id)}
                        aria-label={`Kundenakte ${l.company || "Ohne Firmenname"} öffnen`}
                      >
                        Kundenakte
                      </button>
                    )}
                  </div>
                </td>
                {processed && (
                  <td className="whitespace-nowrap px-2 py-4 text-muted-foreground">
                    {l.last_called_at ? dateFormat.format(new Date(l.last_called_at)) : "–"}
                  </td>
                )}
              </tr>
              {quickActions && (
                <tr className="cc-row-link" onClick={() => onOpen(l.id)}>
                  <td colSpan={processed ? 7 : 6} className="px-4 pb-4 pt-0 whitespace-normal">
                    {/* Zero width, full minimum width: the buttons wrap inside the table instead of widening it. */}
                    <div className="w-0 min-w-full">
                      <QuickActions lead={l} onOpen={onOpen} />
                    </div>
                  </td>
                </tr>
              )}
              </tbody>
            ))}
          </>
        </table>
      </div>
      <ul className="divide-y md:hidden">
        {leads.map((l) => (
          <li key={l.id} className="cc-row-link space-y-2 px-4 py-4" onClick={() => onOpen(l.id)}>
            <div className="flex items-start justify-between gap-3">
              <strong className="min-w-0 break-words">{l.company || "Ohne Firmenname"}</strong>
              <StatusBadge tone={leadTone(l.status)}>{label(l)}</StatusBadge>
            </div>
            <ContactLinks lead={l} />
            <WebsiteLink lead={l} />
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
            {!quickActions && (
              <button
                type="button"
                className="cc-record-btn"
                onClick={() => onOpen(l.id)}
                aria-label={`Kundenakte ${l.company || "Ohne Firmenname"} öffnen`}
              >
                Kundenakte
              </button>
            )}
            {quickActions && <QuickActions lead={l} onOpen={onOpen} />}
          </li>
        ))}
      </ul>
    </>
  );
}
