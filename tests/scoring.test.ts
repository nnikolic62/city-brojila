import { describe, expect, it } from "vitest";
import {
  formatSerialSource,
  formatVariant,
  percentile,
  scoreSample,
  serialAttribution,
  serialSourceMetrics,
} from "@/eval/scoring";
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

  it("pogrešna OBIS vrednost", () => {
    const s = scoreSample(gt, reading({ obis: [{ code: "1.8.1", value: "999" }, ...reading().obis.slice(1)] }));
    expect(s.obis["1.8.1"]).toBe(false);
    expect(s.fullRecord).toBe(false);
  });

  it("halucinacija: OBIS kod koji nije u ground truthu", () => {
    const s = scoreSample(gt, reading({ obis: [...reading().obis, { code: "9.9.9", value: "1" }] }));
    expect(s.hallucinations).toEqual(["obis:9.9.9"]);
    expect(s.fullRecord).toBe(false);
  });

  it("halucinacija: serijski kad je u GT null (m001)", () => {
    const gtNullSerial: GroundTruthEntry = {
      ...gt,
      expected: { ...reading(), serialNumber: null, obis: [{ code: "15.8.1", value: "00370386" }] },
    };
    const s = scoreSample(gtNullSerial, reading({ serialNumber: "E311N2A20", obis: [{ code: "15.8.1", value: "00370386" }] }));
    expect(s.hallucinations).toContain("serialNumber");
    expect(s.fullRecord).toBe(false);
  });

  it("tačan odgovor kad GT serial null i model null", () => {
    const gtNullSerial: GroundTruthEntry = {
      ...gt,
      expected: {
        isMeter: true,
        serialNumber: null,
        manufacturer: "EWG",
        yearOfManufacture: null,
        obis: [{ code: "15.8.1", value: "00370386" }],
      },
    };
    const pred = reading({
      serialNumber: null,
      manufacturer: "EWG",
      yearOfManufacture: null,
      obis: [{ code: "15.8.1", value: "00370386" }],
    });
    expect(scoreSample(gtNullSerial, pred).fullRecord).toBe(true);
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

describe("serialAttribution", () => {
  it("stari rezultat bez polja nema atribuciju", () => {
    expect(serialAttribution({})).toBeNull();
  });

  it("bar-kod je pronađen samo kad tekst nije prazan", () => {
    expect(serialAttribution({ serialSource: "barcode", barcodeSerial: "31215748" })).toEqual({
      serialSource: "barcode",
      barcodeFound: true,
    });
    expect(serialAttribution({ serialSource: null, barcodeSerial: null })).toEqual({
      serialSource: null,
      barcodeFound: false,
    });
    expect(serialAttribution({ serialSource: "model", barcodeSerial: "" })).toEqual({
      serialSource: "model",
      barcodeFound: false,
    });
  });
});

describe("serialSourceMetrics", () => {
  it("nema poznatih uzoraka → null", () => {
    expect(serialSourceMetrics([])).toBeNull();
    expect(serialSourceMetrics([{ serialCorrect: true, attribution: null }])).toBeNull();
  });

  it("tačnost serijskog po izvoru i udeo pronađenog bar-koda", () => {
    const metrics = serialSourceMetrics([
      { serialCorrect: true, attribution: { serialSource: "barcode", barcodeFound: true } },
      { serialCorrect: false, attribution: { serialSource: "barcode", barcodeFound: true } },
      { serialCorrect: true, attribution: { serialSource: "model", barcodeFound: false } },
      { serialCorrect: false, attribution: { serialSource: "model", barcodeFound: false } },
      { serialCorrect: false, attribution: { serialSource: null, barcodeFound: false } },
      { serialCorrect: true, attribution: null },
    ]);
    expect(metrics).toEqual({
      total: 5,
      barcodeFound: 2,
      bySource: {
        barcode: { correct: 1, total: 2 },
        model: { correct: 1, total: 2 },
      },
    });
  });
});

describe("formatSerialSource", () => {
  it("prazno je crtica", () => {
    expect(formatSerialSource(null)).toBe("—");
  });

  it("prikazuje bar-kod, model i koliko je bar-kod nađen", () => {
    expect(
      formatSerialSource({
        total: 3,
        barcodeFound: 2,
        bySource: {
          barcode: { correct: 2, total: 2 },
          model: { correct: 0, total: 1 },
        },
      }),
    ).toBe("bar-kod 100.0% (2/2) · model 0.0% (0/1) · nađen 66.7% (2/3)");
  });

  it("izvor bez uzoraka ostaje crtica", () => {
    expect(
      formatSerialSource({
        total: 1,
        barcodeFound: 0,
        bySource: {
          barcode: { correct: 0, total: 0 },
          model: { correct: 1, total: 1 },
        },
      }),
    ).toBe("bar-kod — · model 100.0% (1/1) · nađen 0.0% (0/1)");
  });
});

describe("formatVariant", () => {
  it("četiri ablacije u istoj oznaci", () => {
    expect(formatVariant({ promptVersion: "v2", useCrop: false, useBarcode: false })).toBe(
      "v2 · bez crop + bez bar-kod",
    );
    expect(formatVariant({ promptVersion: "v3", useCrop: false, useBarcode: false })).toBe(
      "v3 · bez crop + bez bar-kod",
    );
    expect(formatVariant({ promptVersion: "v3", useCrop: true, useBarcode: false })).toBe("v3 · crop + bez bar-kod");
    expect(formatVariant({ promptVersion: "v3", useCrop: true, useBarcode: true })).toBe("v3 · crop + bar-kod");
  });

  it("stari run bez flagova ostaje samo prompt", () => {
    expect(formatVariant({ promptVersion: "v1" })).toBe("v1");
  });

  it("model na punoj slici, bar-kod na crop-u", () => {
    expect(formatVariant({ promptVersion: "v3", useCrop: true, cropModel: false, useBarcode: true })).toBe(
      "v3 · model pun + bar-kod crop",
    );
  });
});
