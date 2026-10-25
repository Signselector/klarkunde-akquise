import { Mail, Phone } from "@/components/coldcaller/icons";
import { STATUS_LABEL } from "@/lib/leads";
import type { TableLead } from "@/components/caller/leads-table";

const COLUMNS = ["appointment", "production"] as const;

function since(iso: string | null) {
  if (!iso) return "Noch nicht kontaktiert";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return days === 0 ? "heute" : days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

/**
 * Board of own customers. The columns are the local call outcomes, not CRM stages:
 * the real stage read model is not delivered yet.
 */
export function CustomersBoard({
  leads,
  onOpen,
}: {
  leads: TableLead[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {COLUMNS.map((status) => {
        const items = leads.filter((l) => l.status === status);
        return (
          <section
            key={status}
            aria-label={STATUS_LABEL[status]}
            className="rounded-[10px] border bg-muted/40 p-3"
          >
            <h3 className="flex items-center justify-between px-1 pb-3 text-sm font-semibold">
              {STATUS_LABEL[status]}
              <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                {items.length}
              </span>
            </h3>
            {items.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">Keine Kunden</p>
            ) : (
              <ul className="space-y-2">
                {items.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(l.id)}
                      className="cc-card-button w-full space-y-2 rounded-[10px] border bg-card p-3 text-left hover:border-primary focus-visible:outline-2"
                    >
                      <strong className="block break-words">
                        {l.company || "Ohne Firmenname"}
                      </strong>
                      {l.contact_name && <span className="block text-sm">{l.contact_name}</span>}
                      <span className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{since(l.last_called_at)}</span>
                        <span className="flex gap-2">
                          {l.phone && <Phone size={14} aria-label="Telefon vorhanden" />}
                          {l.email && <Mail size={14} aria-label="E-Mail vorhanden" />}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
