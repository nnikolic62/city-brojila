import { equalObisValue, normalizeSerial } from "../lib/normalize";
import type { GroundTruthEntry, MeterReading, SerialSource } from "../lib/schema";

export const FIELDS = ["isMeter", "serialNumber", "manufacturer", "yearOfManufacture"] as const;
export type Field = (typeof FIELDS)[number];

export type FieldScores = Record<Field, boolean>;

export type SampleScore = {
  id: string;
  valid: boolean;
  fields: FieldScores;
  obis: Record<string, boolean>;
  fullRecord: boolean;
  fullRecordWithDecimals: boolean;
  hallucinations: string[];
};

/** Poređenje jednog odgovora sa ground truthom (docs/PRD.md). Čista funkcija. */
export function scoreSample(gt: GroundTruthEntry, pred: MeterReading | null): SampleScore {
  const exp = gt.expected;
  if (!pred) {
    const fields = Object.fromEntries(FIELDS.map((f) => [f, false])) as FieldScores;
    return {
      id: gt.id,
      valid: false,
      fields,
      obis: {},
      fullRecord: false,
      fullRecordWithDecimals: false,
      hallucinations: [],
    };
  }

  const fields: FieldScores = {
    isMeter: pred.isMeter === exp.isMeter,
    serialNumber: normalizeSerial(pred.serialNumber) === normalizeSerial(exp.serialNumber),
    manufacturer: (pred.manufacturer ?? null) === (exp.manufacturer ?? null),
    yearOfManufacture: (pred.yearOfManufacture ?? null) === (exp.yearOfManufacture ?? null),
  };

  const obis: Record<string, boolean> = {};
  const expByCode = new Map(exp.obis.map((o) => [o.code, o.value]));
  for (const [code, expVal] of expByCode) {
    const predItem = pred.obis.find((o) => o.code === code);
    obis[code] = predItem != null && equalObisValue(predItem.value, expVal);
  }

  const hallucinations: string[] = [];
  if (exp.serialNumber === null && pred.serialNumber !== null) hallucinations.push("serialNumber");
  for (const p of pred.obis) {
    if (!expByCode.has(p.code)) hallucinations.push(`obis:${p.code}`);
  }

  const obisOk = Object.values(obis).every(Boolean);
  const fullRecord = FIELDS.every((f) => fields[f]) && obisOk && hallucinations.length === 0;

  return {
    id: gt.id,
    valid: true,
    fields,
    obis,
    fullRecord,
    fullRecordWithDecimals: fullRecord,
    hallucinations,
  };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export const pct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);

export type SerialAttribution = {
  serialSource: SerialSource;
  barcodeFound: boolean;
};

/** Stari rezultati (bez polja) vraćaju null, da ih izveštaj ne broji kao promašen bar-kod. */
export function serialAttribution(raw: {
  serialSource?: SerialSource;
  barcodeSerial?: string | null;
}): SerialAttribution | null {
  if (raw.serialSource === undefined && raw.barcodeSerial === undefined) return null;
  return {
    serialSource: raw.serialSource ?? null,
    barcodeFound: typeof raw.barcodeSerial === "string" && raw.barcodeSerial.length > 0,
  };
}

export type SerialSourceMetrics = {
  total: number;
  barcodeFound: number;
  bySource: {
    barcode: { correct: number; total: number };
    model: { correct: number; total: number };
  };
};

/**
 * Tačnost konačnog serijskog kad je izvor bar-kod, odnosno model,
 * i koliko uzoraka uopšte ima pročitan bar-kod.
 * Uzorci bez atribucije (stari run) se preskaču. Nema ih → null.
 */
export function serialSourceMetrics(
  samples: { serialCorrect: boolean; attribution: SerialAttribution | null }[],
): SerialSourceMetrics | null {
  const known = samples.filter(
    (s): s is { serialCorrect: boolean; attribution: SerialAttribution } => s.attribution !== null,
  );
  if (known.length === 0) return null;

  const metrics: SerialSourceMetrics = {
    total: known.length,
    barcodeFound: 0,
    bySource: {
      barcode: { correct: 0, total: 0 },
      model: { correct: 0, total: 0 },
    },
  };

  for (const sample of known) {
    if (sample.attribution.barcodeFound) metrics.barcodeFound++;
    switch (sample.attribution.serialSource) {
      case "barcode":
      case "model": {
        const bucket = metrics.bySource[sample.attribution.serialSource];
        bucket.total++;
        if (sample.serialCorrect) bucket.correct++;
        break;
      }
      case null:
        break;
      default: {
        const unreachable: never = sample.attribution.serialSource;
        throw new Error(`Nepoznat izvor serijskog: ${String(unreachable)}`);
      }
    }
  }

  return metrics;
}

function ratio(correct: number, total: number): string {
  if (total === 0) return "—";
  return `${pct(correct, total)} (${correct}/${total})`;
}

/** Kolona „Serijski izvor“: tačnost po izvoru i udeo slika sa bar-kodom. */
export function formatSerialSource(metrics: SerialSourceMetrics | null): string {
  if (!metrics) return "—";
  return `bar-kod ${ratio(metrics.bySource.barcode.correct, metrics.bySource.barcode.total)} · model ${ratio(metrics.bySource.model.correct, metrics.bySource.model.total)} · nađen ${ratio(metrics.barcodeFound, metrics.total)}`;
}

/** Oznaka ablacije za jedan red tabele (prompt × crop × bar-kod). */
export function formatVariant(meta: {
  promptVersion: string;
  useCrop?: boolean;
  cropModel?: boolean;
  useBarcode?: boolean;
}): string {
  if (meta.useCrop === undefined && meta.useBarcode === undefined && meta.cropModel === undefined) {
    return meta.promptVersion;
  }
  if (meta.cropModel === false && meta.useCrop !== false) {
    const barcode = meta.useBarcode === false ? "bez bar-kod" : "bar-kod crop";
    return `${meta.promptVersion} · model pun + ${barcode}`;
  }
  const crop = meta.useCrop === undefined ? "—" : meta.useCrop ? "crop" : "bez crop";
  const barcode = meta.useBarcode === undefined ? "—" : meta.useBarcode ? "bar-kod" : "bez bar-kod";
  return `${meta.promptVersion} · ${crop} + ${barcode}`;
}
