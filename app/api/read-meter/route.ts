import { getConfig } from "@/lib/config";
import { extractMeterReading } from "@/lib/extract";
import { preprocessImage, toDataUrl } from "@/lib/preprocess";
import { PreviousReadingSchema, type ReadMeterResponse } from "@/lib/schema";
import { validateReading } from "@/lib/validate";

export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function error(status: number, code: string, message: string) {
  return Response.json({ status: "error", code, message } satisfies ReadMeterResponse, { status });
}

/**
 * POST /api/read-meter  (PLAN.md, faza 4)
 * multipart/form-data: image (obavezno), previousReading (opciono, JSON)
 */
export async function POST(request: Request) {
  let config;
  try {
    config = getConfig();
  } catch (e) {
    return error(500, "CONFIG", e instanceof Error ? e.message : "Neispravna konfiguracija");
  }

  // 1. Ulaz
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error(400, "BAD_REQUEST", "Očekuje se multipart/form-data.");
  }
  const file = form.get("image");
  if (!(file instanceof File)) return error(400, "NO_IMAGE", "Nedostaje slika (polje 'image').");
  if (file.size > MAX_BYTES) return error(400, "TOO_LARGE", "Slika je veća od 10 MB.");
  if (file.type && !ALLOWED_TYPES.has(file.type)) return error(400, "BAD_TYPE", `Nepodržan tip fajla: ${file.type}`);

  let previous;
  const prevRaw = form.get("previousReading");
  if (typeof prevRaw === "string" && prevRaw.trim()) {
    try {
      const p = PreviousReadingSchema.safeParse(JSON.parse(prevRaw));
      if (!p.success) return error(400, "BAD_PREVIOUS", "previousReading nije ispravan.");
      previous = p.data;
    } catch {
      return error(400, "BAD_PREVIOUS", "previousReading nije validan JSON.");
    }
  }

  // 2. Preprocessing
  let image;
  try {
    image = await preprocessImage(Buffer.from(await file.arrayBuffer()));
  } catch {
    return error(400, "BAD_IMAGE", "Slika ne može da se obradi.");
  }

  // 3–4. Model + Zod
  const result = await extractMeterReading({
    imageDataUrl: toDataUrl(image.buffer, image.mimeType),
    model: config.MODEL_PRIMARY,
    fallbackModels: config.MODEL_FALLBACK ? [config.MODEL_FALLBACK] : [],
    promptVersion: config.PROMPT_VERSION,
    apiKey: config.OPENROUTER_API_KEY,
    timeoutMs: config.OPENROUTER_TIMEOUT_MS,
  });

  console.info("[read-meter]", {
    model: result.modelUsed,
    latencyMs: result.latencyMs,
    costUsd: result.costUsd,
    attempts: result.attempts,
    error: result.error,
  });

  if (!result.parsed) {
    const timedOut = result.error?.includes("TimeoutError");
    return error(timedOut ? 504 : 502, timedOut ? "TIMEOUT" : "MODEL_ERROR", "Očitavanje trenutno nije uspelo. Pokušajte ponovo.");
  }

  // 5. Poslovna validacija
  const { status, warnings } = validateReading(result.parsed, previous);

  // 6. Odgovor
  return Response.json({
    status,
    data: { ...result.parsed, readingDate: image.capturedAt ?? new Date().toISOString() },
    warnings,
    meta: {
      model: result.modelUsed ?? config.MODEL_PRIMARY,
      promptVersion: config.PROMPT_VERSION,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
    },
  } satisfies ReadMeterResponse);
}
