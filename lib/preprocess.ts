import sharp from "sharp";

export type PreprocessOptions = { maxSide?: number; quality?: number };

export type PreprocessedImage = {
  buffer: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  /** Datum snimanja iz EXIF-a (ako postoji), pre nego što se metapodaci skinu. */
  capturedAt: string | null;
};

/**
 * EXIF rotacija → resize (duža strana max `maxSide`) → JPEG → bez metapodataka (GPS!).
 * Koristi se i u API ruti i u evalu, da eval meri isto što ide u produkciju.
 */
export async function preprocessImage(
  input: Buffer,
  { maxSide = 1600, quality = 85 }: PreprocessOptions = {}
): Promise<PreprocessedImage> {
  const meta = await sharp(input).metadata();
  const capturedAt = readExifDate(meta.exif);

  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, mimeType: "image/jpeg", width: info.width, height: info.height, capturedAt };
}

/** Minimalno čitanje DateTimeOriginal ("YYYY:MM:DD HH:MM:SS") iz sirovog EXIF bloka. */
function readExifDate(exif: Buffer | undefined): string | null {
  if (!exif) return null;
  const match = exif.toString("latin1").match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
