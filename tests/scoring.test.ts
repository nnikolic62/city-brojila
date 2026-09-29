import { describe, expect, it } from "vitest";
import { percentile, scoreSample } from "@/eval/scoring";
import { ExpectedSchema, type GroundTruthEntry } from "@/lib/schema";
import { reading } from "./fixtures";

const gt: GroundTruthEntry = {
  id: "m001",
  file: "m001.jpg",
  split: "dev",
  tags: ["mechanical", "dual"],
  expected: ExpectedSchema.strip().parse(reading()),
};

describe("scoreSample", () => {
  it("tačan odgovor = ceo zapis tačan", () => {
    const s = scoreSample(gt, reading());
    expect(s.fullRecord).toBe(true);
    expect(s.fullRecordWithDecimals).toBe(true);
  });

  it("vodeće nule se ignorišu u primarnoj metrici, decimala se broji u sekundarnoj", () => {
    const s = scoreSample(gt, reading({ readings: { single: null, vt: { integer: "45231", decimal: "8" }, nt: gt.expected.readings.nt } }));
    expect(s.fullRecord).toBe(true);
    expect(s.fullRecordWithDecimals).toBe(false);
  });

  it("halucinacija: vrednost gde je istina null", () => {
    const s = scoreSample(gt, reading({ readings: { ...reading().readings, single: { integer: "1", decimal: null } } }));
    expect(s.hallucinations).toEqual(["single"]);
    expect(s.fields.single).toBe(false);
  });

  it("nevalidan odgovor = sve netačno", () => {
    const s = scoreSample(gt, null);
    expect(s.valid).toBe(false);
    expect(Object.values(s.fields).every((v) => !v)).toBe(true);
  });
});

describe("percentile", () => {
  it("računa p50/p95", () => {
    const v = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(v, 50)).toBe(500);
    expect(percentile(v, 95)).toBe(1000);
    expect(percentile([], 50)).toBeNull();
  });
});
