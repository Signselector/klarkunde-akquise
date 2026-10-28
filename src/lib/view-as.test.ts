import { describe, expect, it } from "vitest";
import { allowedWhileViewing } from "@/lib/view-as";

const base = "https://x.supabase.co";
describe("allowedWhileViewing", () => {
  it("lets reads through", () => {
    expect(allowedWhileViewing("GET", `${base}/rest/v1/leads?select=*`)).toBe(true);
    expect(allowedWhileViewing("POST", `${base}/rest/v1/rpc/get_caller_day`)).toBe(true);
    expect(allowedWhileViewing("POST", `${base}/rest/v1/rpc/heartbeat`)).toBe(true);
  });
  it("refuses writes", () => {
    expect(allowedWhileViewing("POST", `${base}/rest/v1/rpc/record_lead_action`)).toBe(false);
    expect(allowedWhileViewing("POST", `${base}/rest/v1/rpc/claim_next_lead`)).toBe(false);
    expect(allowedWhileViewing("PATCH", `${base}/rest/v1/leads?id=eq.1`)).toBe(false);
    expect(allowedWhileViewing("POST", `${base}/rest/v1/callbacks`)).toBe(false);
    expect(allowedWhileViewing("DELETE", `${base}/rest/v1/callbacks?id=eq.1`)).toBe(false);
  });
  it("keeps sign-out working", () => {
    expect(allowedWhileViewing("POST", `${base}/auth/v1/logout`)).toBe(true);
  });
});
