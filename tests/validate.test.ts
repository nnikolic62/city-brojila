import { describe, expect, it } from "vitest";
import { validateReading } from "@/lib/validate";
import { reading } from "./fixtures";

const codes = (r: ReturnType<typeof validateReading>) => r.warnings.map((w) => w.code);

describe("validateReading", () => {
  it("ok za ispravno dvotarifno očitavanje", () => {
    expect(validateReading(reading())).toEqual({ status: "ok", warnings: [] });
  });

  it("V1: nije brojilo → retake", () => {
    const r = validateReading(reading({ isMeter: false }));
    expect(r.status).toBe("retake");
    expect(codes(r)).toEqual(["NOT_A_METER"]);
  });

  it("V2: nema stanja + odsjaj → retake sa savetom", () => {
    const r = validateReading(
      reading({ readings: { single: null, vt: null, nt: null }, imageQuality: { blur: false, glare: true, partial: false } })
    );
    expect(r.status).toBe("retake");
    expect(r.warnings[0].message).toMatch(/odsjaj/);
  });

  it("V3: novo stanje manje od prethodnog → needs_review", () => {
    const r = validateReading(reading(), { vt: "045300" });
    expect(r.status).toBe("needs_review");
    expect(codes(r)).toContain("LOWER_THAN_PREVIOUS");
  });

  it("V4: pogrešan broj cifara", () => {
    const r = validateReading(reading({ readings: { single: null, vt: { integer: "452", decimal: null }, nt: { integer: "021877", decimal: null } } }));
    expect(codes(r)).toContain("DIGIT_COUNT");
  });

  it("V5: dvotarifno bez NT", () => {
    const r = validateReading(reading({ meterKind: "electronic", readings: { single: null, vt: { integer: "045231", decimal: null }, nt: null } }));
    expect(codes(r)).toContain("MISSING_TARIFF");
    expect(r.warnings.find((w) => w.code === "MISSING_TARIFF")?.message).toMatch(/LCD/);
  });

  it("V7: nerealan skok", () => {
    expect(codes(validateReading(reading(), { vt: "030000" }))).toContain("UNREALISTIC_JUMP");
  });

  it("V8: niska sigurnost", () => {
    expect(codes(validateReading(reading({ confidence: { serialNumber: "high", readings: "low" } })))).toContain("LOW_CONFIDENCE");
  });

  it("V9: format serijskog broja je samo upozorenje (status ostaje ok)", () => {
    const r = validateReading(reading({ serialNumber: "12" }));
    expect(r.status).toBe("ok");
    expect(codes(r)).toEqual(["SERIAL_FORMAT"]);
  });
});
