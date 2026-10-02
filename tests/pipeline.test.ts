import { describe, expect, it } from "vitest";
import { resolveSerial } from "@/lib/pipeline";

describe("resolveSerial", () => {
  it("kad se oba slažu, uzima bar-kod", () => {
    expect(resolveSerial("31215748", "31215748")).toEqual({
      serial: "31215748",
      source: "barcode",
      mismatch: false,
    });
  });

  it("uzima samo bar-kod kad model nema serijski", () => {
    expect(resolveSerial("31215748", null)).toEqual({
      serial: "31215748",
      source: "barcode",
      mismatch: false,
    });
  });

  it("uzima model kad bar-kod nije pročitan", () => {
    expect(resolveSerial(null, "31215748")).toEqual({
      serial: "31215748",
      source: "model",
      mismatch: false,
    });
  });

  it("kad se razlikuju, bar-kod pobeđuje i javlja neslaganje", () => {
    expect(resolveSerial("31215748", "2323500008292")).toEqual({
      serial: "31215748",
      source: "barcode",
      mismatch: true,
    });
  });

  it("vraća null kad nijedan izvor nema serijski", () => {
    expect(resolveSerial(null, null)).toEqual({
      serial: null,
      source: null,
      mismatch: false,
    });
  });

  it("poredi posle normalizeSerial, a u rezultat upisuje normalizovan serijski", () => {
    expect(resolveSerial("3121-5748", "3121 5748")).toEqual({
      serial: "31215748",
      source: "barcode",
      mismatch: false,
    });
  });
});
