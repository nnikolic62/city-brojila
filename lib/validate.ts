import { RULES } from "./config";
import { normalizeSerial, readingToNumber } from "./normalize";
import type { MeterReading, PreviousReading, ReadStatus, TariffKey, Warning } from "./schema";

export type ValidationResult = { status: ReadStatus; warnings: Warning[] };

const TARIFF_LABEL: Record<TariffKey, string> = { single: "JT", vt: "VT", nt: "NT" };

/**
 * Poslovna pravila V1–V9 (PLAN.md, faza 6). Čista funkcija — bez I/O.
 * Redosled: prvo pravila koja traže ponovno slikanje (retake), zatim ona koja traže proveru (needs_review).
 */
export function validateReading(r: MeterReading, previous?: PreviousReading): ValidationResult {
  const warnings: Warning[] = [];
  const present = (Object.keys(r.readings) as TariffKey[]).filter((k) => r.readings[k] !== null);

  // V1 — nije brojilo
  if (!r.isMeter) {
    return {
      status: "retake",
      warnings: [{ code: "NOT_A_METER", message: "Na slici nije prepoznato brojilo električne energije. Slikajte ponovo." }],
    };
  }

  // V2 — loša slika i nema nijednog stanja
  const q = r.imageQuality;
  if (present.length === 0) {
    const tip = q.glare
      ? "Pomerite telefon da izbegnete odsjaj."
      : q.blur
        ? "Držite telefon mirno i sačekajte da se fokusira."
        : q.partial
          ? "Obuhvatite ceo brojčanik u kadar."
          : "Slikajte brojčanik izbliza i pravo.";
    return { status: "retake", warnings: [{ code: "BAD_IMAGE", message: `Stanje nije pročitano. ${tip}` }] };
  }

  for (const key of present) {
    const value = r.readings[key]!;
    const label = TARIFF_LABEL[key];

    // V4 — broj cifara
    if (r.meterKind) {
      const { min, max } = RULES.digitCount[r.meterKind];
      const n = value.integer.length;
      if (n < min || n > max) {
        warnings.push({ code: "DIGIT_COUNT", field: key, message: `${label}: neočekivan broj cifara (${n}). Proverite vrednost.` });
      }
    }

    // V3 / V7 — poređenje sa prethodnim stanjem
    const prev = previous?.[key];
    if (prev) {
      const now = readingToNumber(value);
      const before = readingToNumber({ integer: prev, decimal: null });
      if (now < before) {
        warnings.push({ code: "LOWER_THAN_PREVIOUS", field: key, message: `${label}: novo stanje (${now}) je manje od prethodnog (${before}).` });
      } else if (now - before > RULES.maxJumpKwh) {
        warnings.push({ code: "UNREALISTIC_JUMP", field: key, message: `${label}: potrošnja od ${Math.round(now - before)} kWh deluje nerealno.` });
      }
    }
  }

  // V5 — dvotarifno bez obe tarife
  if (r.tariffType === "dual") {
    for (const key of ["vt", "nt"] as const) {
      if (!r.readings[key]) {
        warnings.push({
          code: "MISSING_TARIFF",
          field: key,
          message: `Nedostaje ${TARIFF_LABEL[key]}. ${r.meterKind === "electronic" ? "Na LCD brojilu slikajte i drugu tarifu." : "Unesite ručno ili slikajte ponovo."}`,
        });
      }
    }
  }

  // V6 — jednotarifno a vraćeni VT/NT
  if (r.tariffType === "single" && (r.readings.vt || r.readings.nt)) {
    warnings.push({ code: "UNEXPECTED_TARIFF", message: "Brojilo je jednotarifno, a pročitane su VT/NT vrednosti. Proverite." });
  }

  // V8 — niska sigurnost
  if (r.confidence.readings === "low") {
    warnings.push({ code: "LOW_CONFIDENCE", message: "Model nije siguran u očitano stanje. Proverite cifre." });
  }

  // V9 — format serijskog broja (samo upozorenje)
  const serial = normalizeSerial(r.serialNumber);
  if (serial && !RULES.serialNumber.pattern.test(serial)) {
    warnings.push({ code: "SERIAL_FORMAT", field: "serialNumber", message: "Serijski broj ima neočekivan format." });
  }

  const blocking = warnings.some((w) => w.code !== "SERIAL_FORMAT");
  return { status: blocking ? "needs_review" : "ok", warnings };
}
