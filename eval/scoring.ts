import { equalFull, equalInteger, normalizeSerial } from "../lib/normalize";
import type { GroundTruthEntry, MeterReading } from "../lib/schema";

export const FIELDS = ["isMeter", "meterKind", "tariffType", "serialNumber", "single", "vt", "nt"] as const;
export type Field = (typeof FIELDS)[number];

export type FieldScores = Record<Field, boolean>;

export type SampleScore = {
  id: string;
  valid: boolean; // model je vratio JSON koji prolazi Zod
  fields: FieldScores;
  fullRecord: boolean; // sva polja tačna (celobrojni deo stanja)
  fullRecordWithDecimals: boolean;
  hallucinations: Field[]; // model vratio vrednost gde je istina null
};

/** Poređenje jednog odgovora sa ground truthom (PLAN.md, faza 3.4). Čista funkcija. */
export function scoreSample(gt: GroundTruthEntry, pred: MeterReading | null): SampleScore {
  const exp = gt.expected;
  if (!pred) {
    const fields = Object.fromEntries(FIELDS.map((f) => [f, false])) as FieldScores;
    return { id: gt.id, valid: false, fields, fullRecord: false, fullRecordWithDecimals: false, hallucinations: [] };
  }

  const fields: FieldScores = {
    isMeter: pred.isMeter === exp.isMeter,
    meterKind: pred.meterKind === exp.meterKind,
    tariffType: pred.tariffType === exp.tariffType,
    serialNumber: normalizeSerial(pred.serialNumber) === normalizeSerial(exp.serialNumber),
    single: equalInteger(pred.readings.single, exp.readings.single),
    vt: equalInteger(pred.readings.vt, exp.readings.vt),
    nt: equalInteger(pred.readings.nt, exp.readings.nt),
  };

  const hallucinations: Field[] = [];
  if (exp.serialNumber === null && pred.serialNumber !== null) hallucinations.push("serialNumber");
  for (const k of ["single", "vt", "nt"] as const) {
    if (exp.readings[k] === null && pred.readings[k] !== null) hallucinations.push(k);
  }

  const fullRecord = FIELDS.every((f) => fields[f]);
  const fullRecordWithDecimals =
    fullRecord && (["single", "vt", "nt"] as const).every((k) => equalFull(pred.readings[k], exp.readings[k]));

  return { id: gt.id, valid: true, fields, fullRecord, fullRecordWithDecimals, hallucinations };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export const pct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);
