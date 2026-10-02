import { getConfig } from "@/lib/config";
import { MAX_IMAGES, mergeMeterReadings } from "@/lib/merge";
import { readMeterImage } from "@/lib/pipeline";
import type { ReadMeterResponse } from "@/lib/schema";
import { validateMergedReading } from "@/lib/validate";

export const maxDuration = 120;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function error(status: number, code: string, message: string) {
  return Response.json({ status: "error", code, message } satisfies ReadMeterResponse, { status });
}

function collectImageFiles(form: FormData): File[] {
  const fromImages = form.getAll("images").filter((f): f is File => f instanceof File);
  if (fromImages.length > 0) return fromImages;

  const legacy = form.get("image");
  if (legacy instanceof File) return [legacy];
  return [];
}

function validateFile(file: File, index?: number): Response | null {
  const label = index != null ? `Slika ${index + 1}: ` : "";
  if (file.size > MAX_BYTES) return error(400, "TOO_LARGE", `${label}fajl je veći od 10 MB.`);
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return error(400, "BAD_TYPE", `${label}nepodržan tip fajla: ${file.type}`);
  }
  return null;
}

/**
 * POST /api/read-meter  (PLAN.md, faza 4; više slika — docs/PRD.md)
 * multipart/form-data: images (1–15), ili legacy polje image
 */
export async function POST(request: Request) {
  let config;
  try {
    config = getConfig();
  } catch (e) {
    return error(500, "CONFIG", e instanceof Error ? e.message : "Neispravna konfiguracija");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error(400, "BAD_REQUEST", "Očekuje se multipart/form-data.");
  }

  const files = collectImageFiles(form);
  if (files.length === 0) {
    return error(400, "NO_IMAGE", "Nedostaju slike (polje 'images').");
  }
  if (files.length > MAX_IMAGES) {
    return error(400, "TOO_MANY", `Možete poslati najviše ${MAX_IMAGES} slika odjednom.`);
  }

  for (let i = 0; i < files.length; i++) {
    const bad = validateFile(files[i]!, i);
    if (bad) return bad;
  }

  let reads;
  try {
    reads = await Promise.all(
      files.map(async (file) =>
        readMeterImage(Buffer.from(await file.arrayBuffer()), {
          model: config.MODEL_PRIMARY,
          fallbackModels: config.MODEL_FALLBACK ? [config.MODEL_FALLBACK] : [],
          promptVersion: config.PROMPT_VERSION,
          apiKey: config.OPENROUTER_API_KEY,
          timeoutMs: config.OPENROUTER_TIMEOUT_MS,
          cropModel: false,
        }),
      ),
    );
  } catch {
    return error(400, "BAD_IMAGE", "Jedna ili više slika ne može da se obradi.");
  }

  for (const result of reads) {
    console.info("[read-meter]", {
      model: result.modelUsed,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      attempts: result.attempts,
      error: result.error,
      serialSource: result.serialSource,
      serialMismatch: result.serialMismatch,
      usedCrop: result.usedCrop,
    });
  }

  const failed = reads.find((r) => !r.parsed);
  if (failed) {
    const timedOut = failed.error?.includes("TimeoutError");
    return error(
      timedOut ? 504 : 502,
      timedOut ? "TIMEOUT" : "MODEL_ERROR",
      "Očitavanje trenutno nije uspelo. Pokušajte ponovo.",
    );
  }

  const parsedList = reads.map((r) => r.parsed!);
  const merged = mergeMeterReadings(parsedList);
  if (!merged.ok) {
    return error(400, merged.reject.code, merged.reject.message);
  }
  const mergedReading = merged.data.merged;
  const needsReviewFromMerge = merged.data.needsReviewFromMerge;

  const { status, warnings } = validateMergedReading(mergedReading, {
    serialMismatch: reads.some((r) => r.serialMismatch),
  });
  const finalStatus = needsReviewFromMerge && status === "ok" ? "needs_review" : status;

  const latencyMs = Math.max(...reads.map((r) => r.latencyMs));
  const costUsd = reads.reduce<number | null>((sum, r) => {
    if (r.costUsd == null) return sum;
    return (sum ?? 0) + r.costUsd;
  }, null);

  const readingDate = reads.find((p) => p.capturedAt)?.capturedAt ?? new Date().toISOString();

  return Response.json({
    status: finalStatus,
    data: { ...mergedReading, readingDate },
    warnings,
    meta: {
      model: reads[0]?.modelUsed ?? config.MODEL_PRIMARY,
      promptVersion: config.PROMPT_VERSION,
      latencyMs,
      costUsd,
      serialSources: reads.map((r) => r.serialSource),
    },
  } satisfies ReadMeterResponse);
}
