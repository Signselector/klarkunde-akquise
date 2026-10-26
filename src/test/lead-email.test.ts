import { describe, expect, it } from "vitest";
import {
  deliverEmail,
  emailErrorMessage,
  isValidEmail,
  type MailRow,
  type MailStore,
} from "@/lib/lead-email";

const row = (over: Partial<MailRow> = {}): MailRow => ({
  id: "e1",
  to_email: "k@x.test",
  subject: "S",
  body: "B",
  status: "pending",
  attempts: 0,
  ...over,
});
function store(initial: MailRow) {
  const log: string[] = [];
  const s: MailStore = {
    claim: async () =>
      initial.status === "pending" || initial.status === "failed" ? initial : null,
    finish: async (_id, r) => void log.push(`${r.status}:${r.messageId ?? r.error ?? ""}`),
  };
  return { s, log };
}

describe("deliverEmail", () => {
  it("test mode simulates and never calls a provider", async () => {
    const { s, log } = store(row());
    let called = false;
    const r = await deliverEmail(
      row(),
      {
        testMode: true,
        provider: { name: "p", send: async () => ((called = true), { messageId: "m" }) },
      },
      s,
    );
    expect(r.status).toBe("simulated");
    expect(called).toBe(false);
    expect(log).toEqual(["simulated:"]);
  });
  it("marks an e-mail as sent only with a provider confirmation", async () => {
    const { s, log } = store(row());
    const r = await deliverEmail(
      row(),
      { testMode: false, provider: { name: "p", send: async () => ({ messageId: "msg-1" }) } },
      s,
    );
    expect(r.status).toBe("sent");
    expect(log).toEqual(["sent:msg-1"]);
    const none = store(row());
    const r2 = await deliverEmail(
      row(),
      { testMode: false, provider: { name: "p", send: async () => ({ messageId: "" }) } },
      none.s,
    );
    expect(r2).toEqual({ status: "failed", error: "no_confirmation" });
  });
  it("fails visibly when no provider is configured or sending throws", async () => {
    const a = store(row());
    expect(await deliverEmail(row(), { testMode: false, provider: null }, a.s)).toEqual({
      status: "failed",
      error: "email_provider_not_configured",
    });
    const b = store(row());
    const r = await deliverEmail(
      row(),
      {
        testMode: false,
        provider: {
          name: "p",
          send: async () => {
            throw new Error("boom!");
          },
        },
      },
      b.s,
    );
    expect(r).toEqual({ status: "failed", error: "send_failed" });
    expect(emailErrorMessage("email_provider_not_configured")).toContain("nicht abgeschlossen");
  });
  it("a retry after a failure sends again, a final mail is never sent twice", async () => {
    let sends = 0;
    const provider = { name: "p", send: async () => (sends++, { messageId: "m" + sends }) };
    const failed = row({ status: "failed" });
    expect(
      (await deliverEmail(failed, { testMode: false, provider }, store(failed).s)).status,
    ).toBe("sent");
    const sent = row({ status: "sent" });
    await deliverEmail(sent, { testMode: false, provider }, store(sent).s);
    const sending = row({ status: "sending" });
    expect(
      (await deliverEmail(sending, { testMode: false, provider }, store(sending).s)).status,
    ).toBe("sending");
    expect(sends).toBe(1);
  });
  it("validates addresses", () => {
    expect(isValidEmail("a@b.de")).toBe(true);
    expect(isValidEmail("kaputt")).toBe(false);
    expect(isValidEmail("a b@c.de")).toBe(false);
  });
});
