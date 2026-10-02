import { normalizeObisValue, normalizeSerial } from "./normalize";
import type { MeterReading, MergedMeterReading, MergedObisReading } from "./schema";

export const MAX_IMAGES = 15;

export type MergeRejectCode = "SERIAL_UNREADABLE" | "SERIAL_MISMATCH";

export type MergeReject = {
  code: MergeRejectCode;
  message: string;
};

export type MergeSuccess = {
  merged: MergedMeterReading;
  needsReviewFromMerge: boolean;
};

export type MergeResult = { ok: true; data: MergeSuccess } | { ok: false; reject: MergeReject };

function mergeNullableString(values: (string | null)[]): { value: string | null; conflict: boolean } {
  const present = values.filter((v): v is string => v != null && v.trim() !== "");
  if (present.length === 0) return { value: null, conflict: false };
  const first = present[0]!;
  for (const v of present.slice(1)) {
    if (v !== first) return { value: null, conflict: true };
  }
  return { value: first, conflict: false };
}

function mergeObisList(readings: MeterReading[]): { obis: MergedObisReading[]; needsReview: boolean } {
  const byCode = new Map<string, Set<string>>();

  for (const r of readings) {
    for (const item of r.obis) {
      const normalized = normalizeObisValue(item.value);
      let set = byCode.get(item.code);
      if (!set) {
        set = new Set();
        byCode.set(item.code, set);
      }
      set.add(normalized);
    }
  }

  let needsReview = false;
  const obis: MergedObisReading[] = [];
  const flat = readings.flatMap((r) => r.obis);

  for (const [code, values] of byCode) {
    if (values.size > 1) {
      needsReview = true;
      obis.push({ code, value: null, review: true });
      continue;
    }
    const normalizedOnly = [...values][0]!;
    const raw = flat.find((o) => o.code === code && normalizeObisValue(o.value) === normalizedOnly);
    obis.push({ code, value: raw?.value ?? normalizedOnly, review: false });
  }

  obis.sort((a, b) => a.code.localeCompare(b.code));
  return { obis, needsReview };
}

/**
 * Spaja više očitavanja (jedna slika = jedan MeterReading) u jedan rezultat.
 * Pravila serijskog broja i OBIS usklađena sa docs/PRD.md (multi-image).
 */
export function mergeMeterReadings(readings: MeterReading[]): MergeResult {
  if (readings.length === 0) {
    return {
      ok: false,
      reject: {
        code: "SERIAL_UNREADABLE",
        message: "Serijski broj nije pročitan. Slikajte tablicu sa serijskim brojem i pokušajte ponovo.",
      },
    };
  }

  for (const r of readings) {
    if (!r.isMeter || normalizeSerial(r.serialNumber) == null) {
      return {
        ok: false,
        reject: {
          code: "SERIAL_UNREADABLE",
          message: "Serijski broj nije pročitan. Slikajte tablicu sa serijskim brojem i pokušajte ponovo.",
        },
      };
    }
  }

  const serials = readings.map((r) => normalizeSerial(r.serialNumber)!);
  const distinct = new Set(serials);
  if (distinct.size > 1) {
    return {
      ok: false,
      reject: {
        code: "SERIAL_MISMATCH",
        message: "Slike ne pripadaju istom brojilu (različit serijski broj). Proverite slike i pokušajte ponovo.",
      },
    };
  }

  const manufacturer = mergeNullableString(readings.map((r) => r.manufacturer));
  const yearOfManufacture = mergeNullableString(readings.map((r) => r.yearOfManufacture));
  const { obis, needsReview: obisReview } = mergeObisList(readings);

  let needsReviewFromMerge = obisReview;
  if (manufacturer.conflict || yearOfManufacture.conflict) needsReviewFromMerge = true;

  const merged: MergedMeterReading = {
    serialNumber: readings.find((r) => r.serialNumber)?.serialNumber ?? serials[0]!,
    manufacturer: manufacturer.conflict ? null : manufacturer.value,
    yearOfManufacture: yearOfManufacture.conflict ? null : yearOfManufacture.value,
    obis,
  };

  return { ok: true, data: { merged, needsReviewFromMerge } };
}
