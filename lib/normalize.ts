import type { ReadingValue } from "./schema";

/** "045231" → "45231"; "0000" → "0". Koristi se za poređenje celobrojnog dela (primarna metrika). */
export function stripLeadingZeros(digits: string): string {
  const s = digits.replace(/\s+/g, "").replace(/^0+/, "");
  return s === "" ? "0" : s;
}

/** Serijski broj: bez razmaka, crtica, tačaka, kosih crta; uppercase. */
export function normalizeSerial(serial: string | null): string | null {
  if (serial == null) return null;
  const s = serial.replace(/[\s\-./]/g, "").toUpperCase();
  return s === "" ? null : s;
}

/** Stanje kao broj (kWh) — samo za aritmetiku (poređenje sa prethodnim, skok potrošnje). */
export function readingToNumber(r: Pick<ReadingValue, "integer" | "decimal">): number {
  return Number(`${stripLeadingZeros(r.integer)}.${r.decimal ?? "0"}`);
}

export function equalInteger(a: ReadingValue | null, b: ReadingValue | null): boolean {
  if (a === null || b === null) return a === b;
  return stripLeadingZeros(a.integer) === stripLeadingZeros(b.integer);
}

export function equalFull(a: ReadingValue | null, b: ReadingValue | null): boolean {
  if (a === null || b === null) return a === b;
  return equalInteger(a, b) && (a.decimal ?? null) === (b.decimal ?? null);
}
