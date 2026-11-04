import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { broadcastCelebration } from "@/lib/celebration.server";

describe("broadcastCelebration", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env["SUPABASE_URL"] = "https://x.supabase.co";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service";
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends only the kind of event to the private channel of that country", async () => {
    expect(await broadcastCelebration("AT", "high_q")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://x.supabase.co/realtime/v1/api/broadcast");
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { topic: "celebrations-AT", event: "celebrate", payload: { type: "high_q" }, private: true },
    ]);
  });

  it("refuses unknown countries and announces the same event only once", async () => {
    expect(await broadcastCelebration("XX", "won")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await broadcastCelebration("DE", "won", "won:DE:1")).toBe(true);
    expect(await broadcastCelebration("DE", "won", "won:DE:1")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws when the broadcast fails", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    expect(await broadcastCelebration("NL", "low_q")).toBe(false);
  });
});
