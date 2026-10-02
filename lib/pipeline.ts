import { decodeBarcodes, pickSerial } from "./barcode";
import { RULES } from "./config";
import { extractMeterReading, type ExtractResult } from "./extract";
import { normalizeSerial } from "./normalize";
import { cropRegion, orientImage, preprocessImage, toDataUrl } from "./preprocess";
import type { PromptVersion } from "./prompts";
import type { SerialSource } from "./schema";

export type { SerialSource };

export type ImageReadResult = ExtractResult & {
  barcodeSerial: string | null;
  serialSource: SerialSource;
  usedCrop: boolean;
  serialMismatch: boolean;
};

type ReadMeterImageOptions = {
  model: string;
  fallbackModels?: string[];
  promptVersion: PromptVersion;
  apiKey: string;
  timeoutMs?: number;
  /** Crop za bar-kod. Podrazumevano true. Eval: --no-crop. */
  useCrop?: boolean;
  /**
   * Crop za sliku koja ide modelu. Podrazumevano false: modelu ide pun kadar.
   * Eval: --crop-model vraća stari put (crop i modelu).
   */
  cropModel?: boolean;
  /** Podrazumevano true. Eval: --no-barcode. */
  useBarcode?: boolean;
};

/** Čista funkcija. Bar-kod ima prednost; model je rezerva. Poređenje ide preko normalizeSerial. */
export function resolveSerial(
  barcode: string | null,
  model: string | null,
): { serial: string | null; source: SerialSource; mismatch: boolean } {
  const fromBarcode = normalizeSerial(barcode);
  const fromModel = normalizeSerial(model);

  if (fromBarcode && fromModel) {
    return { serial: fromBarcode, source: "barcode", mismatch: fromBarcode !== fromModel };
  }
  if (fromBarcode) return { serial: fromBarcode, source: "barcode", mismatch: false };
  if (fromModel) return { serial: fromModel, source: "model", mismatch: false };
  return { serial: null, source: null, mismatch: false };
}

/**
 * Jedna slika: orijentacija → crop samo za bar-kod, modelu pun kadar → resolveSerial.
 * Koriste je i API ruta i eval.
 */
export async function readMeterImage(
  input: Buffer,
  opts: ReadMeterImageOptions,
): Promise<ImageReadResult & { capturedAt: string | null }> {
  const useCrop = opts.useCrop ?? true;
  const cropModel = opts.cropModel ?? false;
  const useBarcode = opts.useBarcode ?? true;

  const oriented = await orientImage(input);
  const crop = useCrop || cropModel ? await cropRegion(oriented.buffer, RULES.crop) : oriented.buffer;
  const forBarcode = useCrop ? crop : oriented.buffer;
  const forModel = cropModel ? crop : oriented.buffer;

  const [barcodeSerial, modelRead] = await Promise.all([
    useBarcode ? readBarcodeSerial(forBarcode, oriented.buffer, useCrop) : Promise.resolve(null),
    readWithModel(forModel, oriented.buffer, cropModel, opts),
  ]);

  const resolved = resolveSerial(barcodeSerial, modelRead.result.parsed?.serialNumber ?? null);
  const parsed = modelRead.result.parsed
    ? { ...modelRead.result.parsed, serialNumber: resolved.serial }
    : null;

  return {
    ...modelRead.result,
    parsed,
    barcodeSerial,
    serialSource: resolved.source,
    usedCrop: modelRead.usedCrop,
    serialMismatch: resolved.mismatch,
    capturedAt: oriented.capturedAt,
  };
}

/** Crop prvo; ako nema serijskog, puna orijentisana slika. */
async function readBarcodeSerial(crop: Buffer, full: Buffer, useCrop: boolean): Promise<string | null> {
  const fromCrop = pickSerial(await decodeBarcodes(crop));
  if (fromCrop || !useCrop) return fromCrop;
  return pickSerial(await decodeBarcodes(full));
}

/** Crop prvo; ako model kaže da to nije brojilo, ponovi na punoj slici. */
async function readWithModel(
  crop: Buffer,
  full: Buffer,
  useCrop: boolean,
  opts: ReadMeterImageOptions,
): Promise<{ result: ExtractResult; usedCrop: boolean }> {
  const primary = await extractFromImage(crop, opts);
  if (useCrop && primary.parsed?.isMeter === false) {
    return { result: await extractFromImage(full, opts), usedCrop: false };
  }
  return { result: primary, usedCrop: useCrop };
}

async function extractFromImage(image: Buffer, opts: ReadMeterImageOptions): Promise<ExtractResult> {
  const preprocessed = await preprocessImage(image);
  return extractMeterReading({
    imageDataUrl: toDataUrl(preprocessed.buffer, preprocessed.mimeType),
    model: opts.model,
    fallbackModels: opts.fallbackModels,
    promptVersion: opts.promptVersion,
    apiKey: opts.apiKey,
    timeoutMs: opts.timeoutMs,
  });
}
