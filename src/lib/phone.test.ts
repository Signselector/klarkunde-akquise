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

import { isPhoneQuery, normalizePhoneDigits, phoneDbPatterns, phoneSearchMatches, searchMatches } from "./phone";

describe("normalizePhoneDigits", () => {
  it("gives the same digits for every way of writing a number", () => {
    for (const v of ["+49 8161 6097754", "0049 8161 6097754", "08161/6097754", "08161 6097754", "+49 (0) 8161-6097754", "081616097754"])
      expect(normalizePhoneDigits(v)).toBe("81616097754");
  });
  it("handles Austria and the Netherlands", () => {
    expect(normalizePhoneDigits("+43 670 1234567")).toBe("6701234567");
    expect(normalizePhoneDigits("0043 670 1234567")).toBe("6701234567");
    expect(normalizePhoneDigits("+31 6 12345678")).toBe("612345678");
    expect(normalizePhoneDigits("06-12345678")).toBe("612345678");
  });
});

describe("phoneSearchMatches", () => {
  const stored = ["08161 6097754", "08161/6097754", "+49 8161 6097754", "+498161 6097754"];
  it("+49 8161 6097754 finds every written form", () => {
    for (const s of stored) expect(phoneSearchMatches("+49 8161 6097754", s)).toBe(true);
  });
  it("081616097754 finds the +49 form", () => {
    expect(phoneSearchMatches("081616097754", "+49 8161 6097754")).toBe(true);
    expect(phoneSearchMatches("081616097754", "08161/6097754")).toBe(true);
  });
  it("the plain number 6097754 finds both", () => {
    for (const s of stored) expect(phoneSearchMatches("6097754", s)).toBe(true);
  });
  it("does not match other numbers or short searches", () => {
    expect(phoneSearchMatches("+49 8161 6097755", "08161/6097754")).toBe(false);
    expect(phoneSearchMatches("60", "08161/6097754")).toBe(true); // plain text hit
    expect(phoneSearchMatches("12", "+49 30 5551")).toBe(false);
    expect(phoneSearchMatches("123", null)).toBe(false);
  });
  it("text searches do not turn into digit searches", () => {
    expect(isPhoneQuery("Hauptstraße 12345")).toBe(false);
    expect(phoneSearchMatches("Hauptstraße 6097754", "08161 6097754")).toBe(false);
  });
});

describe("searchMatches", () => {
  it("keeps the text search for company, contact and e-mail", () => {
    expect(searchMatches("müller", ["Müller GmbH", "Anna", "a@x.de"], "0301")).toBe(true);
    expect(searchMatches("a@x", ["Firma", null, "a@x.de"], null)).toBe(true);
    expect(searchMatches("zzz", ["Firma"], "0301")).toBe(false);
    expect(searchMatches("  ", ["Firma"], null)).toBe(true);
  });
  it("finds a lead by phone however it is typed", () => {
    expect(searchMatches("+49 8161 6097754", ["Firma"], "08161/6097754")).toBe(true);
  });
});

describe("phoneDbPatterns", () => {
  it("builds patterns for phone searches only", () => {
    expect(phoneDbPatterns("Müller")).toEqual([]);
    expect(phoneDbPatterns("12")).toEqual([]);
    const p = phoneDbPatterns("+49 8161 6097754");
    expect(p).toContain("%81616097754%");
    expect(p).toContain("%081616097754%");
    expect(p).toContain("%8%1%6%1%6%0%9%7%7%5%4%");
  });
  it("uses plain digit patterns for short searches", () => {
    expect(phoneDbPatterns("609")).toEqual(["%609%", "%0609%"]);
  });
});
