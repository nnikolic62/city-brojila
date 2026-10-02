import { describe, expect, it } from "vitest";
import { mergeMeterReadings } from "@/lib/merge";
import { reading } from "./fixtures";

describe("mergeMeterReadings", () => {
  it("rejects a single photo without serial", () => {
    const result = mergeMeterReadings([reading({ serialNumber: null })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reject.code).toBe("SERIAL_UNREADABLE");
  });

  it("rejects when any photo has no serial", () => {
    const result = mergeMeterReadings([reading(), reading({ serialNumber: null })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reject.code).toBe("SERIAL_UNREADABLE");
  });

  it("rejects when serials differ", () => {
    const result = mergeMeterReadings([
      reading({ serialNumber: "111" }),
      reading({ serialNumber: "222" }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reject.code).toBe("SERIAL_MISMATCH");
  });

  it("merges complementary OBIS from two photos", () => {
    const result = mergeMeterReadings([
      reading({ obis: [{ code: "1.8.1", value: "100" }] }),
      reading({ obis: [{ code: "1.8.2", value: "200" }] }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.merged.obis).toEqual([
        { code: "1.8.1", value: "100", review: false },
        { code: "1.8.2", value: "200", review: false },
      ]);
      expect(result.data.needsReviewFromMerge).toBe(false);
    }
  });

  it("flags review when same OBIS code differs across photos", () => {
    const result = mergeMeterReadings([
      reading({ obis: [{ code: "1.8.1", value: "100" }] }),
      reading({ obis: [{ code: "1.8.1", value: "101" }] }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.merged.obis).toEqual([{ code: "1.8.1", value: null, review: true }]);
      expect(result.data.needsReviewFromMerge).toBe(true);
    }
  });

  it("treats OBIS values equal after space normalization", () => {
    const result = mergeMeterReadings([
      reading({ obis: [{ code: "1.8.1", value: "1 00" }] }),
      reading({ obis: [{ code: "1.8.1", value: "100" }] }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.merged.obis[0]?.review).toBe(false);
      expect(result.data.needsReviewFromMerge).toBe(false);
    }
  });
});
