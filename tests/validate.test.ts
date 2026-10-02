import { describe, expect, it } from "vitest";
import { validateMergedReading } from "@/lib/validate";
import type { MergedMeterReading } from "@/lib/schema";

function merged(overrides: Partial<MergedMeterReading> = {}): MergedMeterReading {
  return {
    serialNumber: "12345678",
    manufacturer: "EWG",
    yearOfManufacture: "2020",
    obis: [{ code: "1.8.1", value: "100", review: false }],
    ...overrides,
  };
}

const codes = (r: ReturnType<typeof validateMergedReading>) => r.warnings.map((w) => w.code);

describe("validateMergedReading", () => {
  it("ok za ispravno spojeno očitavanje", () => {
    expect(validateMergedReading(merged())).toEqual({ status: "ok", warnings: [] });
  });

  it("prazan OBIS → needs_review", () => {
    const r = validateMergedReading(merged({ obis: [] }));
    expect(r.status).toBe("needs_review");
    expect(codes(r)).toEqual(["BAD_IMAGE"]);
  });

  it("OBIS konflikt → needs_review", () => {
    const r = validateMergedReading(
      merged({ obis: [{ code: "1.8.1", value: null, review: true }] }),
    );
    expect(r.status).toBe("needs_review");
    expect(codes(r)).toContain("OBIS_CONFLICT");
  });

  it("format serijskog broja je samo upozorenje (status ostaje ok)", () => {
    const r = validateMergedReading(merged({ serialNumber: "12" }));
    expect(r.status).toBe("ok");
    expect(codes(r)).toEqual(["SERIAL_FORMAT"]);
  });

  it("neslaganje bar-koda i modela traži proveru, ali ne odbija očitavanje", () => {
    const r = validateMergedReading(merged(), { serialMismatch: true });
    expect(r.status).toBe("needs_review");
    expect(r.warnings).toEqual([
      {
        code: "SERIAL_SOURCE_MISMATCH",
        field: "serialNumber",
        message: "Serijski sa bar-koda i sa slike se razlikuju. Proverite.",
      },
    ]);
  });
});
