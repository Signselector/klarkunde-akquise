import { describe, expect, it } from "vitest";
import { leadAvgTier, leadQualityTier, salaryForAvg } from "./kpi-tiers";

describe("leadAvgTier", () => {
  it("red below 0.75", () => expect(leadAvgTier(0.74)).toBe("red"));
  it("yellow up to 1.2", () => expect(leadAvgTier(1.2)).toBe("yellow"));
  it("green up to 1.5", () => expect(leadAvgTier(1.5)).toBe("green"));
  it("gold above 1.5", () => expect(leadAvgTier(2)).toBe("gold"));
});
describe("leadQualityTier", () => {
  it("red below 5", () => expect(leadQualityTier(4.9)).toBe("red"));
  it("yellow 5 to 6.5", () => expect(leadQualityTier(5)).toBe("yellow"));
  it("green from 6.5", () => expect(leadQualityTier(6.5)).toBe("green"));
});
describe("salaryForAvg", () => {
  it("0 below 0.75", () => expect(salaryForAvg(0.74)).toBe(0));
  it("2000 from 0.75", () => expect(salaryForAvg(0.75)).toBe(2000));
  it("2500 from 1.2", () => expect(salaryForAvg(1.2)).toBe(2500));
  it("3000 from 1.5", () => expect(salaryForAvg(1.5)).toBe(3000));
  it("4000 from 3.0", () => expect(salaryForAvg(3)).toBe(4000));
  it("4000 above 3.0", () => expect(salaryForAvg(66.67)).toBe(4000));
});
