import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const COUNTRIES = [
  { code: "DE", label: "Deutschland", flag: "🇩🇪" },
  { code: "AT", label: "Österreich", flag: "🇦🇹" },
  { code: "NL", label: "Niederlande", flag: "🇳🇱" },
] as const;
export type Country = (typeof COUNTRIES)[number]["code"];

const KEY = "cc-country";
let current: Country = "DE";
const listeners = new Set<() => void>();

export function isCountry(v: unknown): v is Country {
  return COUNTRIES.some((c) => c.code === v);
}

export function setCountry(c: Country) {
  current = c;
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Countries the signed-in user may open (master admin: all). */
export function useAllowedCountries() {
  return useQuery({
    queryKey: ["my-countries"],
    queryFn: async () => {
      const { data } = await supabase.rpc("my_countries");
      return ((data as string[] | null) ?? []).filter(isCountry);
    },
  });
}

/** Active country; remembers the last choice per browser. */
export function useCountry(): Country {
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (isCountry(saved) && saved !== current) setCountry(saved);
  }, []);
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
    () => "DE" as Country,
  );
}

export function CountrySwitcher() {
  const country = useCountry();
  const { data: allowed } = useAllowedCountries();
  useEffect(() => {
    if (allowed?.length && !allowed.includes(country)) setCountry(allowed[0]!);
  }, [allowed, country]);
  if (!allowed) return null;
  if (allowed.length === 0)
    return <span className="text-xs text-muted-foreground">Kein Land freigeschaltet</span>;
  return (
    <div
      role="radiogroup"
      aria-label="Land wählen"
      className="flex rounded-md border bg-background p-0.5"
    >
      {COUNTRIES.filter((c) => allowed.includes(c.code)).map((c) => (
        <button
          key={c.code}
          type="button"
          role="radio"
          aria-checked={country === c.code}
          title={c.label}
          onClick={() => setCountry(c.code)}
          className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
            country === c.code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <span aria-hidden="true">{c.flag}</span> {c.code}
        </button>
      ))}
    </div>
  );
}
