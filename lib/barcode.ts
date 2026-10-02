import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes, type ReadResult } from "zxing-wasm/reader";
import { RULES } from "@/lib/config";

const require = createRequire(import.meta.url);

export type BarcodeCandidate = { text: string; format: string; top: number };

let zxingReady: Promise<void> | null = null;

function ensureZxing(): Promise<void> {
  if (zxingReady) return zxingReady;
  // webpackIgnore: Turbopack inače od .wasm pravi loader koji ne može da razreši.
  const bytes = readFileSync(
    require.resolve(/* webpackIgnore: true */ "zxing-wasm/reader/zxing_reader.wasm"),
  );
  const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pending = prepareZXingModule({
    overrides: { wasmBinary },
    fireImmediately: true,
  }).then(() => undefined);
  zxingReady = pending;
  pending.catch(() => {
    if (zxingReady === pending) zxingReady = null;
  });
  return pending;
}

/** I/O deo: sharp → raw RGBA → zxing. Nikad ne baca; greška → []. */
export async function decodeBarcodes(image: Buffer): Promise<BarcodeCandidate[]> {
  try {
    await ensureZxing();
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) return [];

    const imageData = {
      data: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
      colorSpace: "srgb" as const,
    };
    // Tanke crte na natpisnoj pločici često poklope samo jednu liniju skeniranja.
    const linear = await readBarcodes(imageData, { tryHarder: true, minLineCount: 1, formats: ["Code128"] });
    const candidates = linear.map((result) => toCandidate(result, info.height));
    if (pickSerial(candidates)) return candidates;

    const qr = await readBarcodes(imageData, { tryHarder: true, formats: ["QRCode"] });
    for (const result of qr) {
      const serial = serialFromQr(result.text);
      if (!serial) continue;
      candidates.push({ text: serial, format: result.format, top: topRatio(result.position, info.height) });
    }
    return candidates;
  } catch {
    return [];
  }
}

/** 8 cifara iza ':' u QR tekstu (EWGE311N2AAC0SP:31215748). */
export function serialFromQr(text: string): string | null {
  return text.match(/:(\d{8})(?!\d)/)?.[1] ?? null;
}

/** Filtrira po RULES.serialNumber.barcodePatterns i bira najviši validan kandidat. */
export function pickSerial(candidates: BarcodeCandidate[]): string | null {
  let best: BarcodeCandidate | null = null;
  for (const candidate of candidates) {
    const matches = RULES.serialNumber.barcodePatterns.some((pattern) => pattern.test(candidate.text));
    if (!matches) continue;
    if (!best || candidate.top < best.top) best = candidate;
  }
  return best?.text ?? null;
}

function toCandidate(result: ReadResult, height: number): BarcodeCandidate {
  return { text: result.text, format: result.format, top: topRatio(result.position, height) };
}

function topRatio(position: ReadResult["position"], height: number): number {
  const y = Math.min(
    position.topLeft.y,
    position.topRight.y,
    position.bottomLeft.y,
    position.bottomRight.y,
  );
  return Math.min(1, Math.max(0, y / height));
}
