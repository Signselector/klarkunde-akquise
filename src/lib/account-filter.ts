export type AccountFilter = { search: string; country: string; role: string };
type Filterable = { display_name: string | null; email: string | null; role: string; countries: string[] };

/** Accounts page: search in name and e-mail, narrowed by one country ("none" = no country yet) and one role. */
export function filterAccounts<T extends Filterable>(users: T[], f: AccountFilter): T[] {
  const term = f.search.trim().toLocaleLowerCase();
  return users.filter(
    (u) =>
      (!term || `${u.display_name ?? ""} ${u.email ?? ""}`.toLocaleLowerCase().includes(term)) &&
      (f.country === "all" || (f.country === "none" ? u.countries.length === 0 : u.countries.includes(f.country))) &&
      (f.role === "all" || u.role === f.role),
  );
}
