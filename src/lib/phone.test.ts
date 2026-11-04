import { describe, expect, it } from "vitest";
import { toE164 } from "./phone";

describe("toE164", () => {
  it("AT local", () => expect(toE164("0670 123 4567", "AT")).toBe("+436701234567"));
  it("DE local", () => expect(toE164("089/123456", "DE")).toBe("+4989123456"));
  it("NL local", () => expect(toE164("06-12345678", "NL")).toBe("+31612345678"));
  it("00 prefix", () => expect(toE164("0049 170 1234567", "AT")).toBe("+491701234567"));
  it("keeps +", () => expect(toE164("+43 (0) 670 1234567", "DE")).toBe("+436701234567"));
  it("empty/invalid", () => {
    expect(toE164("", "AT")).toBeNull();
    expect(toE164("abc", "AT")).toBeNull();
    expect(toE164(null, "AT")).toBeNull();
  });
});
