import { describe, expect, it } from "vitest";
import { emailErrorMessage } from "@/lib/lead-email";

describe("emailErrorMessage", () => {
  it("shows the exact mail server reply for a missing mailbox", () => {
    const m = emailErrorMessage("smtp:550:5.1.1 Recipient address rejected");
    expect(m).toContain("existiert nicht");
    expect(m).toContain("550 5.1.1 Recipient address rejected");
  });
  it("explains a too large mail", () => {
    expect(emailErrorMessage("smtp:552:Message size exceeds limit")).toContain("zu groß");
  });
  it("keeps the known messages", () => {
    expect(emailErrorMessage("send_failed")).toContain("nicht gesendet");
  });
});
