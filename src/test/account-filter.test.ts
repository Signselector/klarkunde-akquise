import { describe, expect, it } from "vitest";
import { filterAccounts } from "@/lib/account-filter";

const users = [
  { display_name: "Anna Weber", email: "anna@x.de", role: "recruit", countries: ["DE"] },
  { display_name: "Ben Maier", email: "ben@x.at", role: "veteran", countries: ["AT", "DE"] },
  { display_name: "Chris", email: "chris@x.nl", role: "manager", countries: [] },
];
const all = { search: "", country: "all", role: "all" };

describe("filterAccounts", () => {
  it("searches name and e-mail, ignoring case", () => {
    expect(filterAccounts(users, { ...all, search: "WEBER" }).map((u) => u.display_name)).toEqual(["Anna Weber"]);
    expect(filterAccounts(users, { ...all, search: "x.at" }).map((u) => u.display_name)).toEqual(["Ben Maier"]);
  });
  it("filters by country, including accounts without one", () => {
    expect(filterAccounts(users, { ...all, country: "DE" })).toHaveLength(2);
    expect(filterAccounts(users, { ...all, country: "AT" })).toHaveLength(1);
    expect(filterAccounts(users, { ...all, country: "none" }).map((u) => u.display_name)).toEqual(["Chris"]);
  });
  it("filters by role and combines all three", () => {
    expect(filterAccounts(users, { ...all, role: "manager" })).toHaveLength(1);
    expect(filterAccounts(users, { search: "ben", country: "DE", role: "veteran" })).toHaveLength(1);
    expect(filterAccounts(users, { search: "ben", country: "NL", role: "all" })).toHaveLength(0);
  });
});
