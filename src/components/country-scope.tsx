import { useEffect, useState } from "react";
import { COUNTRIES, useAllowedCountries, useCountry } from "@/lib/country";
import { useRoles } from "@/lib/use-admin";
import { isMasterEmail } from "@/lib/master";
import { Flag } from "@/components/flag";
import { cn } from "@/lib/utils";

export type ListScope = "ALL" | (typeof COUNTRIES)[number]["code"];

/**
 * Country of an admin list. Managers always see the country they work in. Global admins choose a country or
 * "Alle Länder". `bar` is the selector (null for managers).
 */
export function useListScope(userId: string, email: string | null | undefined) {
  const roles = useRoles(userId);
  const active = useCountry();
  const globalAdmin = roles.isGlobalAdmin || isMasterEmail(email);
  const [pick, setPick] = useState<ListScope | null>(null);
  const allowed = useAllowedCountries();
  const scope: ListScope = globalAdmin ? (pick ?? active) : active;
  useEffect(() => {
    // Managers follow the country switcher; an admin's choice stays until changed.
    if (!globalAdmin) setPick(null);
  }, [globalAdmin, active]);
  const options: { code: ListScope; label: string }[] = [
    ...COUNTRIES.filter((c) => (allowed.data ?? []).includes(c.code)).map((c) => ({ code: c.code, label: c.code })),
    { code: "ALL", label: "Alle Länder" },
  ];
  const bar = globalAdmin ? (
    <div role="tablist" aria-label="Land wählen" className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.code}
          type="button"
          role="tab"
          aria-selected={scope === o.code}
          onClick={() => setPick(o.code)}
          className={cn(
            "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm",
            scope === o.code ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted",
          )}
        >
          {o.code === "ALL" ? <span aria-hidden="true">🌐</span> : <Flag code={o.code} size={20} />} {o.label}
        </button>
      ))}
    </div>
  ) : null;
  return { scope, bar, isStaff: roles.isStaff || globalAdmin, showCountryColumn: scope === "ALL" };
}

export function CountryCell({ code }: { code: string | null | undefined }) {
  if (!code) return <span>–</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Flag code={code} size={18} /> {code}
    </span>
  );
}
