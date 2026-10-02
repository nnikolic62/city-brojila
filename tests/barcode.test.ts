import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeBarcodes, pickSerial, serialFromQr, type BarcodeCandidate } from "@/lib/barcode";
import { RULES } from "@/lib/config";
import { cropRegion, orientImage } from "@/lib/preprocess";
import groundTruth from "../dataset/ground-truth.json";

const imagesDir = path.join(process.cwd(), "dataset/images");

describe("pickSerial", () => {
  it("vraća 8-cifreni serijski i odbacuje 13 cifara i QR", () => {
    const candidates: BarcodeCandidate[] = [
      { text: "https://example.com/meter", format: "QRCode", top: 0.1 },
      { text: "2323500008292", format: "EAN13", top: 0.8 },
      { text: "31215748", format: "Code128", top: 0.4 },
    ];
    expect(pickSerial(candidates)).toBe("31215748");
  });

  it("bira viši od dva validna kandidata", () => {
    const candidates: BarcodeCandidate[] = [
      { text: "31215748", format: "Code128", top: 0.55 },
      { text: "12124414", format: "Code128", top: 0.2 },
    ];
    expect(pickSerial(candidates)).toBe("12124414");
  });

  it("vraća null kad nijedan kandidat ne odgovara obrascu", () => {
    const candidates: BarcodeCandidate[] = [
      { text: "2323500008292", format: "EAN13", top: 0.1 },
      { text: "EWGE311N2AAC0SP", format: "Code128", top: 0.3 },
    ];
    expect(pickSerial(candidates)).toBeNull();
    expect(pickSerial([])).toBeNull();
  });
});

describe("serialFromQr", () => {
  it("uzima 8 cifara iza dvotačke", () => {
    expect(serialFromQr("EWGE311N2AAC0SP:31215748")).toBe("31215748");
    expect(serialFromQr("31215748")).toBeNull();
    expect(serialFromQr("2323500008292")).toBeNull();
  });
});

describe("decodeBarcodes", () => {
  it("vraća prazan niz na nevažećoj slici", async () => {
    await expect(decodeBarcodes(Buffer.from("nije slika"))).resolves.toEqual([]);
  });
});

/**
 * Plan: m002–m004 → 31215748. Te slike su sada im*-48.
 * im1 i im2 dolaze iz QR-a (cifre iza ':'); ostalo iz Code128.
 * Ni crte ni QR ne daju serijski na: im7-83, im15-42, im20-14–im24-14, im25-25.
 */
const readableFiles = [
  "im1-48.jpeg",
  "im2-48.jpeg",
  "im3-48.jpeg",
  "im4-48.jpeg",
  "im5-83.jpeg",
  "im6-83.jpeg",
  "im8-83.jpeg",
  "im9-83.jpeg",
  "im10-90.jpeg",
  "im11-90.jpeg",
  "im12-90.jpeg",
  "im13-90.jpeg",
  "im14-90.jpeg",
  "im16-42.jpeg",
  "im17-42.jpeg",
  "im18-42.jpeg",
  "im19-42.jpeg",
  "im26-25.jpeg",
  "im27-25.jpeg",
  "im28-25.jpeg",
] as const;

describe.skipIf(!existsSync(imagesDir))("decodeBarcodes na datasetu", () => {
  const cases = readableFiles.map((file) => {
    const row = groundTruth.find((entry) => entry.file === file);
    if (!row?.expected.serialNumber) throw new Error(`Nema ground truth za ${file}`);
    return [file, row.expected.serialNumber] as const;
  });

  it.each(cases)(
    "%s → %s",
    async (file, serial) => {
      const input = await readFile(path.join(imagesDir, file));
      const oriented = await orientImage(input);
      const cropped = await cropRegion(oriented.buffer, RULES.crop);
      expect(pickSerial(await decodeBarcodes(cropped))).toBe(serial);
    },
    60_000,
  );
});
