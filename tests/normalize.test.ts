import { describe, expect, it } from "vitest";
import { equalFull, equalInteger, normalizeSerial, readingToNumber, stripLeadingZeros } from "@/lib/normalize";

describe("normalize", () => {
  it("skida vodeće nule", () => {
    expect(stripLeadingZeros("045231")).toBe("45231");
    expect(stripLeadingZeros("0000")).toBe("0");
  });
  it("normalizuje serijski broj", () => {
    expect(normalizeSerial(" 12-34 56.78 ")).toBe("12345678");
    expect(normalizeSerial("ab 12")).toBe("AB12");
    expect(normalizeSerial("")).toBeNull();
  });
  it("pretvara stanje u broj", () => {
    expect(readingToNumber({ integer: "045231", decimal: "7" })).toBe(45231.7);
    expect(readingToNumber({ integer: "00012", decimal: null })).toBe(12);
  });
  it("poredi stanja", () => {
    expect(equalInteger({ integer: "045231", decimal: "7" }, { integer: "45231", decimal: "1" })).toBe(true);
    expect(equalFull({ integer: "045231", decimal: "7" }, { integer: "45231", decimal: "1" })).toBe(false);
    expect(equalInteger(null, null)).toBe(true);
    expect(equalInteger(null, { integer: "1", decimal: null })).toBe(false);
  });
});
