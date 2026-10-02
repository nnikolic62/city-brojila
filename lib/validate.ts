import { RULES } from "./config";
import { normalizeSerial } from "./normalize";
import type { MergedMeterReading, ReadStatus, Warning } from "./schema";

export type ValidationResult = { status: ReadStatus; warnings: Warning[] };

export type ValidateOptions = {
  /** Bilo koja slika ima serialMismatch (bar-kod i model se ne slažu). */
  serialMismatch?: boolean;
};

/**
 * Poslovna pravila nad spojenim očitavanjem (docs/PRD.md). Čista funkcija — bez I/O.
 * Neslaganje izvora ne odbija rezultat (bar-kod ostaje), ali traži ručnu proveru.
 */
export function validateMergedReading(r: MergedMeterReading, opts: ValidateOptions = {}): ValidationResult {
  const warnings: Warning[] = [];

  if (opts.serialMismatch) {
    warnings.push({
      code: "SERIAL_SOURCE_MISMATCH",
      field: "serialNumber",
      message: "Serijski sa bar-koda i sa slike se razlikuju. Proverite.",
    });
  }

  if (r.obis.length === 0) {
    warnings.push({
      code: "BAD_IMAGE",
      message: "Nijedan OBIS kod nije pročitan. Slikajte brojčanik izbliza i pravo.",
    });
  }

  for (const item of r.obis) {
    if (item.review) {
      warnings.push({
        code: "OBIS_CONFLICT",
        field: item.code,
        message: `Različite vrednosti za OBIS ${item.code} na slikama. Proverite ručno.`,
      });
    }
  }

  const serial = normalizeSerial(r.serialNumber);
  if (serial && !RULES.serialNumber.pattern.test(serial)) {
    warnings.push({ code: "SERIAL_FORMAT", field: "serialNumber", message: "Serijski broj ima neočekivan format." });
  }

  const blocking = warnings.some((w) => w.code !== "SERIAL_FORMAT");
  return { status: blocking ? "needs_review" : "ok", warnings };
}
