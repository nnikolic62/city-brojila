import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GroundTruthSchema, MeterReadingSchema, meterReadingJsonSchema } from "@/lib/schema";
import { reading } from "./fixtures";

describe("schema", () => {
  it("prihvata ispravan odgovor", () => {
    expect(MeterReadingSchema.safeParse(reading()).success).toBe(true);
  });

  it("odbija stanje koje nije niz cifara", () => {
    const bad = reading({ readings: { single: null, vt: { integer: "45,231", decimal: null }, nt: null } });
    expect(MeterReadingSchema.safeParse(bad).success).toBe(false);
  });

  it("odbija dodatna polja (strict)", () => {
    expect(MeterReadingSchema.safeParse({ ...reading(), extra: 1 }).success).toBe(false);
  });

  it("JSON Schema je spremna za strict structured output", () => {
    const s = meterReadingJsonSchema as { additionalProperties?: boolean; required?: string[]; properties: object };
    expect(s.additionalProperties).toBe(false);
    expect(s.required?.sort()).toEqual(Object.keys(s.properties).sort());
  });

  it("primer ground trutha i prazan ground truth prolaze šemu", () => {
    for (const f of ["dataset/ground-truth.example.json", "dataset/ground-truth.json"]) {
      const data = JSON.parse(readFileSync(f, "utf8"));
      expect(GroundTruthSchema.safeParse(data).success, f).toBe(true);
    }
  });
});
